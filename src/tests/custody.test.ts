import { describe, it, expect } from 'vitest';
import { MpcVaultService } from '../service/MpcVaultService.js';
import { BlockchainDepositListener } from '../service/BlockchainDepositListener.js';
import { ProofOfReservesService, type UserLiabilityRecord } from '../service/ProofOfReservesService.js';

describe('Institutional MPC Custody & Vault Tiering Suite', () => {
  it('derives unique deterministic addresses per asset with post-quantum binding', () => {
    const mpc = new MpcVaultService();
    const btcAddr = mpc.deriveDepositAddress('usr_alice', 'BTC');
    const ethAddr = mpc.deriveDepositAddress('usr_alice', 'ETH');
    const onxcAddr = mpc.deriveDepositAddress('usr_alice', 'ONXC');

    expect(btcAddr.address.startsWith('bc1q')).toBe(true);
    expect(ethAddr.address.startsWith('0x')).toBe(true);
    expect(onxcAddr.network).toContain('Oenexa Layer-1');
    expect(onxcAddr.postQuantumKeyBinding?.startsWith('pq_')).toBe(true);

    // Deterministic: subsequent calls yield identical address
    const btcAgain = mpc.deriveDepositAddress('usr_alice', 'BTC');
    expect(btcAgain.address).toBe(btcAddr.address);
  });

  it('enforces 2-of-3 MPC threshold signing and KYC tier policies', () => {
    const mpc = new MpcVaultService();

    // Hot tier withdrawal: $5,000 USDT (KYC 1 sufficient)
    const session = mpc.initiateWithdrawalSession({
      userId: 'usr_alice',
      asset: 'USDT',
      amount: '5000',
      destination: '0xTarget99',
      userKycTier: 1,
    });

    expect(session.status).toBe('INITIATED');
    expect(session.tier).toBe('HOT');

    // Share 1: KMS
    mpc.submitKeyShare(session.sessionId, 'EXCHANGE_KMS');
    expect(session.status).toBe('INITIATED');

    // Share 2: Co-Signer -> Reaches Quorum
    mpc.submitKeyShare(session.sessionId, 'CO_SIGNER_POLICY');
    expect(session.status).toBe('SIGNED');
    expect(session.txHash?.startsWith('0x')).toBe(true);
  });

  it('rejects cold-tier withdrawal if user lacks required KYC tier', () => {
    const mpc = new MpcVaultService();

    expect(() => {
      mpc.initiateWithdrawalSession({
        userId: 'usr_bob',
        asset: 'BTC',
        amount: '250000', // WARM/COLD tier
        destination: 'bc1qtest',
        userKycTier: 1, // Only Tier 1, needs Tier 2 or 3
      });
    }).toThrow(/Tier policy violation/);
  });

  it('recommends vault sweep when hot wallet reserves exceed ceiling', () => {
    const mpc = new MpcVaultService();
    const sweep = mpc.evaluateVaultSweep(750_000); // $750k in hot wallet
    expect(sweep.needsSweep).toBe(true);
    expect(sweep.excessToWarm).toBe(250_000);
    expect(sweep.targetTier).toBe('WARM');
  });
});

describe('Production Blockchain Deposit Listener Suite', () => {
  it('ingests deposit and advances confirmation status to CONFIRMED', () => {
    const listener = new BlockchainDepositListener();

    const event = listener.ingestOnChainEvent({
      network: 'ETHEREUM',
      asset: 'USDT',
      txHash: '0xeth_tx_12345',
      logIndex: 1,
      blockNumber: 100,
      blockHash: '0xblock_100',
      destinationAddress: '0xUserDepAddr',
      amount: '2500.00',
      currentBlockHeight: 105, // 6 confirmations
    });

    expect(event.status).toBe('CONFIRMING');
    expect(event.confirmations).toBe(6);

    // Advance to 112 (+13 confirmations -> exceeds 12 threshold)
    const updated = listener.advanceChainHeight('ETHEREUM', 112);
    expect(updated).toHaveLength(1);
    expect(updated[0].status).toBe('CONFIRMED');
    expect(updated[0].settledAt).toBeDefined();
  });

  it('enforces idempotency and prevents double-crediting identical deposits', () => {
    const listener = new BlockchainDepositListener();

    listener.ingestOnChainEvent({
      network: 'BITCOIN',
      asset: 'BTC',
      txHash: 'tx_btc_duplicate',
      blockNumber: 500,
      blockHash: '0xblock_500',
      destinationAddress: 'bc1q_btc_addr',
      amount: '1.5',
      currentBlockHeight: 502, // 3 confirmations >= 2 required
    });

    const second = listener.ingestOnChainEvent({
      network: 'BITCOIN',
      asset: 'BTC',
      txHash: 'tx_btc_duplicate',
      blockNumber: 500,
      blockHash: '0xblock_500',
      destinationAddress: 'bc1q_btc_addr',
      amount: '1.5',
      currentBlockHeight: 502,
    });

    expect(second.status).toBe('CONFIRMED');
  });

  it('handles block reorgs by invalidating unconfirmed transactions', () => {
    const listener = new BlockchainDepositListener();

    listener.ingestOnChainEvent({
      network: 'TRON',
      asset: 'USDT',
      txHash: '0xtron_reorg_test',
      blockNumber: 200,
      blockHash: '0xold_tron_block',
      destinationAddress: 'TRx123',
      amount: '1000',
      currentBlockHeight: 202, // 3 confirmations, not finalized
    });

    const reorged = listener.handleBlockReorg({
      network: 'TRON',
      reorgedBlockNumber: 200,
      newBlockHash: '0xnew_canonical_block',
    });

    expect(reorged).toHaveLength(1);
    expect(reorged[0].status).toBe('REORGED');
    expect(reorged[0].settledAt).toBeUndefined();
  });

  it('rejects deposit ingestion with empty address or invalid amount', () => {
    const listener = new BlockchainDepositListener();

    expect(() =>
      listener.ingestOnChainEvent({
        network: 'BITCOIN',
        asset: 'BTC',
        txHash: '0xabc',
        blockNumber: 100,
        blockHash: '0xhash',
        destinationAddress: '',
        amount: '1.5',
        currentBlockHeight: 100,
      })
    ).toThrow('Destination address cannot be empty.');

    expect(() =>
      listener.ingestOnChainEvent({
        network: 'BITCOIN',
        asset: 'BTC',
        txHash: '0xabc',
        blockNumber: 100,
        blockHash: '0xhash',
        destinationAddress: 'bc1qvalid',
        amount: '-5.0',
        currentBlockHeight: 100,
      })
    ).toThrow('Deposit amount must be a positive number.');
  });
});

describe('Proof of Reserves Merkle Solvency Engine Suite', () => {
  const liabilities: UserLiabilityRecord[] = [
    { userId: 'usr_1', asset: 'BTC', amount: '10.5', salt: 'salt_1' },
    { userId: 'usr_2', asset: 'ETH', amount: '150.0', salt: 'salt_2' },
    { userId: 'usr_3', asset: 'USDT', amount: '500000.0', salt: 'salt_3' },
    { userId: 'usr_4', asset: 'ONXC', amount: '1200000.0', salt: 'salt_4' },
  ];

  it('builds cryptographic Merkle tree and generates valid inclusion proofs', () => {
    const por = new ProofOfReservesService();
    const root = por.buildMerkleTree(liabilities);
    expect(root).toHaveLength(64);

    const proof = por.generateInclusionProof('usr_3', 'USDT');
    expect(proof.merkleRoot).toBe(root);
    expect(proof.path.length).toBeGreaterThan(0);

    const isValid = por.verifyInclusionProof(proof);
    expect(isValid).toBe(true);
  });

  it('detects forged inclusion proofs and rejects tampering', () => {
    const por = new ProofOfReservesService();
    por.buildMerkleTree(liabilities);

    const proof = por.generateInclusionProof('usr_1', 'BTC');
    // Tamper with balance
    proof.amount = '999.0';
    proof.leafHash = por.computeLeafHash({
      userId: proof.userId,
      asset: proof.asset,
      amount: proof.amount,
      salt: proof.salt,
    });

    const isValid = por.verifyInclusionProof(proof);
    expect(isValid).toBe(false);
  });

  it('publishes audit attestation with 100%+ reserve backing ratio', () => {
    const por = new ProofOfReservesService();
    por.buildMerkleTree(liabilities);

    const attestation = por.publishAttestation({
      totalLiabilitiesUSD: 5_000_000,
      totalReservesUSD: 5_850_000, // 117% backing
    });

    expect(attestation.reserveRatioPercentage).toBe(117.0);
    expect(attestation.auditorSignature).toHaveLength(64);
    expect(por.getLatestAttestation()?.epochId).toBe(attestation.epochId);
  });

  it('rejects attestation publication if liabilities are zero or negative', () => {
    const por = new ProofOfReservesService();
    por.buildMerkleTree(liabilities);

    expect(() =>
      por.publishAttestation({
        totalLiabilitiesUSD: 0,
        totalReservesUSD: 100_000,
      })
    ).toThrow('Total liabilities must be greater than zero.');
  });

  it('rejects attestation publication before Merkle tree is built', () => {
    const por = new ProofOfReservesService();

    expect(() =>
      por.publishAttestation({
        totalLiabilitiesUSD: 1_000_000,
        totalReservesUSD: 1_200_000,
      })
    ).toThrow(/Cannot publish attestation without a computed Merkle root/);
  });
});
