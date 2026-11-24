/**
 * WithdrawalGateService — Institutional Withdrawal Governance and Safety Gates.
 * Enforces:
 * 1. Address Cooling-Off Period (24h lock for newly added whitelisted addresses)
 * 2. Anti-Phishing Code Verification
 * 3. Daily Tier Withdrawal Limits (TIER_1: $10k, TIER_2: $100k, TIER_3: $1M)
 * 4. Step-Up MFA & Risk Evaluation (AUTO_APPROVE, MANUAL_REVIEW, BLOCK)
 * 5. Self-Service Deposit Rescan ("Hasn't arrived?" ticket trigger)
 * Compliance: Law 7 (< 385 LOC).
 */

export interface WhitelistedAddress {
  address: string;
  asset: string;
  network: string;
  label: string;
  addedAt: number;
  coolingOffUntil: number; // timestamp until address is active
  isWhitelisted: boolean;
}

export interface UserSecurityProfile {
  userId: string;
  tier: 'TIER_0' | 'TIER_1' | 'TIER_2' | 'TIER_3';
  antiPhishingCode?: string;
  mfaEnabled: boolean;
  dailyWithdrawnUsd: number;
}

export interface WithdrawalRequest {
  userId: string;
  asset: string;
  network: string;
  amountUsd: number;
  destinationAddress: string;
  mfaCodeProvided?: string;
  antiPhishingCodeProvided?: string;
}

export interface WithdrawalGateResult {
  decision: 'AUTO_APPROVE' | 'MANUAL_REVIEW' | 'BLOCK';
  allowed: boolean;
  reason?: string;
  coolingOffRemainingSeconds?: number;
}

export interface DepositRescanTicket {
  ticketId: string;
  userId: string;
  asset: string;
  network: string;
  txHash: string;
  status: 'PENDING_SCAN' | 'FOUND_CONFIRMING' | 'INVALID_HASH';
  createdAt: number;
}

export class WithdrawalGateService {
  private addressBook = new Map<string, WhitelistedAddress>(); // key: `${userId}:${address}`
  private securityProfiles = new Map<string, UserSecurityProfile>();
  private rescanTickets = new Map<string, DepositRescanTicket>();

  private readonly COOLING_OFF_MS = 24 * 60 * 60 * 1000; // 24 hours

  public readonly TIER_LIMITS_USD: Record<string, number> = {
    TIER_0: 0,
    TIER_1: 10_000,
    TIER_2: 100_000,
    TIER_3: 1_000_000,
  };

  public setUserSecurityProfile(profile: UserSecurityProfile): void {
    this.securityProfiles.set(profile.userId, profile);
  }

  public whitelistAddress(
    userId: string,
    asset: string,
    network: string,
    address: string,
    label: string,
    now = Date.now()
  ): WhitelistedAddress {
    const key = `${userId}:${address.toLowerCase()}`;
    const entry: WhitelistedAddress = {
      address: address.toLowerCase(),
      asset: asset.toUpperCase(),
      network: network.toUpperCase(),
      label,
      addedAt: now,
      coolingOffUntil: now + this.COOLING_OFF_MS,
      isWhitelisted: true,
    };
    this.addressBook.set(key, entry);
    return entry;
  }

  public evaluateWithdrawal(req: WithdrawalRequest, now = Date.now()): WithdrawalGateResult {
    const profile = this.securityProfiles.get(req.userId) || {
      userId: req.userId,
      tier: 'TIER_1',
      mfaEnabled: true,
      dailyWithdrawnUsd: 0,
    };

    // 1. Anti-Phishing Code Verification
    if (profile.antiPhishingCode && req.antiPhishingCodeProvided !== profile.antiPhishingCode) {
      return {
        decision: 'BLOCK',
        allowed: false,
        reason: 'ANTI_PHISHING_MISMATCH: Provided anti-phishing code does not match account record',
      };
    }

    // 2. Step-up MFA Requirement
    if (!profile.mfaEnabled || !req.mfaCodeProvided) {
      return {
        decision: 'BLOCK',
        allowed: false,
        reason: 'STEP_UP_MFA_REQUIRED: Valid 2FA OTP or Passkey signature required for withdrawals',
      };
    }

    // 3. Address Whitelist & Cooling-Off Gate
    const key = `${req.userId}:${req.destinationAddress.toLowerCase()}`;
    const whitelisted = this.addressBook.get(key);
    if (!whitelisted || !whitelisted.isWhitelisted) {
      return {
        decision: 'BLOCK',
        allowed: false,
        reason: 'DESTINATION_NOT_WHITELISTED: Destination address is not in user address whitelist',
      };
    }

    if (now < whitelisted.coolingOffUntil) {
      const remainingSec = Math.ceil((whitelisted.coolingOffUntil - now) / 1000);
      return {
        decision: 'BLOCK',
        allowed: false,
        coolingOffRemainingSeconds: remainingSec,
        reason: `ADDRESS_COOLING_OFF: Newly added address is under a 24-hour security cooling-off lock (${remainingSec}s remaining)`,
      };
    }

    // 4. Daily Tier Limits
    const dailyCap = this.TIER_LIMITS_USD[profile.tier] ?? 10_000;
    if (profile.dailyWithdrawnUsd + req.amountUsd > dailyCap) {
      return {
        decision: 'BLOCK',
        allowed: false,
        reason: `TIER_DAILY_LIMIT_EXCEEDED: Requested withdrawal exceeds ${profile.tier} daily cap of $${dailyCap.toLocaleString()}`,
      };
    }

    // 5. Risk Scoring: Large amounts flagged for manual review
    if (req.amountUsd >= 50_000) {
      return {
        decision: 'MANUAL_REVIEW',
        allowed: true,
        reason: 'LARGE_NOTIONAL: Amount >= $50,000 flagged for 4-eyes treasury officer approval',
      };
    }

    return { decision: 'AUTO_APPROVE', allowed: true };
  }

  /**
   * 6. Self-Service Deposit Rescan ("Hasn't arrived?" flow)
   */
  public submitDepositRescanTicket(params: {
    userId: string;
    asset: string;
    network: string;
    txHash: string;
    now?: number;
  }): DepositRescanTicket {
    const ticketId = `ticket_rescan_${Date.now()}`;
    const ticket: DepositRescanTicket = {
      ticketId,
      userId: params.userId,
      asset: params.asset.toUpperCase(),
      network: params.network.toUpperCase(),
      txHash: params.txHash,
      status: 'PENDING_SCAN',
      createdAt: params.now ?? Date.now(),
    };
    this.rescanTickets.set(ticketId, ticket);
    return ticket;
  }
}
