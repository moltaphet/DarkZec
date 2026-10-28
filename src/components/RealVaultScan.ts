import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';
import type { ChainActivity, ChainOutput } from '../lib/settlement';
import { formatZec } from '../protocol/amount';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element;
};
const VIEWING_KEY = /^uviewtest1[023456789acdefghjklmnpqrstuvwxyz]{100,1200}$/;

/** A published key from a shipped testnet run, with the chain snapshot recorded when that run was verified. */
export interface PublishedKey { readonly id: string; readonly key: () => Promise<{ readonly viewingKey: string; readonly birthday: number }>; readonly snapshot: () => Promise<ChainActivity> }

/** DarkZec memo grammar: commit, reveal receipt, refund, proceeds or fee top-up. */
function memoKind(memo: string | null): string {
  if (memo === null) return 'NO MEMO';
  try {
    const value: unknown = JSON.parse(memo);
    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      if (record.t === 'commit') return 'COMMIT';
      if (record.v === 1 && typeof record.p === 'string') return 'REVEAL';
      if (record.t === 'refund' || record.t === 'proceeds' || record.t === 'fee') return String(record.t).toUpperCase();
    }
  } catch { /* plain-text memo */ }
  return 'MEMO';
}

/**
 * Real scanning of Zcash testnet with a unified full viewing key: the local DarkZec server builds a view-only light
 * wallet (zcash-devtool) and returns what the key's account received and paid out. A viewing key cannot spend.
 */
export class RealVaultScan implements Disposable {
  readonly #host: HTMLElement;
  readonly #life = new Lifetime();
  readonly #key = node('textarea');
  readonly #birthday = node('input');
  readonly #scan = node('button', 'Scan testnet', 'button primary');
  readonly #published: HTMLButtonElement[] = [];
  readonly #status = node('p', '', 'tool-status');
  readonly #rows = node('tbody');
  readonly #tableWrap = node('div', '', 'table-scroll max-w-full overflow-x-auto');
  readonly #live: ((viewingKey: string, birthday: number) => Promise<ChainActivity>) | undefined;
  #busy = false;
  constructor(host: HTMLElement, live: ((viewingKey: string, birthday: number) => Promise<ChainActivity>) | undefined, published: readonly PublishedKey[]) {
    this.#host = host; this.#live = live; host.className = 'panel audit-view real-scan'; host.setAttribute('data-independent-controls', '');
    const heading = node('div', '', 'panel-heading'); heading.append(node('h2', '03 / Real testnet vault scan'), node('span', 'VIEW-ONLY / PUBLISHED VIEWING KEY'));
    const content = node('div', '', 'tool-content');
    const help = node('p', live ? 'Paste a testnet unified full viewing key (uviewtest1…) and the height to start from. This machine\'s DarkZec server builds a view-only light wallet with zcash-devtool and reads every note the key\'s account received and every payment it made. The key stays on this machine and cannot spend.' :
      'Scanning reads the chain through a light wallet, so it runs on a local DarkZec server (npm run dev). Here you can load the viewing key published with a real testnet auction and browse the chain snapshot recorded when it was verified.');
    const keyLabel = node('label', 'Unified full viewing key'); keyLabel.htmlFor = 'real-scan-key';
    this.#key.id = 'real-scan-key'; this.#key.spellcheck = false; this.#key.placeholder = 'uviewtest1…';
    const birthdayLabel = node('label', 'Birthday height'); birthdayLabel.htmlFor = 'real-scan-birthday';
    this.#birthday.id = 'real-scan-birthday'; this.#birthday.inputMode = 'numeric'; this.#birthday.placeholder = '4548212'; this.#birthday.maxLength = 9;
    const actions = node('div', '', 'tool-actions');
    this.#scan.type = 'button'; this.#scan.id = 'real-scan-run'; if (live) actions.append(this.#scan);
    for (const item of published) {
      const button = node('button', `Load ${item.id} published key`, 'button quiet'); button.type = 'button'; button.id = `real-scan-${item.id}`; this.#published.push(button); actions.append(button);
      button.addEventListener('click', () => { void this.#run(async () => {
        const { viewingKey, birthday } = await item.key(); this.#key.value = viewingKey; this.#birthday.value = String(birthday);
        if (this.#live) { try { return { activity: await this.#live(viewingKey, birthday), recorded: false }; } catch { /* fall back to the recording */ } }
        return { activity: await item.snapshot(), recorded: true };
      }); }, { signal: this.#life.signal });
    }
    this.#status.id = 'real-scan-status'; this.#status.setAttribute('role', 'status');
    const table = node('table', '', 'audit-checks real-scan-notes'); table.setAttribute('aria-label', 'Notes seen by the viewing key');
    const head = node('thead'); const row = node('tr'); for (const title of ['Direction', 'Height', 'Amount', 'Memo', 'Transaction']) { const th = node('th', title); th.scope = 'col'; row.append(th); }
    head.append(row); this.#rows.id = 'real-scan-rows'; table.append(head, this.#rows); this.#tableWrap.append(table); this.#tableWrap.hidden = true; this.#tableWrap.tabIndex = 0;
    this.#tableWrap.setAttribute('role', 'region'); this.#tableWrap.setAttribute('aria-label', 'Scanned notes');
    content.append(help, keyLabel, this.#key, birthdayLabel, this.#birthday, actions, this.#status, this.#tableWrap); host.append(heading, content);
    this.#scan.addEventListener('click', () => { void this.#run(async () => {
      const viewingKey = this.#key.value.trim(); const birthday = Number(this.#birthday.value.trim());
      if (!VIEWING_KEY.test(viewingKey)) throw new Error('Paste a testnet unified full viewing key (uviewtest1…).');
      if (!Number.isSafeInteger(birthday) || birthday < 280_000) throw new Error('Enter the block height to start scanning from.');
      if (!this.#live) throw new Error('Scanning needs a local DarkZec server.');
      return { activity: await this.#live(viewingKey, birthday), recorded: false };
    }); }, { signal: this.#life.signal });
  }
  async #run(read: () => Promise<{ readonly activity: ChainActivity; readonly recorded: boolean }>): Promise<void> {
    if (this.#busy) return;
    this.#busy = true; this.#refresh(); this.#status.classList.remove('is-ok', 'is-bad');
    this.#status.textContent = 'Scanning Zcash testnet with the viewing key…';
    try {
      const { activity, recorded } = await read(); this.#render(activity);
      const total = (list: readonly ChainOutput[]): string => formatZec(BigInt(list.reduce((sum, output) => sum + output.amountZat, 0)));
      this.#status.textContent = `${activity.received.length} notes received (${total(activity.received)} ZEC) and ${activity.sent.length} payments made (${total(activity.sent)} ZEC), ` +
        (recorded ? `from the chain snapshot recorded at height ${activity.tip}, not a live read.` : `read live at height ${activity.tip}.`);
      this.#status.classList.add('is-ok');
    } catch (error: unknown) {
      this.#tableWrap.hidden = true;
      this.#status.textContent = error instanceof Error && error.message.length < 160 ? error.message : 'The scan failed. Check the key, the height and the local light wallet.';
      this.#status.classList.add('is-bad');
    } finally { this.#busy = false; this.#refresh(); }
  }
  #render(activity: ChainActivity): void {
    this.#rows.replaceChildren();
    const rows = [...activity.received.map(output => ['IN', output] as const), ...activity.sent.map(output => ['OUT', output] as const)].sort(([, a], [, b]) => a.height - b.height);
    for (const [direction, output] of rows) {
      const row = node('tr'); row.dataset.direction = direction;
      row.append(node('td', direction, 'state'), node('td', String(output.height)), node('td', `${formatZec(BigInt(output.amountZat))} ZEC`), node('td', memoKind(output.memo)), node('td', `${output.txid.slice(0, 16)}…`));
      this.#rows.append(row);
    }
    this.#tableWrap.hidden = rows.length === 0;
  }
  #refresh(): void { for (const button of [this.#scan, ...this.#published]) button.disabled = this.#busy; this.#host.setAttribute('aria-busy', String(this.#busy)); }
  destroy(): void { this.#life.destroy(); this.#host.replaceChildren(); }
}
