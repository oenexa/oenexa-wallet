export interface TransactionPatternContext {
  userId: string;
  asset: string;
  amount: number;
  fiatValueUsd: number;
  destinationAddress: string;
  timestamp: number;
}

export interface FraudDecision {
  status: 'CLEARED' | 'SUSPENDED_REVIEW' | 'REJECTED_AML';
  riskScore: number;
  flags: string[];
  requiresManualReview: boolean;
}

export class TransactionFraudGuard {
  private userHistories = new Map<string, TransactionPatternContext[]>();
  private blacklistedSanctionAddresses = new Set<string>([
    '0x7F3672D1AC762553f1046075239955E73f71F3bC', // OFAC Specially Designated Nationals
    'bc1qa5wkgaew2dkv56kfvj49j0av5nml45x9ek9hz6', // Ransomware Syndicate
    'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', // High-Risk Darknet Mixer
  ]);

  private readonly STRUCTURING_LOWER_BOUND_USD = 8500;
  private readonly STRUCTURING_UPPER_BOUND_USD = 9999;
  private readonly RAPID_BURST_MAX_COUNT = 4;
  private readonly RAPID_BURST_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

  public evaluateTransaction(tx: TransactionPatternContext): FraudDecision {
    const flags: string[] = [];
    let riskScore = 0;

    // 1. OFAC / Sanctions Blacklist Check
    if (this.blacklistedSanctionAddresses.has(tx.destinationAddress)) {
      return {
        status: 'REJECTED_AML',
        riskScore: 100,
        flags: ['OFAC_SANCTIONED_ADDRESS_DIRECT_HIT'],
        requiresManualReview: true,
      };
    }

    // 2. Structuring / Smurfing Detection ($8,500 - $9,999 under FATF $10k reporting limit)
    if (tx.fiatValueUsd >= this.STRUCTURING_LOWER_BOUND_USD && tx.fiatValueUsd <= this.STRUCTURING_UPPER_BOUND_USD) {
      riskScore += 45;
      flags.push('POTENTIAL_STRUCTURING_SUB_10K');
    }

    // 3. High-Velocity Rapid Burst Transactions
    const history = this.userHistories.get(tx.userId) || [];
    const recentWindowTxs = history.filter((h) => tx.timestamp - h.timestamp <= this.RAPID_BURST_WINDOW_MS);

    if (recentWindowTxs.length >= this.RAPID_BURST_MAX_COUNT) {
      riskScore += 40;
      flags.push(`VELOCITY_BURST_${recentWindowTxs.length}_TXS_IN_10M`);
    }

    // 4. Cumulative 24h Volume Spike
    const oneDayAgo = tx.timestamp - 24 * 60 * 60 * 1000;
    const dailyTxs = history.filter((h) => h.timestamp >= oneDayAgo);
    const cumulativeDailyUsd = dailyTxs.reduce((sum, item) => sum + item.fiatValueUsd, 0) + tx.fiatValueUsd;

    if (cumulativeDailyUsd > 250000) {
      riskScore += 35;
      flags.push(`HIGH_DAILY_OUTFLOW_EXCEEDED_${Math.round(cumulativeDailyUsd)}_USD`);
    }

    // Append to in-memory sliding history
    history.push(tx);
    // Keep max 50 entries
    if (history.length > 50) history.shift();
    this.userHistories.set(tx.userId, history);

    const normalizedScore = Math.min(100, riskScore);

    if (normalizedScore >= 75) {
      return {
        status: 'REJECTED_AML',
        riskScore: normalizedScore,
        flags,
        requiresManualReview: true,
      };
    } else if (normalizedScore >= 35) {
      return {
        status: 'SUSPENDED_REVIEW',
        riskScore: normalizedScore,
        flags,
        requiresManualReview: true,
      };
    }

    return {
      status: 'CLEARED',
      riskScore: normalizedScore,
      flags,
      requiresManualReview: false,
    };
  }

  public addSanctionedAddress(address: string): void {
    this.blacklistedSanctionAddresses.add(address);
  }
}
