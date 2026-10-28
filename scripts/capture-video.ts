import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { WALLET_REFUND, WALLET_VAULT } from '../tests/fixtures.ts';

/**
 * 3840x2160 screenshots for the demo video, ordered and named in the sequence they are meant to be shown:
 *   npm run build && PORT=4175 npm run preview     (another terminal)
 *   node --import ./scripts/resolve-ts.ts scripts/capture-video.ts [outdir]
 * Folders: 01-demo-flow (the sandbox walkthrough), 02-real-runs (the settled testnet auctions), 04-link-bidder-page
 * (the shipped link auction's bidder page and published result). 03-link-run-* is written by the live run itself.
 * The output is large and stays out of git (see .gitignore).
 */
const base = `http://127.0.0.1:${process.env.PORT ?? 4175}`;
const root = process.argv[2] ?? 'video-assets';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, reducedMotion: 'reduce', acceptDownloads: true });
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
let count = 0;
/** Frames the target in the viewport, then shoots the whole 4K viewport. */
async function shot(page: Page, dir: string, name: string, target?: string): Promise<void> {
  // Compact blocks are centred so they sit clear of the header and dock; tall ones start just below the header.
  if (target) { await page.locator(target).first().evaluate(element => { const tall = element.getBoundingClientRect().height > innerHeight - 220; element.scrollIntoView({ block: tall ? 'start' : 'center' }); if (tall) window.scrollBy(0, -96); }); }
  await wait(800); await page.screenshot({ path: `${root}/${dir}/${name}.png` }); count++;
}
const click = async (page: Page, selector: string): Promise<void> => { await page.locator(selector).click(); await wait(500); };
const tab = async (page: Page, name: string): Promise<void> => { await page.getByRole('button', { name }).click(); await wait(700); };

// 01: the sandbox walkthrough, exactly the judge path.
const demo = '01-demo-flow'; await mkdir(`${root}/${demo}`, { recursive: true });
let page = await context.newPage(); await page.goto(base); await wait(2500);
await shot(page, demo, '01-hero');
await page.mouse.wheel(0, 1300); await wait(1500); await shot(page, demo, '02-intro-journey');
await click(page, '.skip-intro'); await wait(1200);
await shot(page, demo, '03-sandbox-compose', '#sandbox-view');
await click(page, '#seed'); await click(page, '#prepare'); await click(page, '#commit');
await shot(page, demo, '04-sealed-book-hashes-only', '.workspace');
await shot(page, demo, '05-operator-view-before-close', '#operator-view');
await click(page, '#close'); await click(page, '#reveal-all');
await shot(page, demo, '06-operator-view-after-reveals', '#operator-view');
await click(page, '#clear'); await shot(page, demo, '07-clearing-result', '#results-panel');
await tab(page, 'Audit mode'); await click(page, '#audit-session'); await wait(1500);
await shot(page, demo, '08-audit-mode-session-verified', '#audit-view');
await tab(page, 'Pay with wallet');
await shot(page, demo, '09-pay-with-wallet-explainer', '#wallet-view');
await page.locator('#wallet-vault').fill(WALLET_VAULT); await page.locator('#wallet-refund').fill(WALLET_REFUND); await page.locator('#wallet-collateral').selectOption('1');
await page.locator('#wallet-price').fill('0.2'); await page.locator('#wallet-quantity').fill('1'); await click(page, '#wallet-prepare');
const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download-wallet-receipt').click()]); void download;
await page.locator('#wallet-reviewed').check(); await wait(800);
await shot(page, demo, '10-wallet-request-and-qr', '#wallet-output');
await shot(page, demo, '11-wallet-qr-close-up', '#wallet-qr');
await page.close();

// 05: the seller's practice mode (simulated chain), one still per step.
const practiceDir = '05-seller-practice-mode'; await mkdir(`${root}/${practiceDir}`, { recursive: true });
page = await context.newPage(); await page.goto(base); await click(page, '.skip-intro'); await wait(1200);
await page.locator('#live-auction > .tool-content > details > summary').click();
await page.locator('#live-title').fill('Two design review slots'); await page.locator('#live-auction-id').fill('PRACTICE-1'); await page.locator('#live-mode').selectOption('vickrey');
await shot(page, practiceDir, '01-seller-panel', '#live-auction');
await click(page, '#live-practice'); await shot(page, practiceDir, '02-practice-started-link-created', '#live-auction');
const preview = await page.locator('#live-open-link').getAttribute('href') ?? '';
await click(page, '#practice-pay-commits'); await click(page, '#practice-advance'); await click(page, '#live-sync'); await shot(page, practiceDir, '03-commits-synced', '#live-auction');
await click(page, '#close'); await click(page, '#practice-pay-reveals'); await click(page, '#live-sync'); await shot(page, practiceDir, '04-reveals-imported', '#operator-view');
await click(page, '#practice-advance'); await click(page, '#live-sync'); await click(page, '#clear'); await shot(page, practiceDir, '05-cleared', '#results-panel');
await tab(page, 'Audit mode'); await click(page, '#audit-session'); await wait(1500); await shot(page, practiceDir, '06-audit-verified-with-listing-and-schedule', '#audit-view');
const practiceBidder = await context.newPage(); await practiceBidder.goto(preview); await practiceBidder.locator('#listing-practice').waitFor(); await wait(1200);
await shot(practiceBidder, practiceDir, '07-bidder-page-practice-banner', '#listing-view');
await practiceBidder.close(); await page.close();

// 02: each shipped real testnet run: its audit (with the on-chain checks) and what the vault's viewing key sees.
const real = '02-real-runs'; await mkdir(`${root}/${real}`, { recursive: true });
const runs: string[] = [];
for (const id of ['DZ-TESTNET-1', 'DZ-TESTNET-2', 'DZ-TESTNET-3']) {
  try { if (JSON.parse(await readFile(`public/testnet/${id}-audit-bundle.json`, 'utf8')).settlement) runs.push(id); } catch { /* run not shipped */ }
}
for (const id of runs) {
  page = await context.newPage(); await page.goto(base); await click(page, '.skip-intro'); await wait(1200);
  await tab(page, 'Audit mode'); await click(page, `#audit-run-${id}`); await page.locator('#audit-verdict').filter({ hasText: 'VERIFIED' }).waitFor();
  await shot(page, real, `${id}-1-audit-all-checks`, '#audit-view');
  await tab(page, 'Vault scanner'); await click(page, `#real-scan-${id}`); await page.locator('#real-scan-status').filter({ hasText: 'notes received' }).waitFor();
  await shot(page, real, `${id}-2-vault-scanner-what-the-key-sees`, '#real-scan-view');
  await page.close();
}

// 04: the bidder page of the link auction, and its one-click published result.
if (runs.includes('DZ-TESTNET-3')) {
  const bidder = '04-link-bidder-page'; await mkdir(`${root}/${bidder}`, { recursive: true });
  const link = (await readFile(`${root}/auction-link-DZ-TESTNET-3.txt`, 'utf8')).trim().replace(/^https?:\/\/[^/]+/, base);
  page = await context.newPage(); await page.goto(link); await page.locator('#listing-bid').waitFor(); await wait(1500);
  await shot(page, bidder, '01-listing-page-ended', '#listing-view');
  await shot(page, bidder, '02-rules-and-deadlines', '#listing-rules');
  await click(page, '#listing-load-published'); await page.locator('#listing-mine').waitFor();
  await shot(page, bidder, '03-published-result-and-my-outcome', '#listing-result');
  await page.close();
}
await browser.close(); console.log(`Saved ${count} screenshots (3840x2160) under ${root}/`);
