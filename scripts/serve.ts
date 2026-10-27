import { createServer } from 'node:http';
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, sep } from 'node:path';
import { checkSameLocalOrigin, listVaultMemos, localChainStatus, readJsonBody, verifyLocalCommitPayment } from './zcash-rpc.ts';

const root = resolve('dist');
try {
  if (!(await stat(root)).isDirectory() || !(await stat(resolve(root, 'index.html'))).isFile()) throw new Error('Missing build entry');
  await access(resolve(root, 'index.html'), constants.R_OK);
} catch {
  process.stderr.write('DarkZec: the production build is missing or unreadable.\nRun "npm run build" before "npm run preview", or use "npm run dev".\n');
  process.exit(1);
}
const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
const types: Readonly<Record<string, string>> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'";
function json(response: import('node:http').ServerResponse, status: number, value: unknown): void {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store'); response.writeHead(status); response.end(JSON.stringify(value));
}
const server = createServer(async (request, response) => {
  response.setHeader('Content-Security-Policy', csp);
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // Only same-origin, read-only testnet wallet checks are exposed. No raw RPC proxy or request logging.
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname === '/api/chain/status' || pathname === '/api/chain/verify' || pathname === '/api/chain/vault-memos') {
    if (request.method !== 'POST') { json(response, 405, { error: 'method-not-allowed' }); return; }
    if (!checkSameLocalOrigin(request, port)) { json(response, 403, { error: 'same-origin-required' }); return; }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) { json(response, 415, { error: 'json-required' }); return; }
    try {
      const body: unknown = await readJsonBody(request);
      if (pathname === '/api/chain/status') { json(response, 200, await localChainStatus()); return; }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('invalid-body');
      const record = body as Record<string, unknown>;
      const address = typeof record.address === 'string' ? record.address : '';
      const auctionId = typeof record.auctionId === 'string' ? record.auctionId : '';
      const collateralZat = record.collateralZat === undefined ? 1_000_000_000 : typeof record.collateralZat === 'number' ? record.collateralZat : Number.NaN;
      if (pathname === '/api/chain/vault-memos') { json(response, 200, await listVaultMemos(address, auctionId, collateralZat)); return; }
      const result = await verifyLocalCommitPayment(address, auctionId, typeof record.commitment === 'string' ? record.commitment : '', collateralZat);
      json(response, 200, result); return;
    } catch (error: unknown) {
      const status = error instanceof Error && error.message === 'node-unavailable' ? 503 : 400;
      json(response, status, { error: 'invalid-request' }); return;
    }
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
  try {
    const decodedPathname = decodeURIComponent(pathname);
    const filename = resolve(root, decodedPathname === '/' ? 'index.html' : '.' + decodedPathname);
    if (!filename.startsWith(root + sep) || decodedPathname.includes('\0')) { response.writeHead(403); response.end(); return; }
    const extension = filename.slice(filename.lastIndexOf('.'));
    const contentType = types[extension];
    if (!contentType) { response.writeHead(404); response.end(); return; }
    const bytes = await readFile(filename);
    response.setHeader('Content-Type', contentType); response.writeHead(200);
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404); response.end(); }
});
server.listen(port, '127.0.0.1', () => { console.log(`DarkZec local terminal: http://127.0.0.1:${port}`); });
