/**
 * TransactionStateMachine — Banking-Grade Deposit & Withdrawal Lifecycle Engine.
 * States: CREATED -> PENDING -> CONFIRMING -> COMPLETED
 * Guarded transitions: FAILED, EXPIRED, CANCELLED, UNDER_REVIEW.
 * Integrates with DoubleEntryLedgerService for two-phase Hold & Release.
 * Invariant: Balances derived only via double-entry postings. Exact decimal arithmetic.
 */

import crypto from 'node:crypto';
import type { SupportedAsset } from '../domain/types.js';
import { DoubleEntryLedgerService } from './DoubleEntryLedgerService.js';

export type TxState =
  | 'CREATED'
  | 'PENDING'
  | 'CONFIRMING'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'UNDER_REVIEW';

export type TxType = 'DEPOSIT' | 'WITHDRAWAL' | 'INTERNAL_TRANSFER';

export interface ManagedTransaction {
  id: string;
  idempotencyKey: string;
  userId: string;
  type: TxType;
  asset: SupportedAsset;
  amount: string; // Exact decimal string
  fee: string; // Exact decimal string
  state: TxState;
  destinationAddress?: string;
  txHash?: string;
  requiredConfirmations: number;
  currentConfirmations: number;
  holdJournalId?: string;
  settleJournalId?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  failureReason?: string;
  auditTrail: Array<{ from: TxState; to: TxState; timestamp: number; reason?: string }>;
}

export class TransactionStateMachine {
  private transactions = new Map<string, ManagedTransaction>();
  private idempotencyMap = new Map<string, string>(); // idempotencyKey -> txId
  private ledger: DoubleEntryLedgerService;

  constructor(ledger: DoubleEntryLedgerService) {
    this.ledger = ledger;
  }

  /**
   * 1. Initiates a Transaction in CREATED state with idempotency check
   */
  public createTransaction(params: {
    idempotencyKey: string;
    userId: string;
    type: TxType;
    asset: SupportedAsset;
    amount: string;
    fee?: string;
    destinationAddress?: string;
    ttlMs?: number;
    requiredConfirmations?: number;
    now?: number;
  }): ManagedTransaction {
    const now = params.now ?? Date.now();

    // Idempotency check
    if (this.idempotencyMap.has(params.idempotencyKey)) {
      const existingId = this.idempotencyMap.get(params.idempotencyKey)!;
      return this.transactions.get(existingId)!;
    }

    const txId = `tx_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const tx: ManagedTransaction = {
      id: txId,
      idempotencyKey: params.idempotencyKey,
      userId: params.userId,
      type: params.type,
      asset: params.asset,
      amount: params.amount,
      fee: params.fee ?? '0.0',
      state: 'CREATED',
      destinationAddress: params.destinationAddress,
      requiredConfirmations: params.requiredConfirmations ?? (params.asset === 'BTC' ? 2 : 12),
      currentConfirmations: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: params.ttlMs ? now + params.ttlMs : undefined,
      auditTrail: [{ from: 'CREATED', to: 'CREATED', timestamp: now, reason: 'Transaction initialized' }],
    };

    // If withdrawal, place double-entry HOLD immediately
    if (params.type === 'WITHDRAWAL') {
      const holdJournal = this.ledger.recordJournal({
        referenceId: `hold-${txId}`,
        eventType: 'WITHDRAWAL',
        description: `Hold funds for withdrawal ${txId}`,
        postings: [
          { accountCode: '2101', userId: params.userId, asset: params.asset, direction: 'DEBIT', amount: params.amount },
          { accountCode: '2102', userId: params.userId, asset: params.asset, direction: 'CREDIT', amount: params.amount },
        ],
      });
      tx.holdJournalId = holdJournal.journalId;
    }

    this.transactions.set(txId, tx);
    this.idempotencyMap.set(params.idempotencyKey, txId);
    return tx;
  }

  /**
   * 2. Transitions to PENDING (submitted to queue/network)
   */
  public transitionToPending(txId: string, now = Date.now()): ManagedTransaction {
    const tx = this.getTx(txId);
    this.assertTransition(tx.state, ['CREATED', 'UNDER_REVIEW'], 'PENDING');

    this.recordTransition(tx, 'PENDING', now, 'Submitted to network/processing queue');
    return tx;
  }

  /**
   * 3. Flags for Compliance / Risk Review
   */
  public flagForReview(txId: string, reason: string, now = Date.now()): ManagedTransaction {
    const tx = this.getTx(txId);
    this.assertTransition(tx.state, ['CREATED', 'PENDING'], 'UNDER_REVIEW');

    this.recordTransition(tx, 'UNDER_REVIEW', now, reason);
    return tx;
  }

  /**
   * 4. User-Initiated Cancellation (Guarded: only allowed while in CREATED or PENDING)
   */
  public cancelTransaction(txId: string, userId: string, now = Date.now()): ManagedTransaction {
    const tx = this.getTx(txId);
    if (tx.userId !== userId) throw new Error('Unauthorized: User does not own this transaction');
    this.assertTransition(tx.state, ['CREATED', 'PENDING'], 'CANCELLED');

    // If withdrawal had a hold, reverse the hold back to client spot balance
    if (tx.type === 'WITHDRAWAL' && tx.holdJournalId) {
      this.ledger.recordJournal({
        referenceId: `rev-hold-${tx.id}`,
        eventType: 'WITHDRAWAL',
        description: `Release hold for cancelled withdrawal ${tx.id}`,
        postings: [
          { accountCode: '2102', userId: tx.userId, asset: tx.asset, direction: 'DEBIT', amount: tx.amount },
          { accountCode: '2101', userId: tx.userId, asset: tx.asset, direction: 'CREDIT', amount: tx.amount },
        ],
      });
    }

    this.recordTransition(tx, 'CANCELLED', now, 'Cancelled by user before broadcast');
    return tx;
  }

  /**
   * 5. Transitions to CONFIRMING upon broadcast or incoming block detection
   */
  public transitionToConfirming(txId: string, txHash: string, confirmations = 1, now = Date.now()): ManagedTransaction {
    const tx = this.getTx(txId);
    this.assertTransition(tx.state, ['PENDING', 'CONFIRMING'], 'CONFIRMING');

    tx.txHash = txHash;
    tx.currentConfirmations = confirmations;
    this.recordTransition(tx, 'CONFIRMING', now, `Confirmations updated: ${confirmations}/${tx.requiredConfirmations}`);

    // Auto-complete if confirmations reached
    if (tx.currentConfirmations >= tx.requiredConfirmations) {
      return this.completeTransaction(txId, now);
    }
    return tx;
  }

  /**
   * 6. Transitions to COMPLETED: posts final settlement ledger entries
   */
  public completeTransaction(txId: string, now = Date.now()): ManagedTransaction {
    const tx = this.getTx(txId);
    this.assertTransition(tx.state, ['CONFIRMING', 'PENDING'], 'COMPLETED');

    if (tx.type === 'DEPOSIT') {
      // Deposit Settlement: Debit Hot Vault (1102/1103) -> Credit Client Spot Balance (2101)
      const vaultAccount = tx.asset === 'BTC' ? '1101' : tx.asset === 'ONXC' ? '1103' : '1102';
      const settleJournal = this.ledger.recordJournal({
        referenceId: `settle-dep-${tx.id}`,
        eventType: 'DEPOSIT',
        description: `Credit client spot balance for deposit ${tx.id}`,
        postings: [
          { accountCode: vaultAccount, asset: tx.asset, direction: 'DEBIT', amount: tx.amount },
          { accountCode: '2101', userId: tx.userId, asset: tx.asset, direction: 'CREDIT', amount: tx.amount },
        ],
      });
      tx.settleJournalId = settleJournal.journalId;
    } else if (tx.type === 'WITHDRAWAL') {
      // Withdrawal Settlement: Debit Locked Margin (2102) -> Credit Hot Vault (1102)
      const vaultAccount = tx.asset === 'BTC' ? '1101' : tx.asset === 'ONXC' ? '1103' : '1102';
      const settleJournal = this.ledger.recordJournal({
        referenceId: `settle-wth-${tx.id}`,
        eventType: 'WITHDRAWAL',
        description: `Settled on-chain withdrawal ${tx.id}`,
        postings: [
          { accountCode: '2102', userId: tx.userId, asset: tx.asset, direction: 'DEBIT', amount: tx.amount },
          { accountCode: vaultAccount, asset: tx.asset, direction: 'CREDIT', amount: tx.amount },
        ],
      });
      tx.settleJournalId = settleJournal.journalId;
    }

    this.recordTransition(tx, 'COMPLETED', now, 'Transaction finalized and settled');
    return tx;
  }

  /**
   * 7. Fail Transaction (Reverses any holds)
   */
  public failTransaction(txId: string, reason: string, now = Date.now()): ManagedTransaction {
    const tx = this.getTx(txId);
    if (tx.state === 'COMPLETED') throw new Error('Cannot fail an already completed transaction');

    if (tx.type === 'WITHDRAWAL' && tx.holdJournalId && !tx.settleJournalId) {
      this.ledger.recordJournal({
        referenceId: `fail-rev-${tx.id}`,
        eventType: 'WITHDRAWAL',
        description: `Reversal of hold for failed withdrawal ${tx.id}: ${reason}`,
        postings: [
          { accountCode: '2102', userId: tx.userId, asset: tx.asset, direction: 'DEBIT', amount: tx.amount },
          { accountCode: '2101', userId: tx.userId, asset: tx.asset, direction: 'CREDIT', amount: tx.amount },
        ],
      });
    }

    tx.failureReason = reason;
    this.recordTransition(tx, 'FAILED', now, reason);
    return tx;
  }

  public getTransaction(txId: string): ManagedTransaction | undefined {
    return this.transactions.get(txId);
  }

  private getTx(txId: string): ManagedTransaction {
    const tx = this.transactions.get(txId);
    if (!tx) throw new Error(`Transaction ${txId} not found`);
    return tx;
  }

  private assertTransition(current: TxState, allowedFrom: TxState[], target: TxState): void {
    if (!allowedFrom.includes(current)) {
      throw new Error(`Invalid state transition from ${current} to ${target}`);
    }
  }

  private recordTransition(tx: ManagedTransaction, to: TxState, timestamp: number, reason?: string): void {
    tx.auditTrail.push({ from: tx.state, to, timestamp, reason });
    tx.state = to;
    tx.updatedAt = timestamp;
  }
}
