import { describe, expect, it } from 'vitest';
import { AuctionSession } from '../src/lib/auction-session';
import { serializeAuditBundle, verifyAuditBundle } from '../src/lib/audit-bundle';
import { listingConfig, openListingLink, encodeListingLink } from '../src/lib/listing';
import type { Listing } from '../src/lib/listing';
import { createBackedUpSigner, parseOperatorKeyFile, restoreSigner, serializeOperatorKey } from '../src/lib/operator-key';
import { verifyStatement } from '../src/lib/operator-journal';
import { chainTime, closeTime, revealEndTime } from '../src/lib/schedule';
import { commitSubmission, prepareBid } from '../src/protocol/memo';
import { TEST_REFUND, TEST_VAULT } from './fixtures';

const FAST = 2000; // PBKDF2 rounds: the real count is exercised once below
const schedule = { commitUntil: 4_551_000, revealUntil: 4_551_100 };
const listing: Listing = { v: 1, title: 'Resumable', description: '', schedule: { ...schedule, anchorHeight: 4_550_900, anchorTime: 1_793_200_000 },
  auction: { auctionId: 'RESUME-1', network: 'testnet', vault: TEST_VAULT, supply: 1, reserve: '0.01', collateral: '1', unitDemand: true, procurement: false } };

describe('operator key backup', () => {
  it('encrypts the key, restores a working signer and never stores the private key in the clear', async () => {
    const { signer, file } = await createBackedUpSigner('correct horse', FAST);
    const text = serializeOperatorKey(file);
    expect(text).not.toMatch(/"d"|BEGIN|private/i);
    const restored = await restoreSigner(parseOperatorKeyFile(text), 'correct horse');
    expect(restored.publicKey).toBe(signer.publicKey);
    const signed = { statement: '["DARKZEC/x"]', signature: await restored.sign('["DARKZEC/x"]') };
    expect(await verifyStatement(signer.publicKey, signed)).toBe(true);
  });
  it('uses the full 600,000 PBKDF2 rounds by default', async () => {
    const { file } = await createBackedUpSigner('a long passphrase');
    expect(file.kdf.iterations).toBe(600_000);
    expect((await restoreSigner(file, 'a long passphrase')).publicKey).toBe(file.publicKey);
  });
  it('refuses a wrong passphrase, a short passphrase, edited fields and a relabelled public key', async () => {
    const { file } = await createBackedUpSigner('correct horse', FAST);
    await expect(restoreSigner(file, 'wrong horse!')).rejects.toThrow('Wrong passphrase');
    await expect(createBackedUpSigner('short', FAST)).rejects.toThrow('at least 8');
    const other = await createBackedUpSigner('correct horse', FAST);
    await expect(restoreSigner({ ...file, publicKey: other.file.publicKey }, 'correct horse')).rejects.toThrow('Wrong passphrase');
    await expect(restoreSigner({ ...file, data: `${file.data.slice(0, -2)}${file.data.endsWith('00') ? '01' : '00'}` }, 'correct horse')).rejects.toThrow('Wrong passphrase');
    for (const text of ['', '{}', 'nope', JSON.stringify({ ...file, extra: 1 }), JSON.stringify({ ...file, kdf: { ...file.kdf, iterations: 1 } }), JSON.stringify({ ...file, kind: 'other' })]) {
      expect(() => parseOperatorKeyFile(text)).toThrow('not an operator key file');
    }
    expect(() => parseOperatorKeyFile(' '.repeat(5000))).toThrow();
  });
});

describe('resuming an auction from its link after losing the session', () => {
  it('rebuilds the same signed auction from the chain and passes the audit with the original listing signature', async () => {
    const first = await createBackedUpSigner('correct horse', FAST);
    let now = chainTime(4_550_950);
    const original = await AuctionSession.create(listingConfig(listing), () => now, first.signer);
    const link = encodeListingLink(await original.publish(listing)); const opened = await openListingLink(link);
    // The tab is lost here. A new session is rebuilt from the link and the encrypted key file only.
    const restored = await restoreSigner(parseOperatorKeyFile(serializeOperatorKey(first.file)), 'correct horse');
    const session = await AuctionSession.create(listingConfig(opened.listing), () => now, restored);
    await session.adoptListing(opened);
    const bids = await Promise.all(['0.9', '0.8', '0.6'].map(price => prepareBid({ auctionId: 'RESUME-1', price, quantity: 1, vault: TEST_VAULT, refund: TEST_REFUND, network: 'testnet', collateral: '1' })));
    for (const bid of bids) await session.sandbox.submit(commitSubmission(bid));
    now = closeTime(schedule); await session.close();
    for (const [index, bid] of bids.slice(0, 2).entries()) { now = chainTime(4_551_010 + index); await session.reveal(bid.reveal); }
    now = revealEndTime(schedule); await session.clear();
    const bundle = session.bundle(); if (!bundle) throw new Error('Missing bundle');
    const report = await verifyAuditBundle(serializeAuditBundle(bundle));
    expect(report.ok).toBe(true);
    expect(report.checks.find(check => check.id === 'listing')?.ok).toBe(true);
    expect(bundle.operator.publicKey).toBe(opened.publicKey);
    expect(bundle.operator.statements[0]?.signature).toBe(opened.signature);
  });
  it('refuses a key that is not the listing\'s key and a listing that does not match the session', async () => {
    const first = await createBackedUpSigner('correct horse', FAST); const stranger = await createBackedUpSigner('correct horse', FAST);
    const original = await AuctionSession.create(listingConfig(listing), () => 0, first.signer);
    const opened = await openListingLink(encodeListingLink(await original.publish(listing)));
    const wrongKey = await AuctionSession.create(listingConfig(listing), () => 0, stranger.signer);
    await expect(wrongKey.adoptListing(opened)).rejects.toThrow('does not belong');
    const otherRules = await AuctionSession.create({ ...listingConfig(listing), reserve: '0.02' }, () => 0, first.signer);
    await expect(otherRules.adoptListing(opened)).rejects.toThrow('does not match');
    const again = await AuctionSession.create(listingConfig(listing), () => 0, first.signer); await again.adoptListing(opened);
    await expect(again.adoptListing(opened)).rejects.toThrow();
  });
});
