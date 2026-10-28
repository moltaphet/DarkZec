import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';
import type { Phase } from '../simulation';

export type LiveMode = 'uniform' | 'unit' | 'vickrey' | 'procurement';
export interface LiveAuctionSettings {
  readonly vault: string; readonly auctionId: string; readonly collateral: string; readonly reserve: string;
  readonly mode: LiveMode; readonly revealMinutes: number; readonly commitMinutes: number; readonly lots: number;
  readonly title: string; readonly description: string; readonly keyPassphrase: string;
}
export interface ResumeInput { readonly link: string; readonly keyFile: string; readonly passphrase: string }
export type PracticeStep = 'commits' | 'advance' | 'reveals';
export interface LiveAuctionHandlers {
  start(settings: LiveAuctionSettings): Promise<void>;
  sync(): Promise<void>;
  leave(): Promise<void>;
  copy(text: string): Promise<void>;
  resume(input: ResumeInput): Promise<void>;
  practice(settings: LiveAuctionSettings): Promise<void>;
  practiceStep(step: PracticeStep): Promise<void>;
}
export interface LiveAuctionState {
  readonly live: boolean; readonly phase: Phase | undefined; readonly busy: boolean; readonly summary: string; readonly ok?: boolean;
  /** Shareable bidder link, once this auction has a signed listing. */
  readonly link?: string | undefined;
  /** The same link on this page's own origin, for previewing the bidder page before the site that hosts it is updated. */
  readonly preview?: string | undefined;
  /** A practice auction on the in-memory chain: the panel plays the bidders and shows the next step. */
  readonly practice?: boolean;
  readonly practiceHint?: string;
}

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element;
};
function field(label: string, control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, id: string): HTMLElement {
  const wrap = node('div'); const caption = node('label', label); caption.htmlFor = id; control.id = id; wrap.append(caption, control); return wrap;
}
function select(options: readonly (readonly [string, string])[], selected: string): HTMLSelectElement {
  const element = node('select');
  for (const [value, label] of options) { const option = node('option', label); option.value = value; option.selected = value === selected; element.append(option); }
  return element;
}

/** Operator controls for an auction whose commits and reveals arrive as shielded memos at a real testnet vault. */
export class LiveAuctionPanel implements Disposable {
  readonly #host: HTMLElement;
  readonly #life = new Lifetime();
  readonly #vault = node('textarea');
  readonly #auction = node('input');
  readonly #reserve = node('input');
  readonly #minutes = node('input');
  readonly #commitMinutes = node('input');
  readonly #lots = node('input');
  readonly #title = node('input');
  readonly #description = node('textarea');
  readonly #link = node('textarea');
  readonly #copyLink = node('button', 'Copy auction link', 'button primary');
  readonly #openLink = node('a', 'Preview bidder page ↗', 'button quiet');
  readonly #linkBox = node('div', '', 'live-link');
  readonly #keyPassphrase = node('input');
  readonly #practiceButton = node('button', 'Practice with a simulated chain', 'button quiet');
  readonly #resumeLink = node('textarea');
  readonly #resumeKey = node('input');
  readonly #resumePick = node('button', 'Choose operator key file', 'button quiet');
  readonly #resumeName = node('span', 'No key file chosen', 'small muted');
  readonly #resumePassphrase = node('input');
  readonly #resumeStart = node('button', 'Resume auction', 'button primary');
  readonly #practiceBox = node('div', '', 'practice-box');
  readonly #practiceHint = node('p', '', 'small');
  readonly #practiceButtons: HTMLButtonElement[] = [];
  #resumeText = '';
  #url = '';
  readonly #collateral = select([['0.1', '0.1 ZEC'], ['1', '1 ZEC'], ['10', '10 ZEC'], ['100', '100 ZEC']], '10');
  readonly #mode = select([['uniform', 'Uniform price / 10 lots'], ['unit', 'Unit demand / 10 lots, truthful'], ['vickrey', 'Vickrey / 1 lot, second price'], ['procurement', 'Procurement / lowest offers win']], 'uniform');
  readonly #start = node('button', 'Start live testnet auction', 'button primary');
  readonly #sync = node('button', 'Sync from vault', 'button quiet');
  readonly #leave = node('button', 'Return to demo auction', 'reset');
  readonly #status = node('p', '', 'small tool-status');
  readonly #details = node('details');
  constructor(host: HTMLElement, run: (operation: () => Promise<void>) => void, handlers: LiveAuctionHandlers) {
    this.#host = host; host.className = 'panel live-auction'; host.setAttribute('data-independent-controls', ''); host.setAttribute('aria-label', 'Live testnet auction');
    const heading = node('div', '', 'panel-heading'); heading.append(node('h2', 'Live testnet auction'), node('span', 'COMMITS AND REVEALS FROM SHIELDED MEMOS'));
    const content = node('div', '', 'tool-content');
    this.#details.append(node('summary', 'Run this auction against a real Zcash testnet vault'));
    const help = node('p', 'Describe what you are auctioning and set the deadlines. The page signs a listing with this session\'s key and gives you a link to share: bidders open it on darkzec.xyz, see the rules and deadlines, and pay the collateral with their own wallet. Deadlines are Zcash block heights, so they cannot be moved. The local wallet must already view the vault address (use a fresh vault account for each auction). Sync reads only confirmed shielded notes at the vault\'s Orchard receiver: commits up to the commit deadline, reveals after it. Order follows confirmations, oldest first. No funds move from this page.');
    this.#vault.spellcheck = false; this.#vault.placeholder = "Vault utest1… address viewed by your local wallet";
    this.#auction.value = 'LIVE-001'; this.#auction.maxLength = 48; this.#auction.spellcheck = false;
    this.#reserve.value = '0.5'; this.#reserve.inputMode = 'decimal'; this.#reserve.maxLength = 17;
    this.#minutes.value = '30'; this.#minutes.inputMode = 'numeric'; this.#minutes.maxLength = 4;
    this.#commitMinutes.value = '30'; this.#commitMinutes.inputMode = 'numeric'; this.#commitMinutes.maxLength = 4;
    this.#lots.value = '10'; this.#lots.inputMode = 'numeric'; this.#lots.maxLength = 3;
    this.#title.maxLength = 80; this.#title.placeholder = 'What is being auctioned';
    this.#description.maxLength = 600; this.#description.placeholder = 'Optional: what the winner gets, how it is delivered, contact';
    const grid = node('div', '', 'tool-grid');
    grid.append(field('Auction ID', this.#auction, 'live-auction-id'), field('Collateral tier', this.#collateral, 'live-collateral'), field('Clearing mode', this.#mode, 'live-mode'),
      field('Lots (ignored for Vickrey)', this.#lots, 'live-lots'), field('Reserve or ceiling / ZEC', this.#reserve, 'live-reserve'),
      field('Bidding open for / minutes', this.#commitMinutes, 'live-commit-minutes'), field('Reveal window / minutes', this.#minutes, 'live-minutes'));
    this.#link.readOnly = true; this.#link.id = 'live-link'; this.#link.spellcheck = false; this.#link.setAttribute('aria-label', 'Shareable auction link');
    this.#copyLink.type = 'button'; this.#copyLink.id = 'live-copy-link'; this.#openLink.id = 'live-open-link'; this.#openLink.target = '_blank'; this.#openLink.rel = 'noreferrer';
    this.#keyPassphrase.type = 'password'; this.#keyPassphrase.autocomplete = 'new-password'; this.#keyPassphrase.placeholder = 'Encrypts the operator key backup you download';
    this.#practiceButton.type = 'button'; this.#practiceButton.id = 'live-practice';
    const resume = node('details', '', 'resume-details'); resume.id = 'resume-details'; resume.append(node('summary', 'Resume an auction (after a crash, reload or lost connection)'));
    this.#resumeLink.id = 'resume-link'; this.#resumeLink.spellcheck = false; this.#resumeLink.placeholder = 'The auction link (…/#/a/…)';
    this.#resumeKey.type = 'file'; this.#resumeKey.accept = 'application/json,.json'; this.#resumeKey.hidden = true; this.#resumeKey.id = 'resume-key-file'; this.#resumeKey.setAttribute('aria-label', 'Operator key file');
    this.#resumePick.type = 'button'; this.#resumePick.id = 'resume-pick'; this.#resumeName.id = 'resume-key-name';
    this.#resumePassphrase.type = 'password'; this.#resumePassphrase.autocomplete = 'off'; this.#resumePassphrase.id = 'resume-passphrase'; this.#resumeStart.type = 'button'; this.#resumeStart.id = 'resume-start';
    const resumeActions = node('div', '', 'tool-actions'); resumeActions.append(this.#resumePick, this.#resumeName);
    resume.append(node('p', 'Your auction lives on the chain, not in this tab. With the auction link and the encrypted operator key file you downloaded when you started, this page rebuilds the same signed auction: the original listing signature is kept, and commits, close and reveals are replayed from the chain. Then use Sync, Close and Finalize as usual.', 'small'),
      field('Auction link', this.#resumeLink, 'resume-link'), this.#resumeKey, resumeActions, field('Key file passphrase', this.#resumePassphrase, 'resume-passphrase'), this.#resumeStart);
    this.#practiceBox.hidden = true;
    const practiceActions = node('div', '', 'tool-actions');
    for (const [label, id, step] of [['Simulate 3 bidder payments', 'practice-pay-commits', 'commits'], ['Advance the chain', 'practice-advance', 'advance'], ['Simulate 2 reveals', 'practice-pay-reveals', 'reveals']] as const) {
      const button = node('button', label, 'button quiet'); button.type = 'button'; button.id = id; button.dataset.step = step; this.#practiceButtons.push(button); practiceActions.append(button);
    }
    this.#practiceHint.id = 'practice-hint';
    this.#practiceBox.append(node('h3', 'Practice mode'), node('p', 'A simulated chain, nothing real: the buttons play the bidders. Everything else is the real flow: sync, close, finalize, audit.', 'small'), this.#practiceHint, practiceActions);
    const linkActions = node('div', '', 'tool-actions'); linkActions.append(this.#copyLink, this.#openLink);
    this.#linkBox.append(node('p', 'Auction link. Everything bidders need is inside it and is signed by this session\'s key; keep this tab open until you clear, because the key lives only here.', 'small'), this.#link, linkActions); this.#linkBox.hidden = true;
    const actions = node('div', '', 'tool-actions');
    for (const [button, id] of [[this.#start, 'live-start'], [this.#practiceButton, 'live-practice'], [this.#sync, 'live-sync'], [this.#leave, 'live-leave']] as const) { button.type = 'button'; button.id = id; actions.append(button); }
    this.#status.id = 'live-status'; this.#status.setAttribute('role', 'status');
    this.#details.append(help, field('Title', this.#title, 'live-title'), field('Description', this.#description, 'live-description'), field('Vault address (testnet, Orchard-capable)', this.#vault, 'live-vault'), field('Operator key backup passphrase', this.#keyPassphrase, 'live-key-passphrase'), grid, actions, this.#linkBox, this.#practiceBox, resume);
    content.append(this.#details, this.#status); host.append(heading, content);
    const signal = this.#life.signal;
    this.#start.addEventListener('click', () => run(() => handlers.start(this.#settings())), { signal });
    this.#sync.addEventListener('click', () => run(() => handlers.sync()), { signal });
    this.#leave.addEventListener('click', () => run(() => handlers.leave()), { signal });
    this.#copyLink.addEventListener('click', () => run(() => handlers.copy(this.#url)), { signal });
    this.#practiceButton.addEventListener('click', () => run(() => handlers.practice(this.#settings(true))), { signal });
    for (const button of this.#practiceButtons) button.addEventListener('click', () => run(() => handlers.practiceStep(button.dataset.step as PracticeStep)), { signal });
    this.#resumePick.addEventListener('click', () => { this.#resumeKey.value = ''; this.#resumeKey.click(); }, { signal });
    this.#resumeKey.addEventListener('change', () => { void (async () => {
      const file = this.#resumeKey.files?.[0]; this.#resumeKey.value = ''; if (!file) return;
      if (file.size === 0 || file.size > 4096) { this.#resumeText = ''; this.#resumeName.textContent = 'That file is not an operator key file.'; return; }
      this.#resumeText = await file.text(); this.#resumeName.textContent = file.name;
    })(); }, { signal });
    this.#resumeStart.addEventListener('click', () => run(() => handlers.resume({ link: this.#resumeLink.value.trim(), keyFile: this.#resumeText, passphrase: this.#resumePassphrase.value })), { signal });
  }
  #settings(practice = false): LiveAuctionSettings {
    const minutes = Number(this.#minutes.value);
    if (!/^[1-9]\d{0,3}$/.test(this.#minutes.value) || minutes > 1440) throw new Error('The reveal window must be 1–1440 minutes.');
    if (!/^[1-9]\d{0,3}$/.test(this.#commitMinutes.value) || Number(this.#commitMinutes.value) > 10_080) throw new Error('Bidding must stay open 1–10080 minutes.');
    const mode = this.#mode.value; if (mode !== 'uniform' && mode !== 'unit' && mode !== 'vickrey' && mode !== 'procurement') throw new Error('Select a clearing mode.');
    if (mode !== 'vickrey' && (!/^[1-9]\d{0,2}$/.test(this.#lots.value) || Number(this.#lots.value) > 100)) throw new Error('Lots must be a whole number from 1 to 100.');
    return Object.freeze({ vault: this.#vault.value.trim(), auctionId: this.#auction.value.trim(), collateral: this.#collateral.value, reserve: this.#reserve.value.trim(), mode, revealMinutes: minutes,
      commitMinutes: Number(this.#commitMinutes.value), lots: mode === 'vickrey' ? 1 : Number(this.#lots.value), title: this.#title.value.trim(), description: this.#description.value.trim(), keyPassphrase: practice ? '' : this.#keyPassphrase.value });
  }
  update(state: LiveAuctionState): void {
    for (const control of [this.#vault, this.#auction, this.#reserve, this.#minutes, this.#commitMinutes, this.#lots, this.#title, this.#description, this.#collateral, this.#mode]) control.disabled = state.busy || state.live;
    this.#url = state.link ?? ''; this.#linkBox.hidden = this.#url === ''; this.#link.value = this.#url; this.#openLink.href = state.preview ?? (this.#url || '#');
    this.#copyLink.disabled = state.busy || this.#url === '';
    this.#practiceBox.hidden = state.practice !== true; this.#practiceHint.textContent = state.practiceHint ?? ''; for (const button of this.#practiceButtons) button.disabled = state.busy || state.practice !== true;
    this.#practiceButton.disabled = state.busy || state.live; this.#keyPassphrase.disabled = state.busy || state.live;
    for (const control of [this.#resumeLink, this.#resumePassphrase, this.#resumePick, this.#resumeStart]) control.disabled = state.busy || state.live;
    this.#start.disabled = state.busy || state.live;
    this.#sync.disabled = state.busy || !state.live || state.phase === 'cleared';
    this.#leave.disabled = state.busy || !state.live;
    if (state.live) this.#details.open = true;
    this.#status.textContent = state.summary;
    this.#status.classList.toggle('is-ok', state.ok === true); this.#status.classList.toggle('is-bad', state.ok === false);
  }
  destroy(): void { this.#life.destroy(); this.#host.replaceChildren(); }
}
