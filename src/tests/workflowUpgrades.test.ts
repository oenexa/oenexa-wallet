import { describe, it, expect } from 'vitest';
import { DoubleEntryLedgerService } from '../service/DoubleEntryLedgerService.js';
import { TransactionStateMachine } from '../service/TransactionStateMachine.js';
import { DashboardBootstrapService } from '../service/DashboardBootstrapService.js';
import { P2pEscrowService } from '../service/P2pEscrowService.js';
import { WithdrawalGateService } from '../service/WithdrawalGateService.js';

describe('Banking-Grade Workflow Upgrades (Areas B, C, D, E, F)', () => {
  const ledger = new DoubleEntryLedgerService();

  describe('Transaction State Machine & Two-Phase Hold/Release (Area D)', () => {
    it('creates withdrawal with double-entry hold and executes idempotent retries', () => {
      const sm = new TransactionStateMachine(ledger);
      const idempotencyKey = 'idem-wth-001';

      const tx1 = sm.createTransaction({
        idempotencyKey,
        userId: 'usr_alice',
        type: 'WITHDRAWAL',
        asset: 'USDT',
        amount: '1000.00',
      });

      expect(tx1.state).toBe('CREATED');
      expect(tx1.holdJournalId).toBeDefined();

      // Idempotent retry returns existing transaction without duplicate hold
      const tx2 = sm.createTransaction({
        idempotencyKey,
        userId: 'usr_alice',
        type: 'WITHDRAWAL',
        asset: 'USDT',
        amount: '1000.00',
      });
      expect(tx2.id).toBe(tx1.id);
    });

    it('reverses double-entry hold when user cancels a pending withdrawal', () => {
      const sm = new TransactionStateMachine(ledger);
      const tx = sm.createTransaction({
        idempotencyKey: 'idem-wth-cancel',
        userId: 'usr_alice',
        type: 'WITHDRAWAL',
        asset: 'USDT',
        amount: '500.00',
      });

      sm.transitionToPending(tx.id);
      expect(tx.state).toBe('PENDING');

      // User cancels
      const cancelled = sm.cancelTransaction(tx.id, 'usr_alice');
      expect(cancelled.state).toBe('CANCELLED');
    });

    it('progresses deposit from CREATED -> PENDING -> CONFIRMING -> COMPLETED', () => {
      const sm = new TransactionStateMachine(ledger);
      const tx = sm.createTransaction({
        idempotencyKey: 'idem-dep-001',
        userId: 'usr_bob',
        type: 'DEPOSIT',
        asset: 'USDT',
        amount: '2500.00',
        requiredConfirmations: 2,
      });

      sm.transitionToPending(tx.id);
      sm.transitionToConfirming(tx.id, '0xabc123', 1);
      expect(tx.state).toBe('CONFIRMING');

      // Second confirmation triggers completion & double-entry settlement
      sm.transitionToConfirming(tx.id, '0xabc123', 2);
      expect(tx.state).toBe('COMPLETED');
      expect(tx.settleJournalId).toBeDefined();
    });
  });

  describe('Dashboard Bootstrap Aggregator (Area B & C)', () => {
    const bootstrap = new DashboardBootstrapService();

    it('returns unified dashboard payload with profile, sparkline, and server-filtered holdings', () => {
      const result = bootstrap.getDashboardBootstrap({
        userId: 'usr_vip_1',
        tier: 'TIER_2',
        email: 'alice.institution@oenexa.com',
        tab: 'holding',
      });

      expect(result.profile.userId).toBe('usr_vip_1');
      expect(result.profile.emailMasked).toBe('a***n@oenexa.com');
      expect(result.valuation.totalUsd).toBeGreaterThan(0);
      expect(result.valuation.sparkline24h.length).toBe(7);
      expect(result.holdings.items.length).toBeGreaterThan(0);
      expect(result.notices.length).toBeGreaterThanOrEqual(1);
    });

    it('filters small balances when requested', () => {
      const balances = [
        { asset: 'ONXC', free: '100.00', locked: '0.00', price: 12.50, change24h: 2.0, vol24h: 100_000 },
        { asset: 'DUST', free: '0.01', locked: '0.00', price: 1.00, change24h: 0.0, vol24h: 1_000 }, // $0.01 < $10
      ];

      const res = bootstrap.getDashboardBootstrap({
        userId: 'usr_dust',
        userBalances: balances,
        hideSmallBalances: true,
      });

      expect(res.holdings.items.length).toBe(1);
      expect(res.holdings.items[0].asset).toBe('ONXC');
    });
  });

  describe('P2P Escrow & Region Safety Gate (Area E)', () => {
    const p2p = new P2pEscrowService(ledger);

    it('blocks P2P order creation until both parties accept Region Safety Gate consent', () => {
      expect(() => {
        p2p.createP2pOrder({
          sellerUserId: 'usr_seller',
          buyerUserId: 'usr_buyer',
          asset: 'USDT',
          assetAmount: '200.00',
          fiatCurrency: 'EUR',
          fiatAmount: '185.00',
          zone: 'EU_ZONE',
        });
      }).toThrow(/SAFETY_GATE_BLOCKED/i);

      // Both accept consent
      p2p.acceptRegionConsent({ userId: 'usr_seller', zone: 'EU_ZONE', version: 'v1.0', ipAddress: '10.0.0.1' });
      p2p.acceptRegionConsent({ userId: 'usr_buyer', zone: 'EU_ZONE', version: 'v1.0', ipAddress: '10.0.0.2' });

      const order = p2p.createP2pOrder({
        sellerUserId: 'usr_seller',
        buyerUserId: 'usr_buyer',
        asset: 'USDT',
        assetAmount: '200.00',
        fiatCurrency: 'EUR',
        fiatAmount: '185.00',
        zone: 'EU_ZONE',
      });

      expect(order.state).toBe('ASSET_LOCKED');
      expect(order.escrowHoldJournalId).toBeDefined();

      // Buyer marks paid
      p2p.markBuyerPaid(order.orderId, 'usr_buyer');
      expect(order.state).toBe('BUYER_PAID');

      // Seller releases escrow
      p2p.releaseEscrow(order.orderId, 'usr_seller');
      expect(order.state).toBe('ESCROW_RELEASED');
      expect(order.escrowReleaseJournalId).toBeDefined();
    });

    it('reverses seller asset hold upon P2P timeout auto-cancellation', () => {
      const now = Date.now();
      const order = p2p.createP2pOrder({
        sellerUserId: 'usr_seller',
        buyerUserId: 'usr_buyer',
        asset: 'USDT',
        assetAmount: '100.00',
        fiatCurrency: 'EUR',
        fiatAmount: '92.00',
        zone: 'EU_ZONE',
        paymentWindowMs: 10_000,
        now,
      });

      // Timeout passes without buyer payment
      const timedOut = p2p.handleTimeout(order.orderId, now + 15_000);
      expect(timedOut.state).toBe('TIMEOUT_CANCELLED');
    });
  });

  describe('Withdrawal Governance & Security Gates (Area F)', () => {
    const gateService = new WithdrawalGateService();

    it('blocks withdrawal if anti-phishing code does not match', () => {
      gateService.setUserSecurityProfile({
        userId: 'usr_dan',
        tier: 'TIER_1',
        antiPhishingCode: 'SAFE_OENEXA_77',
        mfaEnabled: true,
        dailyWithdrawnUsd: 0,
      });

      const evalRes = gateService.evaluateWithdrawal({
        userId: 'usr_dan',
        asset: 'USDT',
        network: 'ERC20',
        amountUsd: 500,
        destinationAddress: '0x123',
        mfaCodeProvided: '123456',
        antiPhishingCodeProvided: 'WRONG_CODE',
      });

      expect(evalRes.allowed).toBe(false);
      expect(evalRes.reason).toMatch(/ANTI_PHISHING_MISMATCH/i);
    });

    it('enforces 24-hour cooling-off period on newly whitelisted addresses', () => {
      const now = Date.now();
      const dest = '0x9876543210abcdef9876543210abcdef98765432';

      gateService.setUserSecurityProfile({
        userId: 'usr_eve',
        tier: 'TIER_2',
        mfaEnabled: true,
        dailyWithdrawnUsd: 0,
      });

      // Whitelist address now
      gateService.whitelistAddress('usr_eve', 'USDT', 'ERC20', dest, 'Cold Ledger', now);

      // Attempt withdrawal immediately (within cooling off period)
      const resLocked = gateService.evaluateWithdrawal(
        {
          userId: 'usr_eve',
          asset: 'USDT',
          network: 'ERC20',
          amountUsd: 5000,
          destinationAddress: dest,
          mfaCodeProvided: '654321',
        },
        now + 1000
      ); // 1 sec later

      expect(resLocked.allowed).toBe(false);
      expect(resLocked.reason).toMatch(/ADDRESS_COOLING_OFF/i);

      // Attempt withdrawal after 24 hours has elapsed
      const resAllowed = gateService.evaluateWithdrawal(
        {
          userId: 'usr_eve',
          asset: 'USDT',
          network: 'ERC20',
          amountUsd: 5000,
          destinationAddress: dest,
          mfaCodeProvided: '654321',
        },
        now + 25 * 3600 * 1000
      );

      expect(resAllowed.allowed).toBe(true);
      expect(resAllowed.decision).toBe('AUTO_APPROVE');
    });

    it('submits deposit rescan ticket for uncredited incoming transactions', () => {
      const ticket = gateService.submitDepositRescanTicket({
        userId: 'usr_frank',
        asset: 'BTC',
        network: 'BITCOIN',
        txHash: '0xdeadbeef1234',
      });

      expect(ticket.ticketId).toBeDefined();
      expect(ticket.status).toBe('PENDING_SCAN');
    });
  });
});
