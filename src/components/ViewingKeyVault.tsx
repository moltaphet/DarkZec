import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';
import { browserViewingKeySession, DEMO_UNLOCK_PASSPHRASE, DEMO_VIEWING_KEY, viewingKeyKind } from '../lib/viewing-key-session';
import type { ViewingKeyKind, ViewingKeySession } from '../lib/viewing-key-session';
import { createDemoNotes, incomingDemoNote, mockNoteKey, MOCK_SCAN_SCOPE, scanMockNotes } from '../lib/mock-note-scanner';
import type { MockNote, ScannedNote } from '../lib/mock-note-scanner';
import { VaultError } from '../lib/vault-memo';
import { notifyAudit } from '../lib/security-events';
import type { AuditObserver, VaultAuditEvent, VaultOperation } from '../lib/security-events';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag); result.className = className; result.textContent = text; return result;
}
function actionButton(id: string, label: string, primary = false): HTMLButtonElement {
  const result = node('button', `button ${primary ? 'primary' : 'quiet'}`, label); result.id = id; result.type = 'button'; return result;
}
function metric(id: string, label: string): HTMLElement {
  const item = node('div'); item.id = id; const value = node('dd', '', '0');
  item.append(node('dt', 'micro', label), value); return item;
}

/** Typed DOM component for the existing terminal; TSX path does not require a React runtime. */
export class ViewingKeyVault implements Disposable {
  readonly #host: HTMLElement;
  readonly #session: ViewingKeySession;
  readonly #audit: AuditObserver<VaultAuditEvent> | undefined;
  readonly #lifetime = new Lifetime();
  #rowLifetime = new Lifetime();
  readonly #keyInput = node('input');
  readonly #passphrase = node('input');
  readonly #form = node('form');
  readonly #save = actionButton('vault-save', 'Save & unlock', true);
  readonly #unlock = actionButton('vault-unlock', 'Unlock saved key');
  readonly #demo = actionButton('vault-demo', 'Use demo credentials');
  readonly #lock = actionButton('vault-lock', 'Lock vault');
  readonly #forget = actionButton('vault-forget', 'Forget saved key');
  readonly #load = actionButton('vault-load-notes', 'Load demo notes', true);
  readonly #scan = actionButton('vault-scan', 'Rescan notes');
  readonly #incoming = actionButton('vault-incoming', '+ Simulate incoming note');
  readonly #status = node('div', 'vault-status');
  readonly #error = node('div', 'error vault-error');
  readonly #mode = node('span', 'vault-mode', 'LOCKED');
  readonly #saved = node('span', 'micro');
  readonly #rows = node('tbody');
  readonly #received = metric('vault-received', 'RECEIVED NOTES');
  readonly #accepted = metric('vault-accepted', 'ACCEPTED COMMITS');
  readonly #rejected = metric('vault-rejected', 'QUARANTINED');
  #notes: readonly MockNote[] = [];
  #results: readonly ScannedNote[] = [];
  #key: CryptoKey | undefined;
  #kind: ViewingKeyKind | undefined;
  #busy = false;
  #epoch = 0;
  #operation: AbortController | undefined;
  #disposed = false;

  constructor(host: HTMLElement, session = browserViewingKeySession(), audit?: AuditObserver<VaultAuditEvent>) {
    this.#host = host; this.#session = session; this.#audit = audit;
    host.setAttribute('data-independent-controls', '');
    this.#build(); this.#events(); this.#render(); this.#controls();
    const saved = session.status();
    this.#message(saved === 'saved' ? 'Encrypted session found. Enter your local passphrase and unlock; no key is restored automatically.' :
      saved === 'corrupt' ? 'The saved record is invalid. Forget it or save a new key.' :
      saved === 'unavailable' ? 'Tab storage is unavailable. No mock key has been saved.' : 'Vault locked. Use demo credentials or enter a mock key and a local unlock passphrase. Real viewing keys are disabled.');
  }

  #build(): void {
    const panel = node('section', 'panel viewing-vault'); panel.setAttribute('aria-label', 'Viewing Key Vault & Decryption Engine');
    const heading = node('div', 'panel-heading');
    heading.append(node('h2', '', '03 / Viewing Key Vault & Decryption Engine'), this.#mode); this.#mode.id = 'vault-mode';
    const intro = node('div', 'vault-intro');
    intro.append(node('span', 'eyebrow', 'INCOMING VIEW AUTHORITY / LOCAL SIMULATION'), node('h2', '', 'Unseal the note. Keep the key local.'),
      node('p', '', 'An isolated scanner for simulated shielded notes. Unlock the vault, authenticate incoming envelopes and inspect validated commitment hashes. No chain connection or spending authority.'));
    const grid = node('div', 'vault-grid'); const credentials = node('section', 'vault-credentials');
    credentials.append(node('h3', '', 'Vault access'), this.#saved); this.#saved.id = 'vault-saved-state';
    this.#form.id = 'vault-key-form'; this.#form.autocomplete = 'off';
    const keyLabel = node('label', '', 'Mock vault key'); keyLabel.htmlFor = 'vault-viewing-key';
    this.#keyInput.id = 'vault-viewing-key'; this.#keyInput.type = 'password'; this.#keyInput.maxLength = DEMO_VIEWING_KEY.length; this.#keyInput.required = true;
    this.#keyInput.autocomplete = 'off'; this.#keyInput.spellcheck = false; this.#keyInput.placeholder = 'mock:node07: + 64 lowercase hex characters';
    const passLabel = node('label', '', 'Local unlock passphrase'); passLabel.htmlFor = 'vault-passphrase';
    this.#passphrase.id = 'vault-passphrase'; this.#passphrase.type = 'password'; this.#passphrase.minLength = 12; this.#passphrase.maxLength = 128;
    this.#passphrase.required = true; this.#passphrase.autocomplete = 'off'; this.#passphrase.placeholder = '12–128 characters · never stored';
    const help = node('p', 'vault-help', 'Mock keys only (mock:node07: + 64 lowercase hex characters). Real viewing keys are rejected. The mock key is encrypted in this tab with your passphrase; reload requires unlocking again. Never enter a seed phrase or spending key.');
    help.id = 'vault-key-help'; this.#keyInput.setAttribute('aria-describedby', help.id); this.#passphrase.setAttribute('aria-describedby', help.id);
    this.#save.type = 'submit';
    const saveActions = node('div', 'vault-actions'); saveActions.append(this.#save, this.#unlock);
    const maintenance = node('div', 'vault-actions vault-maintenance'); maintenance.append(this.#lock, this.#forget);
    this.#form.append(keyLabel, this.#keyInput, passLabel, this.#passphrase, help, saveActions, this.#demo, maintenance);
    credentials.append(this.#form);
    const pipeline = node('section', 'vault-pipeline'); pipeline.append(node('h3', '', 'Authenticated memo pipeline'));
    const stages = node('ol');
    for (const [title, copy] of [
      ['01 / AUTHENTICATE', 'Mock AES-GCM verifies each envelope and its note metadata. Wrong keys and modified notes are refused.'],
      ['02 / EXTRACT', 'The encrypted envelope is 528 bytes including its tag. Only the decrypted ZIP-302 memo field is exactly 512 bytes.'],
      ['03 / DECODE', 'Remove trailing 0x00 padding, decode UTF-8, then decode strict unpadded Base64url when the mock transport requires it.'],
      ['04 / VALIDATE', 'Check v:2 commit-only schema, auction, recorded hash and the public fixed collateral. Bid price, quantity, salt and refund are never in these notes.'],
    ]) {
      const step = node('li'); step.append(node('strong', '', title ?? ''), node('p', '', copy ?? '')); stages.append(step);
    }
    pipeline.append(stages, node('p', 'vault-boundary', 'SIMULATION BOUNDARY / Real Unified Viewing Keys cannot be saved or unlocked. An audited WASM adapter is required before real key handling is enabled. This engine decrypts mock AES-GCM notes only.'));
    grid.append(credentials, pipeline);
    this.#status.id = 'vault-status'; this.#status.setAttribute('role', 'status'); this.#status.setAttribute('aria-live', 'polite');
    this.#error.id = 'vault-error'; this.#error.setAttribute('role', 'alert'); this.#error.hidden = true;
    const stats = node('dl', 'vault-metrics'); stats.append(this.#received, this.#accepted, this.#rejected);
    const toolbar = node('div', 'vault-scanner-actions'); toolbar.append(this.#load, this.#scan, this.#incoming);
    const tableWrap = node('div', 'table-scroll vault-table max-w-full overflow-x-auto');
    const scrollHint = node('p', 'table-scroll-hint', '↔ Scroll horizontally to inspect all note fields'); scrollHint.id = 'vault-scroll-hint';
    tableWrap.id = 'vault-table-scroll'; tableWrap.tabIndex = 0; tableWrap.setAttribute('role', 'region');
    tableWrap.setAttribute('aria-label', 'Private mock note scan results'); tableWrap.setAttribute('aria-describedby', scrollHint.id);
    const table = node('table'); table.setAttribute('aria-label', 'Privately decrypted simulated bids');
    const caption = node('caption', '', 'Commit-only scan results · no bid preimages in vault notes');
    const thead = node('thead'); const tr = node('tr');
    for (const label of ['Note / state', 'Auction', 'Commitment', 'Collateral', 'Memo audit', 'Note details']) { const th = node('th', '', label); th.scope = 'col'; tr.append(th); }
    thead.append(tr); this.#rows.id = 'vault-result-rows'; table.append(caption, thead, this.#rows); tableWrap.append(table);
    const footer = node('div', 'vault-footer', 'Session ciphertext stays in this tab. Unlocked data is visible to scripts running in this origin. Lock clears private rows and live key references; Forget removes the saved record.');
    panel.append(heading, intro, grid, this.#status, this.#error, stats, toolbar, scrollHint, tableWrap, footer); this.#host.replaceChildren(panel);
  }

  #events(): void {
    const signal = this.#lifetime.signal;
    this.#form.addEventListener('submit', event => { event.preventDefault(); void this.#run('save', async signal => {
      const value = this.#keyInput.value; const passphrase = this.#passphrase.value;
      this.#clearInputs();
      const kind = await this.#session.save(value, passphrase); this.#check(signal);
      const key = await mockNoteKey(value); this.#check(signal);
      this.#key = key; this.#kind = kind; this.#results = [];
      notifyAudit(this.#audit, { type: 'vault-saved' }); notifyAudit(this.#audit, { type: 'vault-unlocked', mock: true });
      this.#message('Mock vault unlocked. Load demo notes to scan locally; no real shielded-note decryption occurs.');
    }); }, { signal });
    this.#unlock.addEventListener('click', () => { void this.#run('unlock', async signal => {
      const passphrase = this.#passphrase.value; this.#clearInputs();
      const value = await this.#session.unlock(passphrase); this.#check(signal);
      const kind = viewingKeyKind(value); const key = await mockNoteKey(value); this.#check(signal);
      this.#kind = kind; this.#key = key;
      notifyAudit(this.#audit, { type: 'vault-unlocked', mock: true });
      this.#message('Saved mock vault unlocked. Load or rescan the local notes.');
    }); }, { signal });
    this.#demo.addEventListener('click', () => {
      this.#keyInput.value = DEMO_VIEWING_KEY; this.#passphrase.value = DEMO_UNLOCK_PASSPHRASE;
      this.#message('Public demo credentials filled. Save & unlock to begin. Demo passphrase: node07-demo-passphrase. Never use these fixtures for real funds.');
    }, { signal });
    this.#lock.addEventListener('click', () => this.lock(), { signal });
    this.#forget.addEventListener('click', () => {
      this.lock();
      try { this.#session.forget(); this.#notes = []; notifyAudit(this.#audit, { type: 'vault-forgotten' }); this.#message('Saved encrypted key forgotten. Local notes and private results cleared.'); }
      catch (error: unknown) { this.#showError(error); }
      this.#render(); this.#controls();
    }, { signal });
    this.#load.addEventListener('click', () => { void this.#run('load', async signal => {
      const notes = await createDemoNotes(); this.#check(signal); this.#notes = notes; await this.#scanNotes(signal);
    }); }, { signal });
    this.#scan.addEventListener('click', () => { void this.#run('scan', signal => this.#scanNotes(signal)); }, { signal });
    this.#incoming.addEventListener('click', () => { void this.#run('incoming', async signal => {
      if (this.#notes.length >= 128) throw new Error('Local scanner limit: 128 notes.');
      const producerKey = await mockNoteKey(DEMO_VIEWING_KEY);
      const note = await incomingDemoNote(this.#notes.length + 1, producerKey); this.#check(signal);
      this.#notes = Object.freeze([...this.#notes, note]); await this.#scanNotes(signal);
    }); }, { signal });
  }

  #clearInputs(): void { this.#keyInput.value = ''; this.#passphrase.value = ''; }
  #check(signal: AbortSignal): void { if (this.#disposed || signal.aborted) throw new VaultError('cancelled'); }
  #message(value: string): void { this.#status.textContent = value; }
  #showError(error: unknown): void {
    this.#error.textContent = error instanceof Error ? error.message : 'Vault operation failed. Lock and try again.';
    this.#error.hidden = false;
  }
  async #run(name: VaultOperation, operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.#busy || this.#disposed) return;
    const epoch = ++this.#epoch; const controller = new AbortController(); this.#operation = controller;
    this.#busy = true; this.#error.hidden = true; this.#controls();
    notifyAudit(this.#audit, { type: 'vault-attempt', operation: name });
    try { await operation(controller.signal); }
    catch (error: unknown) { if (epoch === this.#epoch && !this.#disposed) { notifyAudit(this.#audit, { type: 'vault-failed', operation: name }); this.#showError(error); } }
    finally { if (epoch === this.#epoch && !this.#disposed) { this.#busy = false; this.#operation = undefined; this.#render(); this.#controls(); } }
  }
  async #scanNotes(signal: AbortSignal): Promise<void> {
    const key = this.#key; if (!key || this.#kind !== 'mock') throw new VaultError('unsupported');
    this.#results = []; this.#render();
    const rows = await scanMockNotes(this.#notes, key, MOCK_SCAN_SCOPE, signal, (done, total) => {
      if (!signal.aborted) this.#message(`SCANNING LOCAL NOTES / ${done} of ${total} authenticated envelopes processed.`);
    }, event => { if (!signal.aborted && !this.#disposed) notifyAudit(this.#audit, event); });
    this.#check(signal); this.#results = rows;
    const accepted = rows.filter(row => row.status === 'accepted').length;
    const rejected = rows.filter(row => row.status === 'rejected').length;
    const empty = rows.filter(row => row.status === 'empty').length;
    this.#message(`Scan complete: ${accepted} accepted commitments, ${rejected} quarantined notes, ${empty} empty memos. Results remain private to this view.`);
  }

  #controls(): void {
    const status = this.#session.status();
    this.#saved.textContent = status === 'saved' ? 'ENCRYPTED SESSION / SAVED' : status === 'empty' ? 'NO SAVED KEY' : status === 'corrupt' ? 'SAVED RECORD / INVALID' : 'TAB STORAGE / UNAVAILABLE';
    this.#mode.textContent = this.#kind === 'mock' ? 'MOCK / UNLOCKED' : 'LOCKED';
    this.#keyInput.disabled = this.#busy || this.#kind !== undefined;
    this.#passphrase.disabled = this.#busy || this.#kind !== undefined;
    this.#save.disabled = this.#busy || this.#kind !== undefined || status === 'unavailable';
    this.#unlock.disabled = this.#busy || this.#kind !== undefined || status !== 'saved';
    this.#demo.disabled = this.#busy || this.#kind !== undefined;
    this.#lock.disabled = !this.#busy && this.#kind === undefined;
    this.#forget.disabled = status === 'empty' || status === 'unavailable';
    for (const control of [this.#load, this.#scan, this.#incoming]) control.disabled = this.#busy || this.#kind !== 'mock';
    this.#scan.disabled ||= this.#notes.length === 0;
    this.#incoming.disabled ||= this.#notes.length >= 128;
    this.#host.setAttribute('aria-busy', String(this.#busy));
  }

  #render(): void {
    this.#rowLifetime.destroy(); this.#rowLifetime = new Lifetime();
    this.#received.querySelector('dd')?.replaceChildren(String(this.#notes.length));
    this.#accepted.querySelector('dd')?.replaceChildren(String(this.#results.filter(row => row.status === 'accepted').length));
    this.#rejected.querySelector('dd')?.replaceChildren(String(this.#results.filter(row => row.status === 'rejected').length));
    this.#rows.replaceChildren();
    if (!this.#results.length) {
      const tr = node('tr'); const cell = node('td', 'vault-empty', this.#kind ? 'Load incoming mock notes to begin the private scan.' : 'Vault locked. No decrypted bid data is displayed.');
      cell.colSpan = 6; tr.append(cell); this.#rows.append(tr); return;
    }
    for (const row of this.#results) {
      const tr = node('tr'); tr.dataset.status = row.status;
      const status = node('td'); status.append(node('span', 'vault-note-id', row.id), node('span', `vault-row-state ${row.status}`, row.status.toUpperCase())); tr.append(status);
      if (row.status !== 'accepted') {
        const cell = node('td', 'vault-note-issue', row.status === 'empty' ? 'ZIP-302 no-memo marker / skipped.' : row.message); cell.colSpan = 5; tr.append(cell);
      } else {
        tr.append(node('td', '', row.parsed.commit.auctionId), node('td', 'vault-price', row.commitment.slice(0, 16) + '…'), node('td', '', '10 ZEC / posted'),
          node('td', 'vault-memo-audit', `512B field / ${row.parsed.transportBytes}B ${row.parsed.transport} / ${row.parsed.jsonBytes}B JSON`));
        const cell = node('td'); const details = node('details', 'vault-note-details'); details.append(node('summary', '', 'Inspect memo'));
        const content = node('div'); content.tabIndex = 0; content.setAttribute('aria-label', 'Private memo details');
        details.addEventListener('toggle', () => {
          content.replaceChildren(); if (!details.open) return;
          for (const [label, value] of [['COMMITMENT', row.commitment], ['DECRYPTED MEMO HEX / 512 BYTES', row.memoHex]]) {
            content.append(node('span', 'micro', label ?? ''), node('code', 'hash', value ?? ''));
          }
        }, { signal: this.#rowLifetime.signal });
        details.append(content); cell.append(details); tr.append(cell);
      }
      this.#rows.append(tr);
    }
  }

  lock(): void {
    const active = this.#kind !== undefined || this.#busy;
    this.#epoch++; this.#operation?.abort(); this.#operation = undefined; this.#session.cancel(); this.#busy = false;
    this.#key = undefined; this.#kind = undefined; this.#results = []; this.#clearInputs(); this.#error.hidden = true;
    this.#message('Vault locked. Live keys and decrypted rows cleared; the saved session remains encrypted.');
    this.#render(); this.#controls();
    if (active) notifyAudit(this.#audit, { type: 'vault-locked' });
  }
  destroy(): void { this.lock(); this.#disposed = true; this.#notes = []; this.#rowLifetime.destroy(); this.#lifetime.destroy(); this.#host.replaceChildren(); }
}
