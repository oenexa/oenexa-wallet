/**
 * OENEXA Cryptographic Proof of Reserves (PoR) & Merkle Solvency Engine
 * Generates Merkle liability trees, publishes attestation roots,
 * and produces verifiable inclusion proofs for end users.
 * Conforms to Inviolable Law 7 (< 385 LOC).
 */

import crypto from 'node:crypto';
import type { SupportedAsset } from '../domain/types.js';

export interface UserLiabilityRecord {
  userId: string;
  asset: SupportedAsset;
  amount: string;
  salt: string;
}

export interface MerkleProofStep {
  position: 'left' | 'right';
  hash: string;
}

export interface MerkleInclusionProof {
  userId: string;
  asset: SupportedAsset;
  amount: string;
  salt: string;
  leafHash: string;
  merkleRoot: string;
  path: MerkleProofStep[];
  timestamp: string;
}

export interface ReserveAttestation {
  epochId: string;
  merkleRoot: string;
  totalLiabilitiesUSD: number;
  totalReservesUSD: number;
  reserveRatioPercentage: number;
  onChainContractAddress: string;
  timestamp: string;
  auditorSignature: string;
}

export class ProofOfReservesService {
  private attestations: ReserveAttestation[] = [];
  private currentLeaves: { leafHash: string; record: UserLiabilityRecord }[] = [];
  private treeLevels: string[][] = [];

  /**
   * Hashes an individual user liability entry into a cryptographic leaf
   */
  public computeLeafHash(record: UserLiabilityRecord): string {
    return crypto.createHash('sha256')
      .update(`${record.userId}:${record.asset}:${record.amount}:${record.salt}`)
      .digest('hex');
  }

  /**
   * Builds a complete Merkle liability tree from user accounts
   */
  public buildMerkleTree(records: UserLiabilityRecord[]): string {
    if (records.length === 0) {
      throw new Error('Cannot build Merkle tree from empty liabilities.');
    }

    this.currentLeaves = records.map((r) => ({
      leafHash: this.computeLeafHash(r),
      record: r,
    }));

    let currentLevel = this.currentLeaves.map((l) => l.leafHash);
    this.treeLevels = [currentLevel];

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          const combined = currentLevel[i] + currentLevel[i + 1];
          nextLevel.push(crypto.createHash('sha256').update(combined).digest('hex'));
        } else {
          // Odd leaf is duplicated to maintain binary balance
          const combined = currentLevel[i] + currentLevel[i];
          nextLevel.push(crypto.createHash('sha256').update(combined).digest('hex'));
        }
      }
      this.treeLevels.push(nextLevel);
      currentLevel = nextLevel;
    }

    return currentLevel[0];
  }

  /**
   * Generates a cryptographic inclusion proof for a specific user
   */
  public generateInclusionProof(userId: string, asset: SupportedAsset): MerkleInclusionProof {
    const leafIndex = this.currentLeaves.findIndex(
      (l) => l.record.userId === userId && l.record.asset === asset
    );

    if (leafIndex === -1) {
      throw new Error(`Liability record for user '${userId}' and asset '${asset}' not found in current epoch.`);
    }

    const targetLeaf = this.currentLeaves[leafIndex];
    const path: MerkleProofStep[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.treeLevels.length - 1; level++) {
      const currentLevelNodes = this.treeLevels[level];
      const isEven = currentIndex % 2 === 0;
      const siblingIndex = isEven ? currentIndex + 1 : currentIndex - 1;

      if (siblingIndex < currentLevelNodes.length) {
        path.push({
          position: isEven ? 'right' : 'left',
          hash: currentLevelNodes[siblingIndex],
        });
      } else {
        // Sibling is the duplicate of self
        path.push({
          position: 'right',
          hash: currentLevelNodes[currentIndex],
        });
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      userId,
      asset,
      amount: targetLeaf.record.amount,
      salt: targetLeaf.record.salt,
      leafHash: targetLeaf.leafHash,
      merkleRoot: this.getRoot(),
      path,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Verifies an inclusion proof cryptographically
   */
  public verifyInclusionProof(proof: MerkleInclusionProof): boolean {
    let currentHash = proof.leafHash;

    for (const step of proof.path) {
      const combined = step.position === 'right' ? currentHash + step.hash : step.hash + currentHash;
      currentHash = crypto.createHash('sha256').update(combined).digest('hex');
    }

    return currentHash.toLowerCase() === proof.merkleRoot.toLowerCase();
  }

  /**
   * Publishes an official solvency attestation epoch
   */
  public publishAttestation(params: {
    totalLiabilitiesUSD: number;
    totalReservesUSD: number;
    onChainContractAddress?: string;
  }): ReserveAttestation {
    const root = this.getRoot();
    if (!root) {
      throw new Error('Cannot publish attestation without a computed Merkle root. Run buildMerkleTree() first.');
    }
    if (params.totalLiabilitiesUSD <= 0) {
      throw new Error('Total liabilities must be greater than zero.');
    }
    if (params.totalReservesUSD < 0) {
      throw new Error('Total reserves cannot be negative.');
    }
    const ratio = (params.totalReservesUSD / params.totalLiabilitiesUSD) * 100;

    const epochId = `por_epoch_${Date.now()}`;
    const signature = crypto.createHmac('sha256', 'OENEXA_AUDITOR_ECDSA_KEY_2026')
      .update(`${epochId}:${root}:${ratio}`)
      .digest('hex');

    const attestation: ReserveAttestation = {
      epochId,
      merkleRoot: root,
      totalLiabilitiesUSD: params.totalLiabilitiesUSD,
      totalReservesUSD: params.totalReservesUSD,
      reserveRatioPercentage: parseFloat(ratio.toFixed(2)),
      onChainContractAddress: params.onChainContractAddress || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      timestamp: new Date().toISOString(),
      auditorSignature: signature,
    };

    this.attestations.unshift(attestation);
    return attestation;
  }

  public getRoot(): string {
    if (this.treeLevels.length === 0) return '';
    return this.treeLevels[this.treeLevels.length - 1][0];
  }

  public getLatestAttestation(): ReserveAttestation | null {
    return this.attestations.length > 0 ? this.attestations[0] : null;
  }
}
