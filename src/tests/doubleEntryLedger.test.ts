import { describe, it, expect } from 'vitest';
import { DoubleEntryLedgerService } from '../service/DoubleEntryLedgerService.js';
import { ReconciliationEngine } from '../service/ReconciliationEngine.js';
import { MpcVaultService } from '../service/MpcVaultService.js';

describe('Banking-Grade Double-Entry Ledger & Reconciliation Engine Suite', () => {
  it('records balanced deposit journal and derives accurate user liability balance', () => {
    const ledger = new DoubleEntryLedgerService();

    const journal = ledger.processDeposit({
      txHash: '0xabc_deposit_btc_01',
      userId: 'usr_institutional_alice',
      asset: 'BTC',
      amount: '5.50000000',
    });

    expect(journal.journalId.startsWith('jnl_')).toBe(true);
    expect(journal.postings).toHaveLength(2);

    // Assert debit and credit
    const debit = journal.postings.find((p) => p.direction === 'DEBIT');
    const credit = journal.postings.find((p) => p.direction === 'CREDIT');
    expect(debit?.accountCode).toBe('1101'); // MPC Hot Vault BTC Asset
    expect(credit?.accountCode).toBe('2101'); // Client Spot Balance Liability
    expect(debit?.amount).toBe('5.50000000');
    expect(credit?.amount).toBe('5.50000000');

    // Balance query
    const balance = ledger.getUserBalance('usr_institutional_alice', 'BTC');
    expect(balance).toBe(5.5);
    expect(ledger.getTotalClientLiabilities('BTC')).toBe(5.5);
  });

  it('rejects unbalanced journal entries and enforces double-entry invariant', () => {
    const ledger = new DoubleEntryLedgerService();

    expect(() =>
      ledger.recordJournal({
        referenceId: 'unbalanced_ref_01',
        eventType: 'DEPOSIT',
        description: 'Violating invariant',
        postings: [
          { accountCode: '1101', asset: 'BTC', direction: 'DEBIT', amount: '10.0' },
          { accountCode: '2101', asset: 'BTC', direction: 'CREDIT', amount: '9.9' }, // Discrepancy 0.1
        ],
      })
    ).toThrow(/Double-entry invariant violated for BTC/);
  });

  it('enforces strict idempotency on duplicate reference identifiers', () => {
    const ledger = new DoubleEntryLedgerService();

    const j1 = ledger.processDeposit({
      txHash: '0xunique_tx_hash_100',
      userId: 'usr_bob',
      asset: 'USDT',
      amount: '1000.00',
    });

    const j2 = ledger.processDeposit({
      txHash: '0xunique_tx_hash_100',
      userId: 'usr_bob',
      asset: 'USDT',
      amount: '1000.00',
    });

    expect(j1.journalId).toBe(j2.journalId);
    expect(ledger.getUserBalance('usr_bob', 'USDT')).toBe(1000.0);
    expect(ledger.getJournalCount()).toBe(1);
  });

  it('processes withdrawal with network fee allocation to exchange revenue', () => {
    const ledger = new DoubleEntryLedgerService();

    // 1. Initial Deposit
    ledger.processDeposit({
      txHash: '0xseed_deposit',
      userId: 'usr_charlie',
      asset: 'ETH',
      amount: '20.0',
    });

    // 2. Withdrawal of 15 ETH with 0.05 ETH fee
    const wdJournal = ledger.processWithdrawal({
      withdrawalId: 'wd_req_8819',
      userId: 'usr_charlie',
      asset: 'ETH',
      amount: '14.95',
      feeAmount: '0.05',
    });

    expect(wdJournal.postings).toHaveLength(3);
    expect(ledger.getUserBalance('usr_charlie', 'ETH')).toBe(5.0);
  });

  it('rejects withdrawal exceeding user available double-entry balance', () => {
    const ledger = new DoubleEntryLedgerService();

    ledger.processDeposit({
      txHash: '0xsmall_dep',
      userId: 'usr_david',
      asset: 'ONXC',
      amount: '50.0',
    });

    expect(() =>
      ledger.processWithdrawal({
        withdrawalId: 'wd_excessive',
        userId: 'usr_david',
        asset: 'ONXC',
        amount: '100.0',
      })
    ).toThrow(/Insufficient funds/);
  });

  it('reconciles physical vault with ledger and trips circuit breaker on drift', () => {
    const ledger = new DoubleEntryLedgerService();
    const mpc = new MpcVaultService();
    const reconciler = new ReconciliationEngine(ledger, mpc);

    // Deposit 10 BTC
    ledger.processDeposit({
      txHash: '0xrec_test_dep',
      userId: 'usr_fund',
      asset: 'BTC',
      amount: '10.0',
    });

    // Reconcile: physical vault has exact 10.0 BTC -> Balanced
    const balancedReport = reconciler.reconcileAsset('BTC', 10.0);
    expect(balancedReport.isBalanced).toBe(true);
    expect(balancedReport.circuitBreakerTripped).toBe(false);
    expect(reconciler.isWithdrawalPermitted('BTC')).toBe(true);

    // Reconcile: physical vault has 9.5 BTC (unaccounted drift of 0.5 BTC) -> Trip Circuit Breaker
    const driftReport = reconciler.reconcileAsset('BTC', 9.5);
    expect(driftReport.isBalanced).toBe(false);
    expect(driftReport.circuitBreakerTripped).toBe(true);
    expect(reconciler.isWithdrawalPermitted('BTC')).toBe(false);

    // Reset circuit breaker with auditor authorization
    expect(() => reconciler.resetCircuitBreaker('BTC', 'short_key')).toThrow('Unauthorized');
    const resetSuccess = reconciler.resetCircuitBreaker(
      'BTC',
      'auditor_super_secret_override_key_with_sufficient_length_2026'
    );
    expect(resetSuccess).toBe(true);
    expect(reconciler.isWithdrawalPermitted('BTC')).toBe(true);
  });
});
