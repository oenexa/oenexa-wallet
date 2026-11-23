import http from 'node:http';
import { WalletService } from './service/WalletService.js';
import { MpcVaultService } from './service/MpcVaultService.js';
import { BlockchainDepositListener } from './service/BlockchainDepositListener.js';
import { ProofOfReservesService } from './service/ProofOfReservesService.js';
import { DoubleEntryLedgerService } from './service/DoubleEntryLedgerService.js';
import { ReconciliationEngine } from './service/ReconciliationEngine.js';
import { TravelRuleService } from './service/TravelRuleService.js';
import { TransactionFraudGuard } from './service/TransactionFraudGuard.js';
import { EventOutboxRelayerService } from './service/EventOutboxRelayerService.js';

export * from './domain/types.js';
export * from './domain/events.js';
export * from './service/WalletService.js';
export * from './service/MpcVaultService.js';
export * from './service/BlockchainDepositListener.js';
export * from './service/ProofOfReservesService.js';
export * from './service/DoubleEntryLedgerService.js';
export * from './service/ReconciliationEngine.js';
export * from './service/TravelRuleService.js';
export * from './service/TransactionFraudGuard.js';
export * from './service/EventOutboxRelayerService.js';

const wallet = new WalletService();
const mpcVault = new MpcVaultService();
const depositListener = new BlockchainDepositListener();
const porService = new ProofOfReservesService();
const doubleEntryLedger = new DoubleEntryLedgerService();
const reconciliation = new ReconciliationEngine(doubleEntryLedger, mpcVault);
const travelRule = new TravelRuleService();
const fraudGuard = new TransactionFraudGuard();
const outboxRelayer = new EventOutboxRelayerService();

const PORT = Number(process.env.PORT) || 8089;

export const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200);
      return res.end(JSON.stringify({ status: 'UP', service: 'oenexa-wallet', timestamp: new Date().toISOString() }));
    }

    if (req.url === '/api/wallet/outbox' && req.method === 'GET') {
      res.writeHead(200);
      return res.end(JSON.stringify({ success: true, data: wallet.getOutbox() }));
    }

    if (req.url === '/api/wallet/por/latest' && req.method === 'GET') {
      res.writeHead(200);
      return res.end(JSON.stringify({ success: true, data: porService.getLatestAttestation() }));
    }

    res.writeHead(404);
    return res.end(JSON.stringify({ success: false, error: 'Endpoint Not Found' }));
  } catch (err: any) {
    res.writeHead(500);
    return res.end(JSON.stringify({ success: false, error: err?.message || 'Internal Server Error' }));
  }
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[oenexa-wallet] MPC Custody & Blockchain Ingestion Service listening on port ${PORT}`);
  });
}
