import { spawn, execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { devtoolStatus } from './devtool-wallet.ts';

/**
 * One command for an operator: checks the setup, keeps the vault wallet current in the background, serves DarkZec and opens it.
 *
 *   npm run auction -- --wallet <wallet dir> [--devtool <zcash-devtool binary>] [--port 4173] [--interval 20] [--confirmations 3] [--no-open]
 *
 * The wallet is the zcash-devtool wallet that views the auction's vault account (one fresh account per auction). While this runs,
 * `wallet sync` and `wallet enhance` repeat every few seconds, so the page's Sync button always sees fresh notes; transport errors
 * are logged and retried instead of ending anything. Nothing is sent anywhere except to the light wallet server zcash-devtool uses.
 */
const run = promisify(execFile);
const { values } = parseArgs({ options: { wallet: { type: 'string' }, devtool: { type: 'string' }, port: { type: 'string' }, interval: { type: 'string' }, confirmations: { type: 'string' }, 'no-open': { type: 'boolean', default: false } } });
const wallet = values.wallet ?? process.env.DARKZEC_DEVTOOL_WALLET; const devtool = values.devtool ?? process.env.DARKZEC_DEVTOOL_BIN ?? 'zcash-devtool';
const port = Number(values.port ?? process.env.PORT ?? 4173); const interval = Math.max(5, Number(values.interval ?? 20)) * 1000;
const confirmations = Number(values.confirmations ?? process.env.DARKZEC_MIN_CONFIRMATIONS ?? 3);
const say = (line: string): void => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
const mark = (ok: boolean, text: string, hint = ''): boolean => { console.log(`  ${ok ? '✓' : '✗'} ${text}${ok || !hint ? '' : `\n      → ${hint}`}`); return ok; };
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

console.log('DarkZec operator launcher\n');
let ready = true;
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
ready = mark(major > 22 || (major === 22 && minor >= 18), `Node ${process.versions.node}`, 'Node 22.18 or newer is required (it runs the TypeScript scripts and node:sqlite).') && ready;
ready = mark(Number.isInteger(port) && port >= 1024 && port <= 65535, `port ${port}`, 'Choose --port between 1024 and 65535.') && ready;
ready = mark(Number.isInteger(confirmations) && confirmations >= 1 && confirmations <= 100, `${confirmations} confirmation${confirmations === 1 ? '' : 's'} before a payment counts${confirmations === 1 ? ' (one block is not final: a reorganisation can drop it)' : ''}`, 'Use --confirmations between 1 and 100 (3 is the default).') && ready;
let devtoolOk = false;
try { await run(devtool, ['--help']); devtoolOk = true; } catch { /* reported below */ }
ready = mark(devtoolOk, `zcash-devtool (${devtool})`, 'Build it from https://github.com/zcash/zcash-devtool and pass --devtool <path> or set DARKZEC_DEVTOOL_BIN.') && ready;
let walletOk = false; let tip: number | undefined;
if (wallet) {
  try { await access(join(wallet, 'data.sqlite')); const status = await devtoolStatus(wallet); walletOk = status.network === 'testnet'; tip = status.tip; } catch { /* reported below */ }
}
ready = mark(walletOk, wallet ? `testnet wallet ${wallet}${tip === undefined ? '' : ` (scanned to block ${tip})`}` : 'wallet directory', wallet ? 'The directory must hold a zcash-devtool testnet wallet (data.sqlite and keys.toml).' : 'Pass --wallet <dir> or set DARKZEC_DEVTOOL_WALLET.') && ready;
if (!ready) { console.log('\nFix the items marked ✗ and run again.'); process.exit(1); }

let built = true; try { await access('dist/index.html'); } catch { built = false; }
if (!built) {
  mark(false, 'build missing: building now');
  await new Promise<void>((resolve, reject) => { const child = spawn('npm', ['run', 'build'], { stdio: 'inherit' }); child.on('exit', code => code === 0 ? resolve() : reject(new Error('build failed'))); });
}
mark(true, 'production build'); console.log();

let syncing = true;
async function refresh(): Promise<boolean> {
  try { await run(devtool, ['wallet', '-w', wallet as string, 'sync'], { maxBuffer: 1 << 26, timeout: 300_000 }); await run(devtool, ['wallet', '-w', wallet as string, 'enhance'], { maxBuffer: 1 << 26, timeout: 300_000 }); return true; }
  catch { return false; }
}
say('first sync of the vault wallet…');
for (let attempt = 1; !await refresh(); attempt++) { if (attempt >= 5) { say('could not reach the light wallet server; check the network and run again'); process.exit(1); } say(`sync failed (attempt ${attempt}), retrying`); await wait(10_000); }
say(`wallet synced; refreshing every ${interval / 1000}s`);
const loop = (async (): Promise<void> => {
  let failures = 0;
  while (syncing) {
    await wait(interval); if (!syncing) break;
    if (await refresh()) { if (failures > 0) say('wallet sync recovered'); failures = 0; } else { failures++; if (failures === 1 || failures % 10 === 0) say(`wallet sync failed (${failures} in a row); will keep retrying`); }
  }
})();

const server = spawn(process.execPath, ['scripts/serve.ts'], { stdio: 'inherit', env: { ...process.env, PORT: String(port), DARKZEC_DEVTOOL_WALLET: wallet as string, DARKZEC_DEVTOOL_BIN: devtool, DARKZEC_MIN_CONFIRMATIONS: String(confirmations) } });
const url = `http://127.0.0.1:${port}`;
say(`DarkZec is running at ${url}`);
say('Open "Run this auction against a real Zcash testnet vault", fill in the auction, and keep the downloaded operator key file safe. Ctrl+C stops everything.');
if (!values['no-open']) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  try { spawn(opener, process.platform === 'win32' ? ['/c', 'start', url] : [url], { stdio: 'ignore', detached: true }).unref(); } catch { /* the URL is printed above */ }
}
const stop = (): void => { syncing = false; server.kill(); void loop.then(() => process.exit(0)); setTimeout(() => process.exit(0), 3000); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
server.on('exit', code => { syncing = false; process.exit(code ?? 0); });
