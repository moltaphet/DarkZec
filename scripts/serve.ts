import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve('dist');
const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
const types: Readonly<Record<string, string>> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'";
const server = createServer(async (request, response) => {
  response.setHeader('Content-Security-Policy', csp);
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // No request logging, cookie handling, RPC proxy, websocket or application endpoint.
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const filename = resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
    if (!filename.startsWith(root + sep) || pathname.includes('\0')) { response.writeHead(403); response.end(); return; }
    const extension = filename.slice(filename.lastIndexOf('.'));
    const contentType = types[extension];
    if (!contentType) { response.writeHead(404); response.end(); return; }
    const bytes = await readFile(filename);
    response.setHeader('Content-Type', contentType); response.writeHead(200);
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404); response.end(); }
});
server.listen(port, '127.0.0.1', () => { console.log(`DarkZec local terminal: http://127.0.0.1:${port}`); });
