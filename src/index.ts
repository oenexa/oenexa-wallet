import http from 'node:http';
import { WalletService } from './service/WalletService.js';

export * from './domain/types.js';
export * from './domain/events.js';
export * from './service/WalletService.js';

const wallet = new WalletService();
const PORT = Number(process.env.PORT) || 8089;

export const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'UP', service: 'oenexa-wallet', timestamp: new Date().toISOString() }));
  }

  if (req.url === '/api/wallet/outbox' && req.method === 'GET') {
    res.writeHead(200);
    return res.end(JSON.stringify({ success: true, data: wallet.getOutbox() }));
  }

  res.writeHead(404);
  return res.end(JSON.stringify({ success: false, error: 'Endpoint Not Found' }));
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[oenexa-wallet] Web3 Non-Custodial Wallet Microservice listening on port ${PORT}`);
  });
}
