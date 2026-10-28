import { execFile, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs, promisify } from 'node:util';
import { parseAuditBundle, serializeAuditBundle, verifyAuditBundle, withSettlement } from '../src/lib/audit-bundle.ts';
import { settlementPayouts, settlementUri } from '../src/lib/settlement.ts';
import { checkSettlementRequest } from '../src/lib/cosigner.ts';

/**
 * Settles a cleared auction on Zcash testnet in one transaction from its own vault account:
 * each refund back to its bidder with a refund memo, all payments to the seller, all forfeited collateral to the
 * provably unspendable burn address. It then attaches the account's viewing key and the txid to the audit bundle,
 * so anyone can check the deposits and the payouts on chain (scripts/verify-chain.ts).
 *
 *   node scripts/settle.ts --bundle cleared.json --wallet <vault dir> --account <uuid> --identity <age key> --seller <utest1…>
 *       [--send] [--out settled.json]
 *
 * Without --send it verifies the bundle, prints the payouts and the wallet's proposal (with its fee) and stops.
 */
const { values } = parseArgs({ options: {
  bundle: { type: 'string' }, wallet: { type: 'string' }, account: { type: 'string' }, identity: { type: 'string' },
  seller: { type: 'string' }, out: { type: 'string' }, send: { type: 'boolean', default: false },
} });
const fail = (message: string): never => { process.stderr.write(`settle: ${message}\n`); process.exit(1); };
const { bundle: bundlePath, wallet, account, identity, seller } = values;
if (!bundlePath || !wallet || !account || !identity || !seller) fail('--bundle, --wallet, --account, --identity and --seller are required.');
const devtool = process.env.DARKZEC_DEVTOOL_BIN || 'zcash-devtool';

const text = await readFile(bundlePath as string, 'utf8');
const report = await verifyAuditBundle(text);
for (const check of report.checks) process.stdout.write(`${check.skipped ? 'SKIP' : check.ok ? 'PASS' : 'FAIL'}  ${check.label}: ${check.detail}\n`);
if (!report.ok) fail('the bundle does not verify; refusing to settle it.');
const bundle = parseAuditBundle(text);
if (bundle.settlement) fail('this bundle is already settled.');
if (bundle.auction.network !== 'testnet') fail('settlement is enabled on testnet only.');

const payouts = settlementPayouts({ auctionId: bundle.auction.auctionId, network: 'testnet', forfeitedCollateral: bundle.result.forfeitedCollateral, allocations: bundle.result.allocations }, seller as string);
process.stdout.write(`\nPayouts for ${bundle.auction.auctionId}:\n`);
for (const payout of payouts) process.stdout.write(`  ${payout.kind.padEnd(8)} ${payout.amount.padStart(12)} ZEC -> ${payout.address.slice(0, 24)}…${payout.commitment ? ` (entry ${payout.commitment.slice(0, 12)}…)` : ''}\n`);
const uri = settlementUri(payouts);
// The same policy a co-signer would apply: the request must pay exactly what the verified bundle implies.
const verdict = await checkSettlementRequest(text, uri, seller as string);
if (!verdict.approve) fail(`the settlement request fails the co-signer policy: ${verdict.problems.join(' ')}`);

// The viewing key and birthday come from the wallet itself, never from the operator's say-so.
const accounts = (await promisify(execFile)(devtool, ['wallet', '-w', wallet as string, 'list-accounts'], { maxBuffer: 4 * 1024 * 1024 })).stdout;
const block = accounts.split(/^Account /m).find(part => part.startsWith(account as string)) ?? fail(`account ${account} is not in this wallet.`);
const birthday = Number(/birthday height (\d+)/.exec(block)?.[1]);
const viewingKey = /UFVK:\s*(uviewtest1[0-9a-z]+)/.exec(block)?.[1] ?? fail('the account has no testnet unified full viewing key.');
if (!Number.isSafeInteger(birthday)) fail('the account has no birthday height.');

/** Runs `wallet pay`; without --disable-confirmation the wallet shows its proposal and we answer no. */
function pay(confirm: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['wallet', '-w', wallet as string, 'pay', account as string, '--identity', identity as string, '--payment-uri', uri, ...(confirm ? ['--disable-confirmation'] : [])];
    const child = spawn(devtool, args, { stdio: ['pipe', 'pipe', 'inherit'] });
    let output = ''; child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); process.stdout.write(chunk); });
    child.stdin.end(confirm ? '' : 'n\n');
    child.on('error', reject); child.on('close', code => code === 0 || !confirm ? resolve(output) : reject(new Error(`wallet pay exited with ${code}`)));
  });
}

process.stdout.write('\nWallet proposal:\n');
if (!values.send) { await pay(false); process.stdout.write('\nDry run only. Re-run with --send to broadcast this settlement.\n'); process.exit(0); }
const output = await pay(true);
const txid = output.trim().split(/\s+/).reverse().find(word => /^[a-f0-9]{64}$/.test(word)) ?? fail('the wallet did not report a transaction id.');
const settled = serializeAuditBundle(withSettlement(bundle, { viewingKey, birthday, seller: payouts.find(payout => payout.kind === 'proceeds')?.address ?? seller as string, txids: [txid] }));
await writeFile(values.out ?? bundlePath as string, settled);
process.stdout.write(`\nSettled in ${txid}. Bundle written to ${values.out ?? bundlePath}.\n`);
