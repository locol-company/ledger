import http from 'http';
import pkg from '../package.json';

export function startHealthServer(port = 3002): void {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'ledger', version: pkg.version }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, () => console.log(`Health check: http://localhost:${port}/health`));
}
