/**
 * OENEXA Production Blockchain Deposit Confirmation Listener Engine
 * Multi-chain block indexer & confirmation watcher with idempotency
 * and chain-reorganization protection.
 * Conforms to Inviolable Law 7 (< 385 LOC).
 */

import crypto from 'node:crypto';
import type { SupportedAsset } from '../domain/types.js';

export type DepositStatus = 'DETECTED' | 'CONFIRMING' | 'CONFIRMED' | 'REORGED';

export interface ChainConfig {
  network: string;
  requiredConfirmations: number;
  blockTimeMs: number;
  finalityBlocks: number;
}

export interface IngestedDepositEvent {
  id: string;
  network: string;
  asset: SupportedAsset;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string;
  destinationAddress: string;
  amount: string;
  confirmations: number;
  status: DepositStatus;
  detectedAt: string;
  settledAt?: string;
}

export class BlockchainDepositListener {
  private deposits = new Map<string, IngestedDepositEvent>(); // compositeKey -> event
  private userAccounts = new Map<string, string>(); // depositAddress -> accountId
  private processedTransactions = new Set<string>(); // idempotency guard

  private readonly CHAIN_RULES: Record<string, ChainConfig> = {
    BITCOIN: { network: 'BITCOIN', requiredConfirmations: 2, blockTimeMs: 600_000, finalityBlocks: 6 },
    ETHEREUM: { network: 'ETHEREUM', requiredConfirmations: 12, blockTimeMs: 12_000, finalityBlocks: 32 },
    TRON: { network: 'TRON', requiredConfirmations: 12, blockTimeMs: 3_000, finalityBlocks: 19 },
    SOLANA: { network: 'SOLANA', requiredConfirmations: 32, blockTimeMs: 400, finalityBlocks: 32 },
    ONXC_L1: { network: 'ONXC_L1', requiredConfirmations: 1, blockTimeMs: 400, finalityBlocks: 1 },
  };

  /**
   * Registers a monitored address derived from the MPC vault
   */
  public registerMonitoredAddress(address: string, accountId: string): void {
    this.userAccounts.set(address.toLowerCase(), accountId);
  }

  /**
   * Ingests an on-chain transfer event emitted by node or indexer
   */
  public ingestOnChainEvent(params: {
    network: string;
    asset: SupportedAsset;
    txHash: string;
    logIndex?: number;
    blockNumber: number;
    blockHash: string;
    destinationAddress: string;
    amount: string;
    currentBlockHeight: number;
  }): IngestedDepositEvent {
    if (!params.destinationAddress || params.destinationAddress.trim() === '') {
      throw new Error('Destination address cannot be empty.');
    }
    const numAmount = parseFloat(params.amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('Deposit amount must be a positive number.');
    }

    const logIdx = params.logIndex ?? 0;
    const compositeKey = `${params.network}:${params.txHash}:${logIdx}`;

    // Idempotency: Reject already settled duplicates
    if (this.processedTransactions.has(compositeKey)) {
      const existing = this.deposits.get(compositeKey);
      if (existing && existing.status === 'CONFIRMED') {
        return existing;
      }
    }

    const chain = this.CHAIN_RULES[params.network] || {
      network: params.network,
      requiredConfirmations: 6,
      blockTimeMs: 10_000,
      finalityBlocks: 12,
    };

    const confirmations = Math.max(0, params.currentBlockHeight - params.blockNumber + 1);
    let status: DepositStatus = 'DETECTED';

    if (confirmations >= chain.requiredConfirmations) {
      status = 'CONFIRMED';
      this.processedTransactions.add(compositeKey);
    } else if (confirmations > 0) {
      status = 'CONFIRMING';
    }

    const event: IngestedDepositEvent = {
      id: `dep_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      network: params.network,
      asset: params.asset,
      txHash: params.txHash,
      logIndex: logIdx,
      blockNumber: params.blockNumber,
      blockHash: params.blockHash,
      destinationAddress: params.destinationAddress,
      amount: params.amount,
      confirmations,
      status,
      detectedAt: new Date().toISOString(),
      settledAt: status === 'CONFIRMED' ? new Date().toISOString() : undefined,
    };

    this.deposits.set(compositeKey, event);
    return event;
  }

  /**
   * Updates block height and advances confirmation status for pending deposits
   */
  public advanceChainHeight(network: string, newHeight: number): IngestedDepositEvent[] {
    const updated: IngestedDepositEvent[] = [];
    const chain = this.CHAIN_RULES[network];
    if (!chain) return updated;

    for (const [key, event] of this.deposits.entries()) {
      if (event.network === network && event.status !== 'CONFIRMED' && event.status !== 'REORGED') {
        event.confirmations = Math.max(0, newHeight - event.blockNumber + 1);

        if (event.confirmations >= chain.requiredConfirmations) {
          event.status = 'CONFIRMED';
          event.settledAt = new Date().toISOString();
          this.processedTransactions.add(key);
        } else {
          event.status = 'CONFIRMING';
        }

        this.deposits.set(key, event);
        updated.push(event);
      }
    }

    return updated;
  }

  /**
   * Handles chain reorganizations (reorg detection)
   */
  public handleBlockReorg(params: {
    network: string;
    reorgedBlockNumber: number;
    newBlockHash: string;
  }): IngestedDepositEvent[] {
    const affected: IngestedDepositEvent[] = [];

    for (const [key, event] of this.deposits.entries()) {
      if (event.network === params.network && event.blockNumber >= params.reorgedBlockNumber) {
        // If not finalized yet, mark as REORGED to halt settlement
        const chain = this.CHAIN_RULES[params.network];
        if (event.confirmations < (chain?.finalityBlocks ?? 12)) {
          event.status = 'REORGED';
          event.settledAt = undefined;
          this.processedTransactions.delete(key);
          affected.push(event);
        }
      }
    }

    return affected;
  }

  /**
   * Retrieves pending deposits for a monitored address
   */
  public getPendingDepositsForAddress(address: string): IngestedDepositEvent[] {
    const results: IngestedDepositEvent[] = [];
    for (const event of this.deposits.values()) {
      if (event.destinationAddress.toLowerCase() === address.toLowerCase() && event.status !== 'CONFIRMED') {
        results.push(event);
      }
    }
    return results;
  }
}
