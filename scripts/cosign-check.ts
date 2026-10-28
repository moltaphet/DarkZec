import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { checkSettlementRequest } from '../src/lib/cosigner.ts';

/**
 * What a co-signer runs before signing a settlement:
 *   npm run cosign-check -- <bundle.json> --uri <zcash:… | @file> --seller <utest1…>
 * Exit status 0 means APPROVE (the request pays exactly what the verified audit bundle implies), 1 means REJECT.
 */
const { positionals, values } = parseArgs({ allowPositionals: true, options: { uri: { type: 'string' }, seller: { type: 'string' } } });
const [path] = positionals; const { uri, seller } = values;
if (!path || !uri || !seller) { process.stderr.write('usage: npm run cosign-check -- <bundle.json> --uri <zcash:… | @file> --seller <utest1…>\n'); process.exit(2); }
const request = uri.startsWith('@') ? (await readFile(uri.slice(1), 'utf8')).trim() : uri;
const verdict = await checkSettlementRequest(await readFile(path, 'utf8'), request, seller);
for (const problem of verdict.problems) process.stdout.write(`- ${problem}\n`);
process.stdout.write(`${verdict.approve ? 'APPROVE' : 'REJECT'}: ${verdict.payments} payment${verdict.payments === 1 ? '' : 's'} in the request.\n`);
process.exit(verdict.approve ? 0 : 1);
