import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';
import { parseBidMemo, serializeBidMemo } from '../protocol/memo';
import { downloadText, readReceiptFile, receiptFilename } from '../lib/receipt-file';
import type { BidMemo, PreparedBid } from '../protocol/memo';
import type { PublicSnapshot } from '../simulation';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); element.textContent = text; return element;
};
/** Bidder-owned receipt cache, deliberately outside the hash-only auction ledger. */
export class RevealPanel implements Disposable {
  readonly #host: HTMLElement;
  readonly #receipts = new Map<string, BidMemo>();
  /** Receipts the bidder has downloaded (or that belong to simulated demo bidders). */
  readonly #saved = new Set<string>();
  readonly #life = new Lifetime();
  readonly #select = node('select');
  readonly #receipt = node('textarea');
  readonly #details = node('details');
  readonly #reveal = node('button', 'Reveal selected receipt');
  readonly #all = node('button', 'Reveal all local receipts / demo');
  readonly #expire = node('button', 'Advance reveal deadline / judge only');
  readonly #download = node('button', 'Download receipt (.json)');
  readonly #import = node('button', 'Import receipt file');
  readonly #file = node('input');
  readonly #status = node('p');
  #importedReceipt: BidMemo | undefined;
  constructor(host: HTMLElement, run: (operation: () => Promise<void>) => void,
    reveal: (bid: BidMemo) => Promise<void>, expire: () => void) {
    this.#host = host; host.className = 'panel reveal-panel'; host.setAttribute('data-independent-controls', '');
    host.setAttribute('aria-label', 'Bidder reveal workspace');
    const heading = node('div'); heading.className = 'panel-heading'; heading.append(node('h2', '03 / Commit → Reveal'), node('span', 'BIDDER WORKSPACE'));
    const content = node('div'); content.className = 'reveal-content';
    const help = node('p', 'Keep this receipt private until the reveal window. Commit payments contain only an auction ID and hash. The operator cannot recover missing receipts, and a commitment that is not revealed before the deadline forfeits its full collateral. This browser hosts both roles for the demo; it does not isolate them from a compromised device.');
    const label = node('label', 'Your locally held reveal receipts'); label.htmlFor = 'reveal-select'; this.#select.id = 'reveal-select';
    this.#details.append(node('summary', 'Inspect / copy or paste a private reveal receipt'));
    this.#receipt.id = 'reveal-receipt'; this.#receipt.spellcheck = false; this.#receipt.maxLength = 512;
    this.#receipt.placeholder = 'Paste canonical reveal JSON saved by the bidder'; this.#receipt.setAttribute('aria-label', 'Private reveal receipt');
    this.#details.append(this.#receipt, node('p', 'Copy this canonical JSON to secure local storage before leaving the page. It includes your private price, quantity, salt and refund address. No receipt is automatically persisted.'));
    const actions = node('div'); actions.className = 'reveal-actions';
    this.#file.type = 'file'; this.#file.accept = 'application/json,.json'; this.#file.id = 'reveal-file'; this.#file.hidden = true;
    this.#file.setAttribute('aria-label', 'Reveal receipt file');
    for (const [button, id] of [[this.#reveal, 'reveal-own'], [this.#all, 'reveal-all'], [this.#download, 'reveal-download'], [this.#import, 'reveal-import'], [this.#expire, 'reveal-expire']] as const) {
      button.type = 'button'; button.id = id; button.className = 'button quiet'; actions.append(button);
    }
    this.#reveal.classList.add('primary'); this.#status.id = 'reveal-status'; this.#status.setAttribute('role', 'status');
    content.append(help, label, this.#select, this.#details, actions, this.#file, this.#status); host.append(heading, content);
    const fill = (): void => {
      if (!this.#details.open) { this.#receipt.value = ''; return; }
      this.#receipt.value = this.#importedReceipt ? serializeBidMemo(this.#importedReceipt, 'testnet') : this.#serialized();
    };
    this.#details.addEventListener('toggle', fill, { signal: this.#life.signal });
    this.#select.addEventListener('change', () => { this.#importedReceipt = undefined; fill(); }, { signal: this.#life.signal });
    this.#reveal.addEventListener('click', () => run(async () => {
      const text = this.#receipt.value || (this.#importedReceipt ? serializeBidMemo(this.#importedReceipt, 'testnet') : this.#serialized());
      await reveal(parseBidMemo(text, 'testnet')); this.#importedReceipt = undefined; this.#details.open = false; this.#receipt.value = '';
    }), { signal: this.#life.signal });
    this.#all.addEventListener('click', () => run(async () => {
      for (const [hash, bid] of this.#receipts) if (!this.#verified.has(hash)) await reveal(bid);
      this.#importedReceipt = undefined; this.#details.open = false; this.#receipt.value = '';
    }), { signal: this.#life.signal });
    this.#expire.addEventListener('click', () => run(async () => { expire(); }), { signal: this.#life.signal });
    this.#download.addEventListener('click', () => run(async () => {
      const hash = this.#select.value; const bid = this.#receipts.get(hash);
      if (!bid) throw new Error('Select a receipt to download.');
      downloadText(receiptFilename(bid, hash), this.#serialized()); this.#saved.add(hash); this.#refresh();
    }), { signal: this.#life.signal });
    this.#import.addEventListener('click', () => { this.#file.value = ''; this.#file.click(); }, { signal: this.#life.signal });
    this.#file.addEventListener('change', () => {
      const file = this.#file.files?.[0]; this.#file.value = ''; if (!file) return;
      run(async () => {
        const bid = await readReceiptFile(file, 'testnet');
        this.#importedReceipt = Object.freeze({ ...bid });
        this.#receipt.value = serializeBidMemo(bid, 'testnet'); this.#details.open = true;
        this.#note = 'Receipt file loaded and validated. Choose Reveal selected receipt to submit it.';
        this.#refresh();
      });
    }, { signal: this.#life.signal });
    this.#receipt.addEventListener('input', () => { this.#note = ''; this.#importedReceipt = undefined; }, { signal: this.#life.signal });
    this.reset();
  }
  #verified = new Set<string>();
  #snapshot: PublicSnapshot | undefined;
  #busy = false;
  #note = '';
  #refresh(): void { if (this.#snapshot) this.update(this.#snapshot, this.#busy); }
  #serialized(): string { const bid = this.#receipts.get(this.#select.value); return bid ? serializeBidMemo(bid, 'testnet') : ''; }
  /** `saved` marks receipts that need no bidder backup, such as simulated demo bidders. */
  remember(prepared: PreparedBid, saved = false): void {
    if (this.#receipts.has(prepared.commitment)) return;
    if (saved) this.#saved.add(prepared.commitment);
    this.#receipts.set(prepared.commitment, Object.freeze({ ...prepared.reveal }));
    const option = node('option', `${this.#receipts.size} / ${prepared.commitment.slice(0, 16)}…`); option.value = prepared.commitment;
    this.#select.append(option); this.#select.value = prepared.commitment;
    this.#details.open = true; this.#receipt.value = this.#serialized();
  }
  update(snapshot: PublicSnapshot, busy: boolean): void {
    this.#snapshot = snapshot; this.#busy = busy;
    this.#verified = new Set(snapshot.revealed);
    const open = snapshot.revealOpen;
    this.#reveal.disabled = busy || !open;
    this.#all.disabled = busy || !open || ![...this.#receipts.keys()].some(hash => !this.#verified.has(hash));
    this.#expire.disabled = busy || snapshot.phase !== 'reveal' || snapshot.canClear;
    this.#select.disabled = busy || !this.#receipts.size; this.#receipt.disabled = busy || snapshot.phase === 'cleared';
    this.#download.disabled = busy || !this.#receipts.size; this.#import.disabled = busy || snapshot.phase === 'cleared';
    const unsaved = [...this.#receipts.keys()].filter(hash => !this.#saved.has(hash) && !this.#verified.has(hash)).length;
    const warning = unsaved > 0 && snapshot.phase !== 'cleared' ? ` ${unsaved} receipt${unsaved === 1 ? '' : 's'} not downloaded yet: save ${unsaved === 1 ? 'it' : 'them'} before closing, because a lost receipt cannot be revealed and forfeits its collateral.` : '';
    this.#status.textContent = `${snapshot.revealed.length}/${snapshot.commitments.length} valid reveals. ${snapshot.phase === 'open' ? 'Commit phase: reveal submission is locked.' : snapshot.phase === 'cleared' ? 'Finalized: only verified reveals entered clearing; unrevealed collateral was forfeited.' : snapshot.canClear ? 'Ready to finalize. Missing reveals are excluded and their collateral is forfeited.' : 'Reveal window open. Clearing stays locked until all reveals verify or the deadline expires.'}${warning}${this.#note ? ` ${this.#note}` : ''}`;
  }
  reset(): void { this.#receipts.clear(); this.#saved.clear(); this.#importedReceipt = undefined; this.#note = ''; this.#verified.clear(); this.#select.replaceChildren(); this.#receipt.value = ''; this.#details.open = false; }
  destroy(): void { this.reset(); this.#life.destroy(); this.#host.replaceChildren(); }
}
