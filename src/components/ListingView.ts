import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';
import { AUDIT_BUNDLE_MAX_BYTES, parseAuditBundle } from '../lib/audit-bundle';
import type { AuditReport } from '../lib/audit-bundle';
import { listingDigest } from '../lib/listing';
import type { OpenedListing } from '../lib/listing';
import { downloadText, parseReceiptText } from '../lib/receipt-file';
import { buildReminders } from '../lib/reminder';
import { FIXTURE_ADDRESS } from '../fixtures';
import { describeBlocks, estimateHeight } from '../lib/schedule';
import { commitment } from '../protocol/crypto';
import { formatZec, parseZec } from '../protocol/amount';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element;
};
const fact = (label: string, value: string, id?: string): HTMLElement => {
  const row = node('div'); const term = node('dt', label, 'micro'); const detail = node('dd', value); if (id) detail.id = id; row.append(term, detail); return row;
};

/** An audit report and where its on-chain checks, if present, got their chain data. */
export interface VerifiedBundle { readonly report: AuditReport; readonly source: 'live' | 'recorded' | 'none'; readonly tip?: number }

export interface ListingHandlers {
  /** Opens the wallet tab prefilled and locked to this auction. */
  bid(opened: OpenedListing): void;
  /** Runs the full audit on a bundle text (off-chain checks plus on-chain ones where a light client answers). */
  verify(text: string): Promise<VerifiedBundle>;
  /** Shipped real runs only: the published audit bundle and the winner's receipt (taken from that bundle), so the result check works in one click. */
  published?(auctionId: string): { readonly bundle: () => Promise<string>; readonly receipt: () => Promise<string> } | undefined;
}

/** Rules in words, so a bidder knows exactly how they will be priced before paying anything. */
export function describeRules(auction: OpenedListing['listing']['auction']): string {
  const lots = `${auction.supply} ${auction.supply === 1 ? 'lot' : 'lots'}`;
  if (auction.procurement) {
    return `Procurement for ${lots}. Bidders offer to supply one unit each; the lowest offers win and are all priced at the next-lowest offer, capped at the ceiling of ${auction.reserve} ZEC. Nobody pays the vault: the ${auction.collateral} ZEC is a bid bond returned in full to everyone who reveals, and the buyer pays the winners outside DarkZec. A bond is burned if its bid is never revealed.`;
  }
  if (auction.supply === 1 && auction.unitDemand) return `Second-price (Vickrey) auction for ${lots}. The highest bid wins and pays the second-highest bid, or the reserve of ${auction.reserve} ZEC if that is higher. Bidding your true value is the best strategy.`;
  if (auction.unitDemand) return `Uniform-price auction for ${lots}, one lot per bid. The ${auction.supply} highest bids win and all pay the same price: the highest losing bid, or the reserve of ${auction.reserve} ZEC if that is higher.`;
  return `Uniform-price auction for ${lots}. The highest bids win until the lots run out and all winners pay the same clearing price, never above their own limit and never below the reserve of ${auction.reserve} ZEC.`;
}

/**
 * The page a bidder lands on from an auction link: the operator-signed listing, its rules in plain words, the block-height
 * deadlines with a countdown estimate, and a checker that shows what happened to their own bid after the auction cleared.
 */
export class ListingView implements Disposable {
  readonly #host: HTMLElement;
  readonly #life = new Lifetime();
  readonly #handlers: ListingHandlers;
  #opened: OpenedListing | undefined;
  #bundle = '';
  #receipt = '';
  readonly #result = node('div', '', 'listing-result');
  readonly #bundleFile = node('input'); readonly #receiptFile = node('input');
  constructor(host: HTMLElement, handlers: ListingHandlers) { this.#host = host; this.#handlers = handlers; host.className = 'panel listing-view'; host.setAttribute('data-independent-controls', ''); }

  showError(message: string): void {
    this.#opened = undefined; this.#host.replaceChildren();
    const heading = node('div', '', 'panel-heading'); heading.append(node('h2', 'Auction link'), node('span', 'NOT VERIFIED'));
    const body = node('div', '', 'tool-content'); const error = node('p', message, 'tool-status is-bad'); error.id = 'listing-error'; error.setAttribute('role', 'alert');
    body.append(error); this.#host.append(heading, body);
  }

  show(opened: OpenedListing, nowMs = Date.now()): void {
    this.#opened = opened; this.#bundle = ''; this.#receipt = ''; this.#host.replaceChildren(); this.#result.replaceChildren();
    const { listing } = opened; const { auction, schedule } = listing;
    const heading = node('div', '', 'panel-heading');
    heading.append(node('h2', listing.title), node('span', auction.procurement ? 'PROCUREMENT / SIGNED LISTING' : 'SEALED-BID AUCTION / SIGNED LISTING'));
    heading.querySelector('h2')?.setAttribute('id', 'listing-title');
    const body = node('div', '', 'tool-content');
    if (listing.description) { const description = node('p', listing.description, 'listing-description'); description.id = 'listing-description'; body.append(description); }
    const rules = node('p', describeRules(auction), 'listing-rules'); rules.id = 'listing-rules';

    const tip = estimateHeight({ height: schedule.anchorHeight, time: schedule.anchorTime }, nowMs);
    const untilCommit = schedule.commitUntil - tip; const untilReveal = schedule.revealUntil - tip;
    const phase = untilCommit >= 0 ? 'BIDDING OPEN' : untilReveal >= 0 ? 'REVEAL WINDOW' : 'ENDED';
    const timeline = node('div', '', 'listing-timeline'); timeline.id = 'listing-phase'; timeline.dataset.phase = phase;
    timeline.append(node('strong', phase), node('span', phase === 'BIDDING OPEN' ? `about ${describeBlocks(untilCommit)} left to commit (estimate)` :
      phase === 'REVEAL WINDOW' ? `about ${describeBlocks(untilReveal)} left to reveal (estimate)` : 'the reveal window has passed (estimate)'));
    const facts = node('dl', '', 'receipt listing-facts');
    facts.append(
      fact(auction.procurement ? 'Units wanted' : 'Lots', String(auction.supply), 'listing-lots'),
      fact(auction.procurement ? 'Price ceiling' : 'Reserve price', `${auction.reserve} ZEC`),
      fact(auction.procurement ? 'Bid bond' : 'Collateral per bid', `${auction.collateral} ZEC`, 'listing-collateral'),
      fact('Commit deadline', `block ${schedule.commitUntil} (payments mined after it are ignored)`, 'listing-commit-until'),
      fact('Reveal deadline', `block ${schedule.revealUntil} (reveals mined after it are ignored)`, 'listing-reveal-until'));
    const note = node('p', 'Countdowns estimate the chain tip from the time this listing was signed, at 25 seconds per block. The blocks decide, not this clock.', 'small muted');

    const trust = node('div', '', 'listing-trust');
    const key = `${opened.publicKey.slice(2, 18)}…${opened.publicKey.slice(-8)}`;
    trust.append(node('p', `Signature valid. The operator signed this listing with key ${key} before taking its first bid, and the audit bundle published after clearing must contain exactly these rules and deadlines. Pay only the vault address below, and compare it with the other channels the seller uses.`, 'small'));
    const vault = node('code', auction.vault, 'listing-vault'); vault.id = 'listing-vault';

    const steps = node('ol', '', 'listing-steps');
    for (const step of [
      'Choose your bid and a refund address on the next screen. Nothing leaves this browser.',
      `Download your receipt, then pay the ${auction.collateral} ZEC collateral to the vault with your wallet (scan the QR). The payment memo holds only a hash of your bid.`,
      `After block ${schedule.commitUntil}, send your reveal from the same screen (a tiny payment whose memo is your receipt) before block ${schedule.revealUntil}. A bid that is not revealed loses its collateral.`,
      'When the operator publishes the audit bundle, check your result below. Refunds go to your refund address.']) steps.append(node('li', step));
    const bid = node('button', 'Bid on this auction', 'button primary'); bid.type = 'button'; bid.id = 'listing-bid';
    bid.addEventListener('click', () => this.#handlers.bid(opened), { signal: this.#life.signal });
    const reminders = node('button', 'Download calendar reminders (.ics)', 'button quiet'); reminders.type = 'button'; reminders.id = 'listing-reminders';
    reminders.addEventListener('click', () => downloadText(`darkzec-${auction.auctionId}-reminders.ics`, buildReminders(listing), 'text/calendar'), { signal: this.#life.signal });
    // A practice auction uses the public demo vault: it can be read but never paid.
    const practice = auction.vault === FIXTURE_ADDRESS;
    if (practice) { bid.disabled = true; reminders.disabled = true; }
    const practiceNote = node('p', 'PRACTICE AUCTION: the seller is rehearsing on a simulated chain and the vault is the public demo vault, so nothing here can be paid. This is what your bidders would see.', 'tool-status is-bad'); practiceNote.id = 'listing-practice'; practiceNote.hidden = !practice;
    const bidNote = node('p', 'Testnet only. Zcash testnet coins have no value; this is a prototype.', 'small muted');

    const check = node('section', '', 'listing-check'); check.setAttribute('aria-label', 'Check your result');
    check.append(node('h3', 'Check your result'), node('p', 'After clearing, import the audit bundle the operator published and, optionally, your receipt. DarkZec re-verifies the whole auction here and shows what happened to your bid.', 'small'));
    this.#bundleFile.type = 'file'; this.#bundleFile.accept = 'application/json,.json'; this.#bundleFile.hidden = true; this.#bundleFile.id = 'listing-bundle-file'; this.#bundleFile.setAttribute('aria-label', 'Audit bundle file');
    this.#receiptFile.type = 'file'; this.#receiptFile.accept = 'application/json,.json,text/plain,.txt'; this.#receiptFile.hidden = true; this.#receiptFile.id = 'listing-receipt-file'; this.#receiptFile.setAttribute('aria-label', 'Your receipt file');
    const actions = node('div', '', 'tool-actions');
    const importBundle = node('button', 'Import audit bundle', 'button quiet'); importBundle.type = 'button'; importBundle.id = 'listing-import-bundle';
    const importReceipt = node('button', 'Import my receipt', 'button quiet'); importReceipt.type = 'button'; importReceipt.id = 'listing-import-receipt';
    actions.append(importBundle, importReceipt);
    const signal = this.#life.signal;
    const sample = this.#handlers.published?.(auction.auctionId);
    if (sample) {
      const load = node('button', 'Load the published result and the winner\'s receipt', 'button quiet'); load.type = 'button'; load.id = 'listing-load-published'; actions.append(load);
      load.addEventListener('click', () => { void (async () => {
        try { this.#bundle = await sample.bundle(); this.#receipt = (await sample.receipt()).trim(); await this.#evaluate(); } catch { this.#say('The published result could not be loaded.', false); }
      })(); }, { signal });
    }
    importBundle.addEventListener('click', () => { this.#bundleFile.value = ''; this.#bundleFile.click(); }, { signal });
    importReceipt.addEventListener('click', () => { this.#receiptFile.value = ''; this.#receiptFile.click(); }, { signal });
    this.#bundleFile.addEventListener('change', () => { void this.#read(this.#bundleFile, AUDIT_BUNDLE_MAX_BYTES, text => { this.#bundle = text; }); }, { signal });
    this.#receiptFile.addEventListener('change', () => { void this.#read(this.#receiptFile, 4096, text => { this.#receipt = text.trim(); }); }, { signal });
    this.#result.id = 'listing-result'; this.#result.setAttribute('role', 'status');
    check.append(this.#bundleFile, this.#receiptFile, actions, this.#result);
    const buttons = node('div', '', 'tool-actions'); buttons.append(bid, reminders);
    body.append(practiceNote, rules, timeline, facts, note, trust, node('p', 'Vault address', 'micro'), vault, node('h3', 'How to bid'), steps, buttons, bidNote, check);
    this.#host.append(heading, body);
  }

  async #read(input: HTMLInputElement, limit: number, store: (text: string) => void): Promise<void> {
    const file = input.files?.[0]; input.value = ''; if (!file) return;
    if (file.size === 0 || file.size > limit) { this.#say('That file is empty or too large.', false); return; }
    store(await file.text()); await this.#evaluate();
  }
  #say(message: string, ok: boolean | undefined): void {
    this.#result.replaceChildren(); const line = node('p', message, `tool-status${ok === true ? ' is-ok' : ok === false ? ' is-bad' : ''}`); this.#result.append(line);
  }

  async #evaluate(): Promise<void> {
    const opened = this.#opened; if (!opened || !this.#bundle) { this.#say('Import the audit bundle to continue.', undefined); return; }
    let bundle: ReturnType<typeof parseAuditBundle>;
    try { bundle = parseAuditBundle(this.#bundle); } catch { this.#say('That file is not a DarkZec audit bundle.', false); return; }
    // The bundle must be the auction this link promised, not merely some valid auction.
    if (!bundle.listing || await listingDigest(bundle.listing) !== opened.digest) { this.#say('This bundle is not for this auction: its signed listing differs from the one in your link.', false); return; }
    const { report, source, tip } = await this.#handlers.verify(this.#bundle);
    const failed = report.checks.filter(check => !check.ok && check.skipped !== true);
    this.#result.replaceChildren();
    const passed = report.checks.filter(check => check.ok).length;
    const chain = report.checks.some(check => check.skipped) ? ' (on-chain checks need a Zcash light client; run scripts/verify-chain.ts)' :
      source === 'live' ? ` (the on-chain checks read live from testnet at height ${tip})` : source === 'recorded' ? ` (the on-chain checks used the chain snapshot recorded at height ${tip})` : '';
    this.#result.append(node('p', report.ok ? `AUDIT VERIFIED / ${passed} checks passed${chain}.` :
      `AUDIT FAILED / ${failed.map(check => check.label).join(', ')}. Do not trust this result.`, `tool-status ${report.ok ? 'is-ok' : 'is-bad'}`));
    const { result, auction } = bundle;
    const lines = node('dl', '', 'receipt listing-outcome');
    lines.append(fact(auction.procurement ? 'Contract price' : 'Clearing price', `${result.clearingPrice} ZEC`, 'listing-clearing'), fact('Lots filled', `${result.filled} of ${auction.supply}`));
    if (this.#receipt) {
      try {
        const mine = await commitment(parseReceiptText(this.#receipt, 'testnet'));
        const row = result.allocations.find(item => item.commitment === mine);
        if (row) {
          const won = row.filled > 0;
          lines.append(fact('Your bid', won ? `WON ${row.filled} of ${row.requested} at ${result.clearingPrice} ZEC` : 'did not win', 'listing-mine'),
            fact(auction.procurement ? 'Paid by DarkZec' : 'You paid', `${row.paid} ZEC`), fact('Refunded to you', `${row.refundAmount} ZEC`, 'listing-refund'), fact('Refund address', `${row.refundAddress.slice(0, 20)}…`));
        } else if (bundle.commitments.includes(mine)) lines.append(fact('Your bid', `was committed but not revealed in time; its ${auction.collateral} ZEC collateral was burned`, 'listing-mine'));
        else lines.append(fact('Your bid', 'is not in this auction (check that this is your receipt for this link)', 'listing-mine'));
      } catch { lines.append(fact('Your bid', 'your receipt could not be read', 'listing-mine')); }
    }
    this.#result.append(lines);
    const settlement = bundle.settlement;
    if (settlement) this.#result.append(node('p', `Settled on chain in ${settlement.txids.map(id => `${id.slice(0, 16)}…`).join(', ')}. The vault's viewing key is published in the bundle, so every refund can be checked.`, 'small'));
    else this.#result.append(node('p', 'Not settled on chain yet: refunds are announced but not paid until the operator settles and publishes the viewing key.', 'small muted'));
    // Keep zatoshi-exact amounts visible to screen readers and tests.
    this.#result.dataset.paid = formatZec(result.allocations.reduce((total, row) => total + parseZec(row.paid), 0n));
  }
  destroy(): void { this.#life.destroy(); this.#host.replaceChildren(); }
}
