import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';
import type { Phase } from '../simulation';

export type LiveMode = 'uniform' | 'unit' | 'vickrey' | 'procurement';
export interface LiveAuctionSettings {
  readonly vault: string; readonly auctionId: string; readonly collateral: string; readonly reserve: string;
  readonly mode: LiveMode; readonly revealMinutes: number; readonly commitMinutes: number; readonly lots: number;
  readonly title: string; readonly description: string;
}
export interface LiveAuctionHandlers {
  start(settings: LiveAuctionSettings): Promise<void>;
  sync(): Promise<void>;
  leave(): Promise<void>;
  copy(text: string): Promise<void>;
}
export interface LiveAuctionState {
  readonly live: boolean; readonly phase: Phase | undefined; readonly busy: boolean; readonly summary: string; readonly ok?: boolean;
  /** Shareable bidder link, once this auction has a signed listing. */
  readonly link?: string | undefined;
  /** The same link on this page's own origin, for previewing the bidder page before the site that hosts it is updated. */
  readonly preview?: string | undefined;
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
    const linkActions = node('div', '', 'tool-actions'); linkActions.append(this.#copyLink, this.#openLink);
    this.#linkBox.append(node('p', 'Auction link. Everything bidders need is inside it and is signed by this session\'s key; keep this tab open until you clear, because the key lives only here.', 'small'), this.#link, linkActions); this.#linkBox.hidden = true;
    const actions = node('div', '', 'tool-actions');
    for (const [button, id] of [[this.#start, 'live-start'], [this.#sync, 'live-sync'], [this.#leave, 'live-leave']] as const) { button.type = 'button'; button.id = id; actions.append(button); }
    this.#status.id = 'live-status'; this.#status.setAttribute('role', 'status');
    this.#details.append(help, field('Title', this.#title, 'live-title'), field('Description', this.#description, 'live-description'), field('Vault address (testnet, Orchard-capable)', this.#vault, 'live-vault'), grid, actions, this.#linkBox);
    content.append(this.#details, this.#status); host.append(heading, content);
    const signal = this.#life.signal;
    this.#start.addEventListener('click', () => run(() => handlers.start(this.#settings())), { signal });
    this.#sync.addEventListener('click', () => run(() => handlers.sync()), { signal });
    this.#leave.addEventListener('click', () => run(() => handlers.leave()), { signal });
    this.#copyLink.addEventListener('click', () => run(() => handlers.copy(this.#url)), { signal });
  }
  #settings(): LiveAuctionSettings {
    const minutes = Number(this.#minutes.value);
    if (!/^[1-9]\d{0,3}$/.test(this.#minutes.value) || minutes > 1440) throw new Error('The reveal window must be 1–1440 minutes.');
    if (!/^[1-9]\d{0,3}$/.test(this.#commitMinutes.value) || Number(this.#commitMinutes.value) > 10_080) throw new Error('Bidding must stay open 1–10080 minutes.');
    const mode = this.#mode.value; if (mode !== 'uniform' && mode !== 'unit' && mode !== 'vickrey' && mode !== 'procurement') throw new Error('Select a clearing mode.');
    if (mode !== 'vickrey' && (!/^[1-9]\d{0,2}$/.test(this.#lots.value) || Number(this.#lots.value) > 100)) throw new Error('Lots must be a whole number from 1 to 100.');
    return Object.freeze({ vault: this.#vault.value.trim(), auctionId: this.#auction.value.trim(), collateral: this.#collateral.value, reserve: this.#reserve.value.trim(), mode, revealMinutes: minutes,
      commitMinutes: Number(this.#commitMinutes.value), lots: mode === 'vickrey' ? 1 : Number(this.#lots.value), title: this.#title.value.trim(), description: this.#description.value.trim() });
  }
  update(state: LiveAuctionState): void {
    for (const control of [this.#vault, this.#auction, this.#reserve, this.#minutes, this.#commitMinutes, this.#lots, this.#title, this.#description, this.#collateral, this.#mode]) control.disabled = state.busy || state.live;
    this.#url = state.link ?? ''; this.#linkBox.hidden = this.#url === ''; this.#link.value = this.#url; this.#openLink.href = state.preview ?? (this.#url || '#');
    this.#copyLink.disabled = state.busy || this.#url === '';
    this.#start.disabled = state.busy || state.live;
    this.#sync.disabled = state.busy || !state.live || state.phase === 'cleared';
    this.#leave.disabled = state.busy || !state.live;
    if (state.live) this.#details.open = true;
    this.#status.textContent = state.summary;
    this.#status.classList.toggle('is-ok', state.ok === true); this.#status.classList.toggle('is-bad', state.ok === false);
  }
  destroy(): void { this.#life.destroy(); this.#host.replaceChildren(); }
}
