/**
 * DigitalAssetRegistry — Sovereign & Institutional Digital Asset Registry.
 * Features:
 * - Multi-chain asset specifications (Ethereum, Bitcoin, Tron, Solana, Oenexa L1, XRPL, Cardano, etc.)
 * - Cryptographic address format regex validation per network
 * - Minimum deposit and withdrawal limits, network gas fees, and tag/memo requirements
 * - Required block confirmations per chain
 * Compliance: Law 7 (< 385 LOC).
 */

import { ASSETS_SOVEREIGN_AND_MAJOR, type DigitalAssetRecord, type NetworkConfig } from './data/assetsSovereignAndMajor.js';
import { ASSETS_ALTCOINS_AND_DEFI } from './data/assetsAltcoinsAndDefi.js';

export { type DigitalAssetRecord, type NetworkConfig } from './data/assetsSovereignAndMajor.js';

export class DigitalAssetRegistry {
  private static instance: DigitalAssetRegistry;
  private assets = new Map<string, DigitalAssetRecord>();

  constructor() {
    const all = [...ASSETS_SOVEREIGN_AND_MAJOR, ...ASSETS_ALTCOINS_AND_DEFI];
    for (const a of all) {
      this.assets.set(a.symbol.toUpperCase(), a);
    }
  }

  public static getInstance(): DigitalAssetRegistry {
    if (!DigitalAssetRegistry.instance) {
      DigitalAssetRegistry.instance = new DigitalAssetRegistry();
    }
    return DigitalAssetRegistry.instance;
  }

  public getAsset(symbol: string): DigitalAssetRecord | undefined {
    return this.assets.get(symbol.toUpperCase());
  }

  public getAllAssets(): DigitalAssetRecord[] {
    return Array.from(this.assets.values());
  }

  public getTotalCount(): number {
    return this.assets.size;
  }

  public getNetwork(symbol: string, networkId: string): NetworkConfig | undefined {
    const asset = this.getAsset(symbol);
    if (!asset) return undefined;
    return asset.networks.find((n) => n.networkId.toUpperCase() === networkId.toUpperCase());
  }

  /**
   * Validates blockchain destination or deposit address against network regex standards
   */
  public validateAddress(symbol: string, networkId: string, address: string): { valid: boolean; error?: string } {
    const network = this.getNetwork(symbol, networkId);
    if (!network) {
      return { valid: false, error: `Unsupported network '${networkId}' for asset '${symbol}'` };
    }

    const trimmed = address.trim();
    if (!trimmed) {
      return { valid: false, error: 'Address cannot be empty' };
    }

    if (!network.addressRegex.test(trimmed)) {
      return {
        valid: false,
        error: `INVALID_ADDRESS_FORMAT: Address does not conform to ${network.name} (${network.standard}) standards`,
      };
    }

    return { valid: true };
  }

  public getConfirmationsRequired(symbol: string, networkId: string): number {
    const network = this.getNetwork(symbol, networkId);
    return network ? network.minConfirmations : 12;
  }

  public requiresTag(symbol: string, networkId: string): boolean {
    const network = this.getNetwork(symbol, networkId);
    return network ? network.requiresTagOrMemo : false;
  }

  public getWithdrawalFee(symbol: string, networkId: string): string {
    const network = this.getNetwork(symbol, networkId);
    return network ? network.withdrawalFee : '0.0';
  }
}
