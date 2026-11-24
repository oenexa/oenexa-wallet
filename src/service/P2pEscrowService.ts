/**
 * P2pEscrowService — Peer-to-Peer Escrow and Region Safety Gate Engine.
 * States: OFFER_MATCHED -> ASSET_LOCKED -> BUYER_PAID -> ESCROW_RELEASED
 * Guarded exits: TIMEOUT_CANCELLED, DISPUTED, RESOLVED.
 * Enforces mandatory Region Safety Gate consent before order creation.
 * Compliance: Law 7 (< 385 LOC).
 */

import crypto from 'node:crypto';
import type { SupportedAsset } from '../domain/types.js';
import { DoubleEntryLedgerService } from './DoubleEntryLedgerService.js';

export type P2pOrderState =
  | 'OFFER_MATCHED'
  | 'ASSET_LOCKED'
  | 'BUYER_PAID'
  | 'ESCROW_RELEASED'
  | 'TIMEOUT_CANCELLED'
  | 'DISPUTED'
  | 'RESOLVED';

export interface P2pOrder {
  orderId: string;
  sellerUserId: string;
  buyerUserId: string;
  asset: SupportedAsset;
  assetAmount: string;
  fiatCurrency: string;
  fiatAmount: string;
  state: P2pOrderState;
  paymentWindowMs: number;
  createdAt: number;
  expiresAt: number;
  paidAt?: number;
  releasedAt?: number;
  disputeReason?: string;
  escrowHoldJournalId?: string;
  escrowReleaseJournalId?: string;
}

export interface RegionConsent {
  userId: string;
  zone: string;
  version: string;
  acceptedAt: number;
  ipAddress: string;
}

export class P2pEscrowService {
  private orders = new Map<string, P2pOrder>();
  private consents = new Map<string, RegionConsent>(); // key: `${userId}:${zone}`
  private ledger: DoubleEntryLedgerService;

  constructor(ledger: DoubleEntryLedgerService) {
    this.ledger = ledger;
  }

  /**
   * 1. Records Region Safety Gate Consent
   */
  public acceptRegionConsent(params: { userId: string; zone: string; version: string; ipAddress: string }): RegionConsent {
    const key = `${params.userId}:${params.zone.toUpperCase()}`;
    const consent: RegionConsent = {
      userId: params.userId,
      zone: params.zone.toUpperCase(),
      version: params.version,
      acceptedAt: Date.now(),
      ipAddress: params.ipAddress,
    };
    this.consents.set(key, consent);
    return consent;
  }

  public hasRegionConsent(userId: string, zone: string): boolean {
    return this.consents.has(`${userId}:${zone.toUpperCase()}`);
  }

  /**
   * 2. Creates and Locks P2P Escrow Order
   */
  public createP2pOrder(params: {
    sellerUserId: string;
    buyerUserId: string;
    asset: SupportedAsset;
    assetAmount: string;
    fiatCurrency: string;
    fiatAmount: string;
    zone: string;
    paymentWindowMs?: number;
    now?: number;
  }): P2pOrder {
    const now = params.now ?? Date.now();

    // Verify Region Safety Gate consent
    if (!this.hasRegionConsent(params.sellerUserId, params.zone)) {
      throw new Error(`SAFETY_GATE_BLOCKED: Seller must accept 'Things to know' for zone ${params.zone}`);
    }
    if (!this.hasRegionConsent(params.buyerUserId, params.zone)) {
      throw new Error(`SAFETY_GATE_BLOCKED: Buyer must accept 'Things to know' for zone ${params.zone}`);
    }

    const orderId = `p2p_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const windowMs = params.paymentWindowMs ?? 15 * 60 * 1000; // 15 mins default

    // Lock seller asset in double-entry ledger: Spot Balances (2101) -> Escrow Margin (2102)
    const holdJournal = this.ledger.recordJournal({
      referenceId: `p2p-lock-${orderId}`,
      eventType: 'TRADE_FILL',
      description: `Lock seller escrow asset for P2P order ${orderId}`,
      postings: [
        { accountCode: '2101', userId: params.sellerUserId, asset: params.asset, direction: 'DEBIT', amount: params.assetAmount },
        { accountCode: '2102', userId: params.sellerUserId, asset: params.asset, direction: 'CREDIT', amount: params.assetAmount },
      ],
    });

    const order: P2pOrder = {
      orderId,
      sellerUserId: params.sellerUserId,
      buyerUserId: params.buyerUserId,
      asset: params.asset,
      assetAmount: params.assetAmount,
      fiatCurrency: params.fiatCurrency.toUpperCase(),
      fiatAmount: params.fiatAmount,
      state: 'ASSET_LOCKED',
      paymentWindowMs: windowMs,
      createdAt: now,
      expiresAt: now + windowMs,
      escrowHoldJournalId: holdJournal.journalId,
    };

    this.orders.set(orderId, order);
    return order;
  }

  /**
   * 3. Buyer marks order as Paid
   */
  public markBuyerPaid(orderId: string, buyerUserId: string, now = Date.now()): P2pOrder {
    const order = this.getOrder(orderId);
    if (order.buyerUserId !== buyerUserId) throw new Error('Unauthorized: Only buyer can mark order as paid');
    if (order.state !== 'ASSET_LOCKED') throw new Error(`Invalid state transition from ${order.state} to BUYER_PAID`);

    if (now > order.expiresAt) {
      return this.handleTimeout(orderId, now);
    }

    order.state = 'BUYER_PAID';
    order.paidAt = now;
    return order;
  }

  /**
   * 4. Seller releases Escrow to Buyer
   */
  public releaseEscrow(orderId: string, sellerUserId: string, now = Date.now()): P2pOrder {
    const order = this.getOrder(orderId);
    if (order.sellerUserId !== sellerUserId) throw new Error('Unauthorized: Only seller can release escrow');
    if (order.state !== 'BUYER_PAID') throw new Error(`Cannot release escrow while in ${order.state}. Buyer must mark paid.`);

    // Settle in Double-Entry Ledger: Debit Seller Escrow (2102) -> Credit Buyer Spot Balance (2101)
    const releaseJournal = this.ledger.recordJournal({
      referenceId: `p2p-release-${order.orderId}`,
      eventType: 'TRADE_FILL',
      description: `Release P2P escrow asset to buyer for order ${order.orderId}`,
      postings: [
        { accountCode: '2102', userId: order.sellerUserId, asset: order.asset, direction: 'DEBIT', amount: order.assetAmount },
        { accountCode: '2101', userId: order.buyerUserId, asset: order.asset, direction: 'CREDIT', amount: order.assetAmount },
      ],
    });

    order.state = 'ESCROW_RELEASED';
    order.releasedAt = now;
    order.escrowReleaseJournalId = releaseJournal.journalId;
    return order;
  }

  /**
   * 5. Timeout Auto-Cancellation: If buyer doesn't pay in time, unlock seller asset
   */
  public handleTimeout(orderId: string, now = Date.now()): P2pOrder {
    const order = this.getOrder(orderId);
    if (order.state !== 'ASSET_LOCKED') throw new Error(`Cannot timeout order in state ${order.state}`);
    if (now < order.expiresAt) throw new Error('Payment window has not yet expired');

    // Reverse hold: Escrow Margin (2102) -> Seller Spot Balance (2101)
    this.ledger.recordJournal({
      referenceId: `p2p-rev-timeout-${order.orderId}`,
      eventType: 'TRADE_FILL',
      description: `Unlock seller asset on P2P timeout for order ${order.orderId}`,
      postings: [
        { accountCode: '2102', userId: order.sellerUserId, asset: order.asset, direction: 'DEBIT', amount: order.assetAmount },
        { accountCode: '2101', userId: order.sellerUserId, asset: order.asset, direction: 'CREDIT', amount: order.assetAmount },
      ],
    });

    order.state = 'TIMEOUT_CANCELLED';
    return order;
  }

  /**
   * 6. Open Dispute
   */
  public disputeOrder(orderId: string, claimantUserId: string, reason: string): P2pOrder {
    const order = this.getOrder(orderId);
    if (order.sellerUserId !== claimantUserId && order.buyerUserId !== claimantUserId) {
      throw new Error('Unauthorized: Only buyer or seller can dispute order');
    }
    if (order.state !== 'BUYER_PAID' && order.state !== 'ASSET_LOCKED') {
      throw new Error(`Cannot dispute order in state ${order.state}`);
    }

    order.state = 'DISPUTED';
    order.disputeReason = reason;
    return order;
  }

  public getOrder(orderId: string): P2pOrder {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`P2P order ${orderId} not found`);
    return order;
  }
}
