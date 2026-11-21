import crypto from 'node:crypto';
import {
  createCloudEvent,
  EventTypes,
  type CloudEvent,
  type WalletDepositDetectedPayload,
} from '../domain/events.js';
import type {
  WalletAccount,
  AssetBalance,
  LedgerEntry,
  ShieldedNote,
  SupportedAsset,
} from '../domain/types.js';

export class WalletService {
  private accounts = new Map<string, WalletAccount>();
  private ledgers = new Map<string, LedgerEntry[]>(); // accountId -> entries
  private shieldedNotes = new Map<string, ShieldedNote>(); // commitment -> note
  private outbox: CloudEvent<any>[] = [];

  /**
   * Creates a sovereign wallet account for a user
   */
  public createAccount(userId: string): { account: WalletAccount; event: CloudEvent<any> } {
    const accountId = `wlt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const address = `0x${crypto.randomBytes(20).toString('hex')}`;

    const account: WalletAccount = {
      id: accountId,
      userId,
      address,
      createdAt: new Date().toISOString(),
    };

    this.accounts.set(account.id, account);
    this.ledgers.set(account.id, []);

    const event = createCloudEvent({
      type: EventTypes.WALLET_ACCOUNT_CREATED,
      source: 'https://api.oenexa.com/v1/wallet',
      data: { accountId: account.id, userId, address: account.address },
      subject: userId,
    });

    this.outbox.push(event);
    return { account, event };
  }

  /**
   * Records a detected on-chain or fiat deposit (Credit)
   */
  public recordDeposit(params: {
    accountId: string;
    asset: SupportedAsset;
    amount: string;
    txHash: string;
    confirmations: number;
  }): { entry: LedgerEntry; event: CloudEvent<any> } {
    const depAmount = parseFloat(params.amount);
    if (isNaN(depAmount) || depAmount <= 0) {
      throw new Error('Deposit amount must be greater than zero.');
    }
    const account = this.accounts.get(params.accountId);
    if (!account) {
      throw new Error(`Wallet account '${params.accountId}' not found.`);
    }

    const entry: LedgerEntry = {
      id: `led_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      accountId: account.id,
      asset: params.asset,
      type: 'CREDIT',
      amount: params.amount,
      referenceId: params.txHash,
      timestamp: new Date().toISOString(),
    };

    this.ledgers.get(account.id)?.push(entry);

    const payload: WalletDepositDetectedPayload = {
      accountId: account.id,
      asset: params.asset,
      amount: params.amount,
      txHash: params.txHash,
      confirmations: params.confirmations,
    };

    const event = createCloudEvent({
      type: EventTypes.WALLET_DEPOSIT_DETECTED,
      source: 'https://api.oenexa.com/v1/wallet',
      data: payload,
      subject: account.id,
    });

    this.outbox.push(event);
    return { entry, event };
  }

  /**
   * Calculates net balance from immutable ledger entries (Credit - Debit)
   */
  public getBalance(accountId: string, asset: SupportedAsset): AssetBalance {
    const entries = this.ledgers.get(accountId) || [];
    let net = 0;

    for (const entry of entries) {
      if (entry.asset === asset) {
        const val = parseFloat(entry.amount);
        if (entry.type === 'CREDIT') {
          net += val;
        } else {
          net -= val;
        }
      }
    }

    return {
      asset,
      available: net.toFixed(4),
      locked: '0.0000',
      total: net.toFixed(4),
    };
  }

  /**
   * Executes a withdrawal request (Debit)
   */
  public withdraw(params: {
    accountId: string;
    asset: SupportedAsset;
    amount: string;
    destinationAddress: string;
  }): { entry: LedgerEntry; event: CloudEvent<any> } {
    const bal = this.getBalance(params.accountId, params.asset);
    const requested = parseFloat(params.amount);
    const available = parseFloat(bal.available);

    if (isNaN(requested) || requested <= 0) {
      throw new Error('Withdrawal amount must be greater than zero.');
    }
    if (requested > available) {
      throw new Error(`Insufficient funds: requested ${requested} ${params.asset}, available ${available} ${params.asset}.`);
    }

    const entry: LedgerEntry = {
      id: `led_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      accountId: params.accountId,
      asset: params.asset,
      type: 'DEBIT',
      amount: params.amount,
      referenceId: `wd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
    };

    this.ledgers.get(params.accountId)?.push(entry);

    const event = createCloudEvent({
      type: EventTypes.WALLET_WITHDRAWAL_SETTLED,
      source: 'https://api.oenexa.com/v1/wallet',
      data: {
        accountId: params.accountId,
        asset: params.asset,
        amount: params.amount,
        destinationAddress: params.destinationAddress,
        ledgerId: entry.id,
      },
      subject: params.accountId,
    });

    this.outbox.push(event);
    return { entry, event };
  }

  /**
   * Creates a Quantum Shielded Note commitment
   */
  public createShieldedNote(params: {
    accountId: string;
    asset: SupportedAsset;
    amount: string;
  }): ShieldedNote {
    const nullifier = crypto.randomBytes(32).toString('hex');
    const secretTrapdoor = crypto.randomBytes(32).toString('hex');

    const commitment = crypto
      .createHash('sha256')
      .update(`${params.asset}:${params.amount}:${nullifier}:${secretTrapdoor}`)
      .digest('hex');

    const nullifierHash = crypto.createHash('sha256').update(nullifier).digest('hex');

    const note: ShieldedNote = {
      commitment,
      nullifierHash,
      asset: params.asset,
      amount: params.amount,
      timestamp: new Date().toISOString(),
      spent: false,
    };

    this.shieldedNotes.set(commitment, note);
    return note;
  }

  public getOutbox(): CloudEvent<any>[] {
    return [...this.outbox];
  }
}
