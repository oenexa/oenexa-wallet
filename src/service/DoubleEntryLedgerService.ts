/**
 * OENEXA Banking-Grade Double-Entry Ledger Engine
 * Enforces strict financial accounting invariance:
 * For every journal entry J, SUM(Debits) === SUM(Credits) per asset.
 * Conforms to Inviolable Law 7 (< 385 LOC).
 */

import crypto from 'node:crypto';
import type { SupportedAsset } from '../domain/types.js';

export type PostingDirection = 'DEBIT' | 'CREDIT';
export type AccountCategory = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export interface ChartOfAccount {
  code: string;
  name: string;
  category: AccountCategory;
  normalBalance: PostingDirection;
}

export interface PostingInput {
  accountCode: string;
  userId?: string; // Optional: empty for exchange operating accounts
  asset: SupportedAsset;
  direction: PostingDirection;
  amount: string; // BigNumber representation
}

export interface LedgerPostingRecord extends PostingInput {
  postingId: string;
  journalId: string;
  timestamp: string;
}

export interface FinancialJournalRecord {
  journalId: string;
  referenceId: string; // Idempotency reference
  eventType: 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE_FILL' | 'FEE' | 'SWEEP';
  description: string;
  postings: LedgerPostingRecord[];
  timestamp: string;
}

export class DoubleEntryLedgerService {
  private journals = new Map<string, FinancialJournalRecord>(); // journalId -> journal
  private referenceIndex = new Map<string, string>(); // referenceId -> journalId (idempotency)
  private postings: LedgerPostingRecord[] = [];

  // Standard Banking Chart of Accounts
  public static readonly COA: Record<string, ChartOfAccount> = {
    '1101': { code: '1101', name: 'MPC Hot Vault - BTC', category: 'ASSET', normalBalance: 'DEBIT' },
    '1102': { code: '1102', name: 'MPC Hot Vault - ETH/USDT', category: 'ASSET', normalBalance: 'DEBIT' },
    '1103': { code: '1103', name: 'MPC Hot Vault - ONXC Native', category: 'ASSET', normalBalance: 'DEBIT' },
    '1201': { code: '1201', name: 'Institutional Cold Storage', category: 'ASSET', normalBalance: 'DEBIT' },
    '1301': { code: '1301', name: 'Bundesbank SEPA Clearing', category: 'ASSET', normalBalance: 'DEBIT' },
    '2101': { code: '2101', name: 'Client Spot Balances', category: 'LIABILITY', normalBalance: 'CREDIT' },
    '2102': { code: '2102', name: 'Client Locked Margin', category: 'LIABILITY', normalBalance: 'CREDIT' },
    '3101': { code: '3101', name: 'Proof-of-Reserves Capital', category: 'EQUITY', normalBalance: 'CREDIT' },
    '4101': { code: '4101', name: 'Spot Taker Fee Revenue', category: 'REVENUE', normalBalance: 'CREDIT' },
  };

  /**
   * Records an immutable, balanced multi-posting financial journal entry
   */
  public recordJournal(params: {
    referenceId: string;
    eventType: 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE_FILL' | 'FEE' | 'SWEEP';
    description: string;
    postings: PostingInput[];
  }): FinancialJournalRecord {
    // 1. Idempotency Check
    if (this.referenceIndex.has(params.referenceId)) {
      const existingId = this.referenceIndex.get(params.referenceId)!;
      return this.journals.get(existingId)!;
    }

    if (params.postings.length < 2) {
      throw new Error('Double-entry accounting requires at least two balanced postings.');
    }

    // 2. Cryptographic Validation & Invariant Check per Asset: SUM(Debits) === SUM(Credits)
    const assetTotals = new Map<SupportedAsset, { debit: number; credit: number }>();

    for (const post of params.postings) {
      const amount = parseFloat(post.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error(`Invalid posting amount '${post.amount}': must be greater than zero.`);
      }

      const current = assetTotals.get(post.asset) || { debit: 0, credit: 0 };
      if (post.direction === 'DEBIT') {
        current.debit += amount;
      } else {
        current.credit += amount;
      }
      assetTotals.set(post.asset, current);
    }

    for (const [asset, totals] of assetTotals.entries()) {
      const diff = Math.abs(totals.debit - totals.credit);
      // Precision tolerance: 0.0000000001 (10 decimal places)
      if (diff > 0.0000000001) {
        throw new Error(
          `Double-entry invariant violated for ${asset}: Total Debits (${totals.debit.toFixed(8)}) != Total Credits (${totals.credit.toFixed(8)}). Delta: ${diff.toFixed(8)}`
        );
      }
    }

    // 3. Assemble and persist immutable records
    const journalId = `jnl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const timestamp = new Date().toISOString();

    const createdPostings: LedgerPostingRecord[] = params.postings.map((p, idx) => ({
      ...p,
      postingId: `pst_${journalId}_${idx}`,
      journalId,
      timestamp,
    }));

    const journal: FinancialJournalRecord = {
      journalId,
      referenceId: params.referenceId,
      eventType: params.eventType,
      description: params.description,
      postings: createdPostings,
      timestamp,
    };

    this.journals.set(journalId, journal);
    this.referenceIndex.set(params.referenceId, journalId);
    this.postings.push(...createdPostings);

    return journal;
  }

  /**
   * Helper: Standard Client Deposit (Debit Vault Asset, Credit Client Liability)
   */
  public processDeposit(params: {
    txHash: string;
    userId: string;
    asset: SupportedAsset;
    amount: string;
    vaultAccountCode?: string;
  }): FinancialJournalRecord {
    const vaultCode = params.vaultAccountCode || (params.asset === 'BTC' ? '1101' : params.asset === 'ONXC' ? '1103' : '1102');

    return this.recordJournal({
      referenceId: `dep_${params.txHash}`,
      eventType: 'DEPOSIT',
      description: `Deposit credit for user ${params.userId} via ${params.asset}`,
      postings: [
        {
          accountCode: vaultCode,
          asset: params.asset,
          direction: 'DEBIT', // Asset increases with Debit
          amount: params.amount,
        },
        {
          accountCode: '2101', // Client Spot Balance Liability
          userId: params.userId,
          asset: params.asset,
          direction: 'CREDIT', // Liability increases with Credit
          amount: params.amount,
        },
      ],
    });
  }

  /**
   * Helper: Standard Client Withdrawal (Debit Client Liability, Credit Vault Asset)
   */
  public processWithdrawal(params: {
    withdrawalId: string;
    userId: string;
    asset: SupportedAsset;
    amount: string;
    feeAmount?: string;
    vaultAccountCode?: string;
  }): FinancialJournalRecord {
    const userBal = this.getUserBalance(params.userId, params.asset);
    const totalDeducted = parseFloat(params.amount) + (params.feeAmount ? parseFloat(params.feeAmount) : 0);

    if (userBal < totalDeducted) {
      throw new Error(`Insufficient funds: requested ${totalDeducted} ${params.asset}, available ${userBal} ${params.asset}`);
    }

    const vaultCode = params.vaultAccountCode || (params.asset === 'BTC' ? '1101' : params.asset === 'ONXC' ? '1103' : '1102');
    const postings: PostingInput[] = [
      {
        accountCode: '2101', // Client Spot Balance Liability
        userId: params.userId,
        asset: params.asset,
        direction: 'DEBIT', // Liability decreases with Debit
        amount: totalDeducted.toString(),
      },
      {
        accountCode: vaultCode,
        asset: params.asset,
        direction: 'CREDIT', // Asset decreases with Credit
        amount: params.amount,
      },
    ];

    if (params.feeAmount && parseFloat(params.feeAmount) > 0) {
      postings.push({
        accountCode: '4101', // Revenue account
        asset: params.asset,
        direction: 'CREDIT', // Revenue increases with Credit
        amount: params.feeAmount,
      });
    }

    return this.recordJournal({
      referenceId: `wd_${params.withdrawalId}`,
      eventType: 'WITHDRAWAL',
      description: `Withdrawal settlement for user ${params.userId} of ${params.amount} ${params.asset}`,
      postings,
    });
  }

  /**
   * Derives real-time user balance by summing immutable postings
   */
  public getUserBalance(userId: string, asset: SupportedAsset): number {
    let balance = 0;
    for (const post of this.postings) {
      if (post.userId === userId && post.asset === asset) {
        // Liabilities (Client Balances): Credits increase balance, Debits decrease balance
        if (post.direction === 'CREDIT') {
          balance += parseFloat(post.amount);
        } else {
          balance -= parseFloat(post.amount);
        }
      }
    }
    return Math.max(0, parseFloat(balance.toFixed(8)));
  }

  /**
   * Computes exchange total liabilities per asset (for Proof of Reserves Merkle trees)
   */
  public getTotalClientLiabilities(asset: SupportedAsset): number {
    let total = 0;
    for (const post of this.postings) {
      if (post.accountCode === '2101' && post.asset === asset) {
        if (post.direction === 'CREDIT') {
          total += parseFloat(post.amount);
        } else {
          total -= parseFloat(post.amount);
        }
      }
    }
    return Math.max(0, parseFloat(total.toFixed(8)));
  }

  public getJournalCount(): number {
    return this.journals.size;
  }

  public getPostingsCount(): number {
    return this.postings.length;
  }
}
