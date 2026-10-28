import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseAuditBundle, verifyAuditBundle } from '../src/lib/audit-bundle.ts';
import { viewKeyActivity } from './view-wallet.ts';

/**
 * Full audit of a settled bundle, including the two on-chain checks: a view-only wallet built from the bundle's
 * published viewing key reads every deposit and payout from Zcash testnet.
 *
 *   DARKZEC_DEVTOOL_BIN=<path to zcash-devtool> npm run verify-chain -- <bundle.json> [--record snapshot.json]
 *
 * --record saves what the key saw, so the public site can re-run the on-chain checks offline, labelled as a recording.
 */
const { positionals, values } = parseArgs({ allowPositionals: true, options: { record: { type: 'string' } } });
const path = positionals[0];
if (!path) { process.stderr.write('usage: npm run verify-chain -- <bundle.json> [--record snapshot.json]\n'); process.exit(2); }
const text = await readFile(path, 'utf8');
const { settlement } = parseAuditBundle(text);
if (!settlement) { process.stderr.write('verify-chain: this bundle has no settlement record (no viewing key published).\n'); process.exit(2); }
process.stdout.write(`Scanning Zcash testnet from height ${settlement.birthday} with the published viewing key…\n`);
const activity = await viewKeyActivity(settlement.viewingKey, settlement.birthday);
const report = await verifyAuditBundle(text, activity);
if (values.record) await writeFile(values.record, `${JSON.stringify(activity, null, 2)}\n`);
for (const check of report.checks) process.stdout.write(`${check.skipped ? 'SKIP' : check.ok ? 'PASS' : 'FAIL'}  ${check.label}: ${check.detail}\n`);
process.stdout.write(`\n${report.ok ? 'VERIFIED' : 'NOT VERIFIED'}: ${report.checks.filter(check => check.ok).length} of ${report.checks.length} checks pass.\n`);
process.exit(report.ok ? 0 : 1);
