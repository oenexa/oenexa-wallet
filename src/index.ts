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
import { TransactionStateMachine } from './service/TransactionStateMachine.js';
import { DashboardBootstrapService } from './service/DashboardBootstrapService.js';
import { P2pEscrowService } from './service/P2pEscrowService.js';
import { WithdrawalGateService } from './service/WithdrawalGateService.js';
import { DigitalAssetRegistry } from './registry/DigitalAssetRegistry.js';

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
export * from './service/TransactionStateMachine.js';
export * from './service/DashboardBootstrapService.js';
export * from './service/P2pEscrowService.js';
export * from './service/WithdrawalGateService.js';
export * from './registry/DigitalAssetRegistry.js';

export const wallet = new WalletService();
export const mpcVault = new MpcVaultService();
export const depositListener = new BlockchainDepositListener();
export const porService = new ProofOfReservesService();
export const doubleEntryLedger = new DoubleEntryLedgerService();
export const reconciliation = new ReconciliationEngine(doubleEntryLedger, mpcVault);
export const travelRule = new TravelRuleService();
export const fraudGuard = new TransactionFraudGuard();
export const outboxRelayer = new EventOutboxRelayerService();
export const txStateMachine = new TransactionStateMachine(doubleEntryLedger);
export const dashboardBootstrap = new DashboardBootstrapService();
export const p2pEscrow = new P2pEscrowService(doubleEntryLedger);
export const withdrawalGate = new WithdrawalGateService();
export const digitalAssets = DigitalAssetRegistry.getInstance();

const PORT = Number(process.env.PORT) || 8089;

function parseJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c.toString();
      if (body.length > 1e6) { req.destroy(); reject(new Error('Payload too large')); }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Malformed JSON')); }
    });
    req.on('error', reject);
  });
}

export const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method || 'GET';

  try {
    if (pathname === '/health' && method === 'GET') {
      res.writeHead(200);
      return res.end(JSON.stringify({ status: 'UP', service: 'oenexa-wallet', timestamp: new Date().toISOString() }));
    }

    // 1. Dynamic Asset Registry Configuration
    if ((pathname === '/api/wallet/config/assets' || pathname === '/api/v1/wallet/config/assets') && method === 'GET') {
      res.writeHead(200);
      return res.end(JSON.stringify({ success: true, data: digitalAssets.getAllAssets(), total: digitalAssets.getTotalCount() }));
    }

    // 2. Dynamic Single-Call Dashboard Bootstrap
    if ((pathname === '/api/wallet/dashboard/bootstrap' || pathname === '/api/v1/wallet/dashboard/bootstrap') && method === 'GET') {
      const userId = url.searchParams.get('userId') || 'usr_default';
      const tab = (url.searchParams.get('tab') as any) || 'holding';
      const hideSmall = url.searchParams.get('hideSmallBalances') === 'true';
      const data = dashboardBootstrap.getDashboardBootstrap({ userId, tab, hideSmallBalances: hideSmall });
      res.writeHead(200);
      return res.end(JSON.stringify({ success: true, data }));
    }

    // 3. Dynamic Pre-Withdrawal Security Gate Evaluation
    if ((pathname === '/api/wallet/withdraw/evaluate' || pathname === '/api/v1/wallet/withdraw/evaluate') && method === 'POST') {
      const body = await parseJson(req);
      const result = withdrawalGate.evaluateWithdrawal(body);
      const code = result.allowed ? 200 : 403;
      res.writeHead(code);
      return res.end(JSON.stringify({ success: result.allowed, data: result }));
    }

    // 4. Two-Phase Transaction Creation (Hold & Settle)
    if ((pathname === '/api/wallet/transaction/create' || pathname === '/api/v1/wallet/transaction/create') && method === 'POST') {
      const body = await parseJson(req);
      const tx = txStateMachine.createTransaction(body);
      res.writeHead(200);
      return res.end(JSON.stringify({ success: true, data: tx }));
    }

    // 5. Proof of Reserves Attestation
    if (pathname === '/api/wallet/por/latest' && method === 'GET') {
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
