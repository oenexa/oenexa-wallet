import { describe, it, expect } from 'vitest';
import { DigitalAssetRegistry } from '../registry/DigitalAssetRegistry.js';

describe('Sovereign & Institutional Digital Asset Registry', () => {
  const registry = DigitalAssetRegistry.getInstance();

  it('contains comprehensive sovereign, major crypto, stablecoins, and DeFi assets', () => {
    expect(registry.getTotalCount()).toBeGreaterThanOrEqual(15);

    const onxc = registry.getAsset('ONXC');
    expect(onxc?.name).toContain('Oenexa Sovereign');
    expect(onxc?.decimals).toBe(18);

    const btc = registry.getAsset('BTC');
    expect(btc?.decimals).toBe(8);

    const usdt = registry.getAsset('USDT');
    expect(usdt?.networks.length).toBeGreaterThanOrEqual(3); // TRC20, ERC20, BEP20
  });

  it('validates Ethereum and EVM-compatible addresses', () => {
    const validEth = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
    const invalidEth = '0xnotAnAddress';

    expect(registry.validateAddress('ETH', 'ETHEREUM', validEth).valid).toBe(true);
    expect(registry.validateAddress('ETH', 'ETHEREUM', invalidEth).valid).toBe(false);
    expect(registry.validateAddress('USDT', 'ERC20', validEth).valid).toBe(true);
  });

  it('validates Bitcoin SegWit and Legacy addresses', () => {
    const segwit = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    const legacy = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
    const badBtc = '0x1234567890123456789012345678901234567890';

    expect(registry.validateAddress('BTC', 'BITCOIN', segwit).valid).toBe(true);
    expect(registry.validateAddress('BTC', 'BITCOIN', legacy).valid).toBe(true);
    expect(registry.validateAddress('BTC', 'BITCOIN', badBtc).valid).toBe(false);
  });

  it('validates TRON TRC-20 addresses', () => {
    const validTron = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    const badTron = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

    expect(registry.validateAddress('USDT', 'TRC20', validTron).valid).toBe(true);
    expect(registry.validateAddress('USDT', 'TRC20', badTron).valid).toBe(false);
  });

  it('validates Solana SPL addresses', () => {
    const validSol = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    expect(registry.validateAddress('SOL', 'SOLANA', validSol).valid).toBe(true);
    expect(registry.validateAddress('USDC', 'SOLANA', validSol).valid).toBe(true);
  });

  it('enforces destination tag and memo requirements for XRPL', () => {
    expect(registry.requiresTag('XRP', 'XRPL')).toBe(true);
    expect(registry.requiresTag('BTC', 'BITCOIN')).toBe(false);
    expect(registry.requiresTag('ETH', 'ETHEREUM')).toBe(false);
  });

  it('resolves block confirmation rules and network fees per chain', () => {
    expect(registry.getConfirmationsRequired('ONXC', 'OENEXA')).toBe(1);
    expect(registry.getConfirmationsRequired('BTC', 'BITCOIN')).toBe(2);
    expect(registry.getConfirmationsRequired('USDT', 'TRC20')).toBe(12);

    expect(parseFloat(registry.getWithdrawalFee('ONXC', 'OENEXA'))).toBeGreaterThan(0);
    expect(parseFloat(registry.getWithdrawalFee('USDT', 'TRC20'))).toBeGreaterThan(0);
  });
});
