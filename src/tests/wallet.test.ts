import { describe, it, expect } from 'vitest';
import { WalletService } from '../service/WalletService.js';
import { EventTypes } from '../domain/events.js';

describe('OENEXA Wallet Service & Custody Ledger', () => {
  it('creates wallet account and dispatches CloudEvent', () => {
    const service = new WalletService();
    const result = service.createAccount('usr_109283');

    expect(result.account.id.startsWith('wlt_')).toBe(true);
    expect(result.account.address.startsWith('0x')).toBe(true);
    expect(result.event.type).toBe(EventTypes.WALLET_ACCOUNT_CREATED);
    expect(service.getOutbox()).toHaveLength(1);
  });

  it('records deposit and updates double-entry balance', () => {
    const service = new WalletService();
    const { account } = service.createAccount('usr_991823');

    service.recordDeposit({
      accountId: account.id,
      asset: 'ONXC',
      amount: '500.0000',
      txHash: '0xabc123789',
      confirmations: 12,
    });

    const bal = service.getBalance(account.id, 'ONXC');
    expect(bal.available).toBe('500.0000');
    expect(bal.total).toBe('500.0000');
  });

  it('handles withdrawal debit and rejects when balance insufficient', () => {
    const service = new WalletService();
    const { account } = service.createAccount('usr_338192');

    service.recordDeposit({
      accountId: account.id,
      asset: 'USDT',
      amount: '1000.0000',
      txHash: '0xdep1',
      confirmations: 10,
    });

    service.withdraw({
      accountId: account.id,
      asset: 'USDT',
      amount: '400.0000',
      destinationAddress: '0xext99',
    });

    const bal = service.getBalance(account.id, 'USDT');
    expect(bal.available).toBe('600.0000');

    expect(() => {
      service.withdraw({
        accountId: account.id,
        asset: 'USDT',
        amount: '700.0000',
        destinationAddress: '0xext99',
      });
    }).toThrow(/Insufficient funds/);
  });

  it('generates quantum shielded note commitment and nullifier hash', () => {
    const service = new WalletService();
    const { account } = service.createAccount('usr_privacy_1');

    const note = service.createShieldedNote({
      accountId: account.id,
      asset: 'ONXC',
      amount: '250.0000',
    });

    expect(note.commitment).toHaveLength(64);
    expect(note.nullifierHash).toHaveLength(64);
    expect(note.spent).toBe(false);
  });
});
