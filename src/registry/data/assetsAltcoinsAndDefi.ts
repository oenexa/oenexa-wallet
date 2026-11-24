/**
 * Altcoins, DeFi & Emerging Digital Assets
 * Compliance: Law 7 (< 385 LOC)
 */

import type { DigitalAssetRecord } from './assetsSovereignAndMajor.js';

export const ASSETS_ALTCOINS_AND_DEFI: DigitalAssetRecord[] = [
  {
    symbol: 'ADA',
    name: 'Cardano',
    assetClass: 'MAJOR_CRYPTO',
    decimals: 6,
    networks: [
      {
        networkId: 'CARDANO',
        name: 'Cardano Native Shelley',
        standard: 'NATIVE',
        minConfirmations: 15,
        minDeposit: '10.0',
        minWithdrawal: '20.0',
        withdrawalFee: '1.0',
        requiresTagOrMemo: false,
        addressRegex: /^addr1[a-z0-9]{50,100}$/,
      },
    ],
  },
  {
    symbol: 'AVAX',
    name: 'Avalanche C-Chain',
    assetClass: 'MAJOR_CRYPTO',
    decimals: 18,
    networks: [
      {
        networkId: 'AVAX_CCHAIN',
        name: 'Avalanche C-Chain (EVM)',
        standard: 'NATIVE',
        minConfirmations: 1,
        minDeposit: '0.1',
        minWithdrawal: '0.2',
        withdrawalFee: '0.01',
        requiresTagOrMemo: false,
        addressRegex: /^0x[a-fA-F0-9]{40}$/,
      },
    ],
  },
  {
    symbol: 'DOT',
    name: 'Polkadot',
    assetClass: 'MAJOR_CRYPTO',
    decimals: 10,
    networks: [
      {
        networkId: 'POLKADOT',
        name: 'Polkadot Relay Chain',
        standard: 'NATIVE',
        minConfirmations: 2,
        minDeposit: '1.0',
        minWithdrawal: '2.0',
        withdrawalFee: '0.1',
        requiresTagOrMemo: false,
        addressRegex: /^1[0-9a-zA-Z]{46,47}$/,
      },
    ],
  },
  {
    symbol: 'DOGE',
    name: 'Dogecoin',
    assetClass: 'MAJOR_CRYPTO',
    decimals: 8,
    networks: [
      {
        networkId: 'DOGECOIN',
        name: 'Dogecoin Native',
        standard: 'NATIVE',
        minConfirmations: 6,
        minDeposit: '20.0',
        minWithdrawal: '50.0',
        withdrawalFee: '5.0',
        requiresTagOrMemo: false,
        addressRegex: /^D{1}[5-9A-HJ-NP-U]{1}[1-9A-HJ-NP-Za-km-z]{32}$/,
      },
    ],
  },
  {
    symbol: 'LINK',
    name: 'Chainlink',
    assetClass: 'DEFI',
    decimals: 18,
    networks: [
      {
        networkId: 'ERC20',
        name: 'Ethereum (ERC-20)',
        standard: 'ERC20',
        contractAddress: '0x514910771af9ca656af840dff83e8264ecf986ca',
        minConfirmations: 12,
        minDeposit: '1.0',
        minWithdrawal: '2.0',
        withdrawalFee: '0.3',
        requiresTagOrMemo: false,
        addressRegex: /^0x[a-fA-F0-9]{40}$/,
      },
    ],
  },
  {
    symbol: 'DAI',
    name: 'MakerDAO Multi-Collateral DAI',
    assetClass: 'STABLECOIN',
    decimals: 18,
    networks: [
      {
        networkId: 'ERC20',
        name: 'Ethereum (ERC-20)',
        standard: 'ERC20',
        contractAddress: '0x6b175474e89094c44da98b954eedeac495271d0f',
        minConfirmations: 12,
        minDeposit: '10.0',
        minWithdrawal: '20.0',
        withdrawalFee: '3.0',
        requiresTagOrMemo: false,
        addressRegex: /^0x[a-fA-F0-9]{40}$/,
      },
    ],
  },
  {
    symbol: 'LTC',
    name: 'Litecoin',
    assetClass: 'MAJOR_CRYPTO',
    decimals: 8,
    networks: [
      {
        networkId: 'LITECOIN',
        name: 'Litecoin Native MWEB/SegWit',
        standard: 'NATIVE',
        minConfirmations: 6,
        minDeposit: '0.05',
        minWithdrawal: '0.1',
        withdrawalFee: '0.005',
        requiresTagOrMemo: false,
        addressRegex: /^(L|M|ltc1)[a-km-zA-HJ-NP-Z1-9]{26,43}$/,
      },
    ],
  },
  {
    symbol: 'EURC',
    name: 'Euro Coin (Circle)',
    assetClass: 'STABLECOIN',
    decimals: 6,
    networks: [
      {
        networkId: 'ERC20',
        name: 'Ethereum (ERC-20)',
        standard: 'ERC20',
        contractAddress: '0x1aba52e3a39c1ce690a11a0754af5557778b79f6',
        minConfirmations: 12,
        minDeposit: '10.0',
        minWithdrawal: '20.0',
        withdrawalFee: '3.0',
        requiresTagOrMemo: false,
        addressRegex: /^0x[a-fA-F0-9]{40}$/,
      },
    ],
  },
];
