import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';
import type { Phase } from '../simulation';

export type LiveMode = 'uniform' | 'unit' | 'vickrey';
export interface LiveAuctionSettings {
  readonly vault: string; readonly auctionId: string; readonly collateral: string; readonly reserve: string;
  readonly mode: LiveMode; readonly revealMinutes: number;
}
export interface LiveAuctionHandlers {
  start(settings: LiveAuctionSettings): Promise<void>;
  sync(): Promise<void>;
  leave(): Promise<void>;
}
export interface LiveAuctionState { readonly live: boolean; readonly phase: Phase | undefined; readonly busy: boolean; readonly summary: string; readonly ok?: boolean }

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
  readonly #collateral = select([['0.1', '0.1 ZEC'], ['1', '1 ZEC'], ['10', '10 ZEC'], ['100', '100 ZEC']], '10');
  readonly #mode = select([['uniform', 'Uniform price / 10 lots'], ['unit', 'Unit demand / 10 lots, truthful'], ['vickrey', 'Vickrey / 1 lot, second price']], 'uniform');
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
    const help = node('p', 'Bidders pay the collateral tier to the vault with a commit memo from the Wallet request tab, then pay a small reveal memo after close. The local wallet must already view the vault address. Sync reads only confirmed shielded notes at the vault\'s Orchard receiver (Ironwood pool since NU6.3, or legacy Orchard): commits before close, reveals after it. Order follows confirmations, oldest first, so the operator does not choose tie priority. No funds move from this page.');
    this.#vault.spellcheck = false; this.#vault.placeholder = "Vault utest1… address viewed by your local wallet";
    this.#auction.value = 'LIVE-001'; this.#auction.maxLength = 48; this.#auction.spellcheck = false;
    this.#reserve.value = '0.5'; this.#reserve.inputMode = 'decimal'; this.#reserve.maxLength = 17;
    this.#minutes.value = '30'; this.#minutes.inputMode = 'numeric'; this.#minutes.maxLength = 4;
    const grid = node('div', '', 'tool-grid');
    grid.append(field('Auction ID', this.#auction, 'live-auction-id'), field('Collateral tier', this.#collateral, 'live-collateral'), field('Clearing mode', this.#mode, 'live-mode'),
      field('Reserve / ZEC', this.#reserve, 'live-reserve'), field('Reveal window / minutes', this.#minutes, 'live-minutes'));
    const actions = node('div', '', 'tool-actions');
    for (const [button, id] of [[this.#start, 'live-start'], [this.#sync, 'live-sync'], [this.#leave, 'live-leave']] as const) { button.type = 'button'; button.id = id; actions.append(button); }
    this.#status.id = 'live-status'; this.#status.setAttribute('role', 'status');
    this.#details.append(help, field('Vault address (testnet, Orchard-capable)', this.#vault, 'live-vault'), grid, actions);
    content.append(this.#details, this.#status); host.append(heading, content);
    const signal = this.#life.signal;
    this.#start.addEventListener('click', () => run(() => handlers.start(this.#settings())), { signal });
    this.#sync.addEventListener('click', () => run(() => handlers.sync()), { signal });
    this.#leave.addEventListener('click', () => run(() => handlers.leave()), { signal });
  }
  #settings(): LiveAuctionSettings {
    const minutes = Number(this.#minutes.value);
    if (!/^[1-9]\d{0,3}$/.test(this.#minutes.value) || minutes > 1440) throw new Error('The reveal window must be 1–1440 minutes.');
    const mode = this.#mode.value; if (mode !== 'uniform' && mode !== 'unit' && mode !== 'vickrey') throw new Error('Select a clearing mode.');
    return Object.freeze({ vault: this.#vault.value.trim(), auctionId: this.#auction.value.trim(), collateral: this.#collateral.value, reserve: this.#reserve.value.trim(), mode, revealMinutes: minutes });
  }
  update(state: LiveAuctionState): void {
    for (const control of [this.#vault, this.#auction, this.#reserve, this.#minutes, this.#collateral, this.#mode]) control.disabled = state.busy || state.live;
    this.#start.disabled = state.busy || state.live;
    this.#sync.disabled = state.busy || !state.live || state.phase === 'cleared';
    this.#leave.disabled = state.busy || !state.live;
    if (state.live) this.#details.open = true;
    this.#status.textContent = state.summary;
    this.#status.classList.toggle('is-ok', state.ok === true); this.#status.classList.toggle('is-bad', state.ok === false);
  }
  destroy(): void { this.#life.destroy(); this.#host.replaceChildren(); }
}
