import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';
import type { OperatorView } from '../simulation';

export interface OperatorPanelState {
  readonly view: OperatorView; readonly live: boolean; readonly vault: string; readonly publicKey: string;
  readonly statements: number; readonly bundleReady: boolean; readonly busy: boolean;
}
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element;
};

/**
 * The operator's side of the same session, rendered from the ledger's operator view only. It makes the privacy claim
 * visible: before close the operator holds hashes and nothing else; bid data appears only as reveals verify.
 */
export class OperatorPanel implements Disposable {
  readonly #host: HTMLElement;
  readonly #life = new Lifetime();
  readonly #metrics = node('dl', '', 'operator-metrics');
  readonly #note = node('p');
  readonly #table = node('tbody');
  readonly #tableWrap = node('div', '', 'table-scroll max-w-full overflow-x-auto');
  readonly #download = node('button', 'Download audit bundle (.json)', 'button quiet');
  constructor(host: HTMLElement, download: () => void) {
    this.#host = host; host.className = 'panel operator-view'; host.setAttribute('data-independent-controls', ''); host.setAttribute('aria-label', 'Operator view');
    const heading = node('div', '', 'panel-heading'); heading.append(node('h2', 'Operator view'), node('span', 'WHAT THE VAULT OPERATOR HOLDS'));
    const content = node('div', '', 'tool-content');
    const table = node('table'); table.setAttribute('aria-label', 'Bid data held by the operator');
    const head = node('thead'); const row = node('tr'); for (const label of ['Entry', 'Commitment', 'Limit / ZEC', 'Lots']) { const th = node('th', label); th.scope = 'col'; row.append(th); }
    head.append(row); table.append(head, this.#table); this.#tableWrap.append(table); this.#tableWrap.id = 'operator-bids'; this.#tableWrap.tabIndex = 0; this.#tableWrap.setAttribute('role', 'region'); this.#tableWrap.setAttribute('aria-label', 'Revealed bids held by the operator');
    this.#note.id = 'operator-note'; this.#download.type = 'button'; this.#download.id = 'audit-download';
    const actions = node('div', '', 'tool-actions'); actions.append(this.#download);
    content.append(this.#metrics, this.#note, this.#tableWrap, actions); host.append(heading, content);
    this.#download.addEventListener('click', download, { signal: this.#life.signal });
  }
  update(state: OperatorPanelState): void {
    const { view } = state;
    const metric = (label: string, value: string, id: string): HTMLElement => { const group = node('div'); const dd = node('dd', value); dd.id = id; group.append(node('dt', label), dd); return group; };
    this.#metrics.replaceChildren(
      metric('Source', state.live ? `Live testnet vault ${state.vault.slice(0, 14)}…` : 'Demo fixtures', 'operator-source'),
      metric('Commitments held', `${view.commitments.length} hashes`, 'operator-commitments'),
      metric('Bid data held', view.reveals.length === 0 ? 'None' : `${view.reveals.length} revealed bid${view.reveals.length === 1 ? '' : 's'}`, 'operator-bids-held'),
      metric('Signed statements', String(state.statements), 'operator-statements'),
      metric('Signing key', `P-256 ${state.publicKey.slice(2, 18)}…`, 'operator-key'));
    this.#note.textContent = view.phase === 'open'
      ? 'Commit phase: the operator holds only commitment hashes and the fixed collateral. No price, quantity, salt or refund address has reached it, so resting bids cannot be front-run.'
      : view.phase === 'reveal'
        ? 'Reveal window: the operator signed the frozen root at close and signs an acknowledgement for every reveal it accepts. It now sees the revealed bids below, and only those.'
        : 'Cleared: the operator signed the result. The audit bundle lets anyone re-run this auction and check every signature without trusting the operator.';
    this.#table.replaceChildren();
    for (const reveal of view.reveals) {
      const row = node('tr'); for (const value of [String(reveal.index + 1).padStart(2, '0'), `${reveal.commitment.slice(0, 16)}…`, reveal.bid.price, String(reveal.bid.quantity)]) row.append(node('td', value));
      this.#table.append(row);
    }
    this.#tableWrap.hidden = view.reveals.length === 0;
    this.#download.disabled = state.busy || !state.bundleReady;
  }
  destroy(): void { this.#life.destroy(); this.#host.replaceChildren(); }
}
