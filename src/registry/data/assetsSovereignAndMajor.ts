/**
 * Sovereign & Major Institutional Digital Assets
 * Compliance: Law 7 (< 385 LOC)
 */

export interface NetworkConfig {
  networkId: string;
  name: string;
  standard: 'NATIVE' | 'ERC20' | 'TRC20' | 'BEP20' | 'SPL' | 'POST_QUANTUM_L1';
  contractAddress?: string;
  minConfirmations: number;
  minDeposit: string;
  minWithdrawal: string;
  withdrawalFee: string;
  requiresTagOrMemo: boolean;
  addressRegex: RegExp;
}

export interface DigitalAssetRecord {
  symbol: string;
  name: string;
  assetClass: 'SOVEREIGN_L1' | 'MAJOR_CRYPTO' | 'STABLECOIN' | 'DEFI';
  decimals: number;
  networks: NetworkConfig[];
}

export const ASSETS_SOVEREIGN_AND_MAJOR: DigitalAssetRecord[] = [
  {
    symbol: 'ONXC',
    name: 'Oenexa Sovereign Layer-1 (Post-Quantum)',
    assetClass: 'SOVEREIGN_L1',
    decimals: 18,
    networks: [
      {
        networkId: 'OENEXA',
        name: 'Oenexa Mainnet L1 (ML-DSA-65 / ML-KEM-768)',
        standard: 'POST_QUANTUM_L1',
        minConfirmations: 1,
        minDeposit: '1.0',
        minWithdrawal: '2.0',
        withdrawalFee: '0.01',
        requiresTagOrMemo: false,
        addressRegex: /^0x[a-fA-F0-9]{40}$/,
      },
    ],
  },
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    assetClass: 'MAJOR_CRYPTO',
    decimals: 8,
    networks: [
      {
        networkId: 'BITCOIN',
        name: 'Bitcoin Native SegWit / Taproot',
        standard: 'NATIVE',
        minConfirmations: 2,
        minDeposit: '0.0002',
        minWithdrawal: '0.001',
        withdrawalFee: '0.0003',
        requiresTagOrMemo: false,
        addressRegex: /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/,
      },
    ],
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    assetClass: 'MAJOR_CRYPTO',
    decimals: 18,
    networks: [
      {
        networkId: 'ETHEREUM',
        name: 'Ethereum Mainnet',
        standard: 'NATIVE',
        minConfirmations: 12,
        minDeposit: '0.005',
        minWithdrawal: '0.01',
        withdrawalFee: '0.002',
        requiresTagOrMemo: false,
        addressRegex: /^0x[a-fA-F0-9]{40}$/,
      },
    ],
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    assetClass: 'STABLECOIN',
    decimals: 6,
    networks: [
      {
        networkId: 'TRC20',
        name: 'TRON (TRC-20)',
        standard: 'TRC20',
        contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        minConfirmations: 12,
        minDeposit: '10.0',
        minWithdrawal: '20.0',
        withdrawalFee: '1.5',
        requiresTagOrMemo: false,
        addressRegex: /^T[a-km-zA-HJ-NP-Z1-9]{33}$/,
      },
      {
        networkId: 'ERC20',
        name: 'Ethereum (ERC-20)',
        standard: 'ERC20',
        contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        minConfirmations: 12,
        minDeposit: '20.0',
        minWithdrawal: '50.0',
        withdrawalFee: '4.0',
        requiresTagOrMemo: false,
        addressRegex: /^0x[a-fA-F0-9]{40}$/,
      },
      {
        networkId: 'BEP20',
        name: 'BNB Smart Chain (BEP-20)',
        standard: 'BEP20',
        contractAddress: '0x55d398326f99059ff775485246999027b3197955',
        minConfirmations: 15,
        minDeposit: '10.0',
        minWithdrawal: '20.0',
        withdrawalFee: '0.5',
        requiresTagOrMemo: false,
        addressRegex: /^0x[a-fA-F0-9]{40}$/,
      },
    ],
  },
  {
    symbol: 'USDC',
    name: 'USD Coin (Circle)',
    assetClass: 'STABLECOIN',
    decimals: 6,
    networks: [
      {
        networkId: 'ERC20',
        name: 'Ethereum (ERC-20)',
        standard: 'ERC20',
        contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        minConfirmations: 12,
        minDeposit: '20.0',
        minWithdrawal: '50.0',
        withdrawalFee: '3.5',
        requiresTagOrMemo: false,
        addressRegex: /^0x[a-fA-F0-9]{40}$/,
      },
      {
        networkId: 'SOLANA',
        name: 'Solana (SPL)',
        standard: 'SPL',
        contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        minConfirmations: 1,
        minDeposit: '10.0',
        minWithdrawal: '20.0',
        withdrawalFee: '1.0',
        requiresTagOrMemo: false,
        addressRegex: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
      },
    ],
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    assetClass: 'MAJOR_CRYPTO',
    decimals: 9,
    networks: [
      {
        networkId: 'SOLANA',
        name: 'Solana Native',
        standard: 'NATIVE',
        minConfirmations: 1,
        minDeposit: '0.1',
        minWithdrawal: '0.2',
        withdrawalFee: '0.005',
        requiresTagOrMemo: false,
        addressRegex: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
      },
    ],
  },
  {
    symbol: 'XRP',
    name: 'XRP Ledger',
    assetClass: 'MAJOR_CRYPTO',
    decimals: 6,
    networks: [
      {
        networkId: 'XRPL',
        name: 'XRP Ledger Native',
        standard: 'NATIVE',
        minConfirmations: 1,
        minDeposit: '10.0',
        minWithdrawal: '20.0',
        withdrawalFee: '0.1',
        requiresTagOrMemo: true,
        addressRegex: /^r[0-9a-zA-Z]{24,34}$/,
      },
    ],
  },
];
