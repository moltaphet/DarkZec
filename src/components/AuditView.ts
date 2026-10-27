import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';
import { AUDIT_BUNDLE_MAX_BYTES, verifyAuditBundle } from '../lib/audit-bundle';
import type { AuditReport } from '../lib/audit-bundle';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element;
};

/** Independent verifier: it trusts nothing in the bundle and re-derives every published claim in this browser. */
export class AuditView implements Disposable {
  readonly #host: HTMLElement;
  readonly #life = new Lifetime();
  readonly #input = node('textarea');
  readonly #file = node('input');
  readonly #verify = node('button', 'Verify bundle', 'button primary');
  readonly #import = node('button', 'Import bundle file', 'button quiet');
  readonly #session = node('button', "Load this session's bundle", 'button quiet');
  readonly #clear = node('button', 'Clear', 'reset');
  readonly #verdict = node('p', '', 'audit-verdict');
  readonly #rows = node('tbody');
  readonly #tableWrap = node('div', '', 'table-scroll max-w-full overflow-x-auto');
  readonly #current: () => string | undefined;
  #busy = false;
  constructor(host: HTMLElement, current: () => string | undefined) {
    this.#host = host; this.#current = current; host.className = 'panel audit-view'; host.setAttribute('data-independent-controls', '');
    const heading = node('div', '', 'panel-heading'); heading.append(node('h2', 'Audit mode'), node('span', 'RE-RUN AN AUCTION WITHOUT TRUSTING THE OPERATOR'));
    const content = node('div', '', 'tool-content');
    const help = node('p', 'Paste or import an audit bundle published after clearing. This page recomputes the Merkle root, opens every reveal against its commitment, re-runs the clearing rule, checks collateral conservation and verifies the operator\'s signed close statement, reveal acknowledgements and result. Nothing is sent anywhere.');
    const label = node('label', 'Audit bundle JSON'); label.htmlFor = 'audit-bundle-input';
    this.#input.id = 'audit-bundle-input'; this.#input.spellcheck = false; this.#input.placeholder = '{"v":1,"kind":"darkzec-audit-bundle",…}';
    this.#file.type = 'file'; this.#file.accept = 'application/json,.json'; this.#file.id = 'audit-bundle-file'; this.#file.hidden = true; this.#file.setAttribute('aria-label', 'Audit bundle file');
    const actions = node('div', '', 'tool-actions');
    for (const [button, id] of [[this.#verify, 'audit-verify'], [this.#import, 'audit-import'], [this.#session, 'audit-session'], [this.#clear, 'audit-clear']] as const) { button.type = 'button'; button.id = id; actions.append(button); }
    this.#verdict.id = 'audit-verdict'; this.#verdict.setAttribute('role', 'status');
    const table = node('table', '', 'audit-checks'); table.setAttribute('aria-label', 'Audit checks');
    const head = node('thead'); const row = node('tr'); for (const title of ['Check', 'Result', 'Detail']) { const th = node('th', title); th.scope = 'col'; row.append(th); }
    head.append(row); this.#rows.id = 'audit-check-rows'; table.append(head, this.#rows); this.#tableWrap.append(table); this.#tableWrap.hidden = true; this.#tableWrap.tabIndex = 0;
    this.#tableWrap.setAttribute('role', 'region'); this.#tableWrap.setAttribute('aria-label', 'Audit check results');
    content.append(help, label, this.#input, actions, this.#file, this.#verdict, this.#tableWrap); host.append(heading, content);
    const signal = this.#life.signal;
    this.#verify.addEventListener('click', () => { void this.#run(() => this.#input.value); }, { signal });
    this.#session.addEventListener('click', () => {
      const bundle = this.#current();
      if (!bundle) { this.#show(undefined, 'No cleared auction in this session yet. Finalize an auction first.'); return; }
      this.#input.value = bundle; void this.#run(() => bundle);
    }, { signal });
    this.#import.addEventListener('click', () => { this.#file.value = ''; this.#file.click(); }, { signal });
    this.#file.addEventListener('change', () => {
      const file = this.#file.files?.[0]; this.#file.value = ''; if (!file) return;
      if (file.size === 0 || file.size > AUDIT_BUNDLE_MAX_BYTES) { this.#show(undefined, 'An audit bundle is a JSON file of at most 256 KB.'); return; }
      void this.#run(async () => { const text = await file.text(); this.#input.value = text; return text; });
    }, { signal });
    this.#clear.addEventListener('click', () => { this.#input.value = ''; this.#show(undefined, ''); }, { signal });
    this.refresh();
  }
  async #run(read: () => string | Promise<string>): Promise<void> {
    if (this.#busy) return;
    this.#busy = true; this.refresh();
    try { this.#show(await verifyAuditBundle(await read())); }
    catch { this.#show(undefined, 'The bundle could not be read.'); }
    finally { this.#busy = false; this.refresh(); }
  }
  #show(report: AuditReport | undefined, message = ''): void {
    this.#rows.replaceChildren(); this.#verdict.classList.remove('is-ok', 'is-bad');
    if (!report) { this.#verdict.textContent = message; this.#tableWrap.hidden = true; if (message) this.#verdict.classList.add('is-bad'); return; }
    const passed = report.checks.filter(check => check.ok).length;
    this.#verdict.textContent = report.ok ? `VERIFIED / ${report.auctionId ?? 'auction'}: all ${passed} checks passed.` : `NOT VERIFIED / ${report.checks.length - passed} of ${report.checks.length} checks failed.`;
    this.#verdict.classList.add(report.ok ? 'is-ok' : 'is-bad');
    for (const check of report.checks) {
      const row = node('tr', '', check.ok ? 'is-ok' : 'is-bad'); row.dataset.check = check.id;
      row.append(node('td', check.label), node('td', check.ok ? 'PASS' : 'FAIL', 'state'), node('td', check.detail)); this.#rows.append(row);
    }
    this.#tableWrap.hidden = false;
  }
  refresh(): void { for (const button of [this.#verify, this.#import, this.#session]) button.disabled = this.#busy; this.#host.setAttribute('aria-busy', String(this.#busy)); }
  destroy(): void { this.#life.destroy(); this.#host.replaceChildren(); }
}
