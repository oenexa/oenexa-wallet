import { describe, it, expect, beforeEach } from 'vitest';
import { TravelRuleService } from '../service/TravelRuleService.js';
import { TransactionFraudGuard, TransactionPatternContext } from '../service/TransactionFraudGuard.js';

describe('TravelRuleService & TransactionFraudGuard', () => {
  let travelRuleService: TravelRuleService;
  let fraudGuard: TransactionFraudGuard;

  beforeEach(() => {
    travelRuleService = new TravelRuleService();
    fraudGuard = new TransactionFraudGuard();
  });

  describe('FATF Recommendation 16 (Travel Rule / IVMS 101)', () => {
    it('generates a compliant IVMS 101 payload for transactions >= $1000', () => {
      const msg = travelRuleService.evaluateAndBuildMessage({
        transferId: 'tr_tx_9981',
        asset: 'BTC',
        amount: '0.05',
        fiatValueUsd: 3200, // Above $1000
        originatorUserId: 'usr_inst_1',
        originatorName: 'Sovereign Capital LLC',
        originatorCountry: 'CH',
        originatorTown: 'Zug',
        originatorAddress: 'Bahnhofstrasse 12',
        originatorPostalCode: '6300',
        beneficiaryName: 'BitGo Custody Ltd',
        beneficiaryVaspId: 'VASP-BITGO-US-01',
        beneficiaryVaspName: 'BitGo Trust',
        beneficiaryAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
        sourceWalletAddress: 'bc1qvaulthot01testinstitutional',
      });

      expect(msg.isTravelRuleApplicable).toBe(true);
      expect(msg.protocolVersion).toBe('IVMS-101.2020');
      expect(msg.originatorVASP.vaspId).toBe('VASP-OENEXA-CH-001');
      expect(msg.originator.originatorPersons[0].naturalPerson.name.nameIdentifier[0].primaryIdentifier).toBe(
        'Sovereign Capital LLC'
      );
      expect(msg.beneficiary.accountNumbers[0]).toBe('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    });

    it('marks transactions < $1000 as not requiring mandatory VASP-to-VASP exchange', () => {
      const msg = travelRuleService.evaluateAndBuildMessage({
        transferId: 'tr_tx_9982',
        asset: 'USDT',
        amount: '250',
        fiatValueUsd: 250, // Below $1000
        originatorUserId: 'usr_retail_1',
        originatorName: 'Alice Retail',
        originatorCountry: 'FR',
        originatorTown: 'Paris',
        originatorAddress: 'Rue de Rivoli',
        originatorPostalCode: '75001',
        beneficiaryName: 'Bob Retail',
        beneficiaryVaspId: 'VASP-BINANCE-MT-01',
        beneficiaryVaspName: 'Binance',
        beneficiaryAddress: '0x1234567890abcdef1234567890abcdef12345678',
        sourceWalletAddress: '0xhotwalletaddress',
      });

      expect(msg.isTravelRuleApplicable).toBe(false);
    });
  });

  describe('Transaction Fraud & AML Guard', () => {
    it('immediately rejects and alerts on OFAC sanctioned destination addresses', () => {
      const tx: TransactionPatternContext = {
        userId: 'usr_suspect_1',
        asset: 'ETH',
        amount: 2.5,
        fiatValueUsd: 7500,
        destinationAddress: '0x7F3672D1AC762553f1046075239955E73f71F3bC', // OFAC SDN
        timestamp: Date.now(),
      };

      const decision = fraudGuard.evaluateTransaction(tx);
      expect(decision.status).toBe('REJECTED_AML');
      expect(decision.riskScore).toBe(100);
      expect(decision.flags).toContain('OFAC_SANCTIONED_ADDRESS_DIRECT_HIT');
    });

    it('suspends transaction for review when structuring pattern is detected ($8,500 - $9,999)', () => {
      const tx: TransactionPatternContext = {
        userId: 'usr_structuring_1',
        asset: 'USDT',
        amount: 9500,
        fiatValueUsd: 9500, // Structuring sub-10k
        destinationAddress: '0xnormalunflaggedaddress123',
        timestamp: Date.now(),
      };

      const decision = fraudGuard.evaluateTransaction(tx);
      expect(decision.status).toBe('SUSPENDED_REVIEW');
      expect(decision.riskScore).toBe(45);
      expect(decision.flags).toContain('POTENTIAL_STRUCTURING_SUB_10K');
      expect(decision.requiresManualReview).toBe(true);
    });

    it('detects high-frequency burst transactions within 10 minutes', () => {
      const now = Date.now();
      const userId = 'usr_burst_bot';

      // Send 4 rapid transactions
      for (let i = 0; i < 4; i++) {
        fraudGuard.evaluateTransaction({
          userId,
          asset: 'SOL',
          amount: 5,
          fiatValueUsd: 750,
          destinationAddress: `sol_addr_${i}`,
          timestamp: now + i * 30000, // every 30s
        });
      }

      // 5th transaction triggers velocity burst
      const finalTx = fraudGuard.evaluateTransaction({
        userId,
        asset: 'SOL',
        amount: 5,
        fiatValueUsd: 750,
        destinationAddress: 'sol_addr_5',
        timestamp: now + 150000,
      });

      expect(finalTx.flags.some((f) => f.startsWith('VELOCITY_BURST'))).toBe(true);
      expect(finalTx.status).toBe('SUSPENDED_REVIEW');
    });
  });
});
