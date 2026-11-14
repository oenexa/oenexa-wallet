export type SupportedAsset = 'ONXC' | 'USDT' | 'BTC' | 'ETH' | 'EUR';

export interface WalletAccount {
  id: string;
  userId: string;
  address: string;
  createdAt: string;
}

export interface AssetBalance {
  asset: SupportedAsset;
  available: string;
  locked: string;
  total: string;
}

export interface LedgerEntry {
  id: string;
  accountId: string;
  asset: SupportedAsset;
  type: 'DEBIT' | 'CREDIT';
  amount: string;
  referenceId: string;
  timestamp: string;
}

export interface ShieldedNote {
  commitment: string;
  nullifierHash: string;
  asset: SupportedAsset;
  amount: string;
  timestamp: string;
  spent: boolean;
}
