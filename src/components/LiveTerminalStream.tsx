import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';
import { motionLoop } from '../lib/motion';
import type { MotionLoop } from '../lib/motion';
import type { AuditEntry, SecurityAudit, SecuritySnapshot } from '../lib/security-events';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}
interface AnimatedLine { readonly entry: AuditEntry; readonly element: HTMLElement; readonly text: string; readonly start: number; length: number }

/** Shared bounded renderer for the full stream and compact floating rail. */
export class TerminalLog implements Disposable {
  readonly #host: HTMLElement;
  readonly #limit: number;
  readonly #loop: MotionLoop;
  readonly #lifetime = new Lifetime();
  #lines: AnimatedLine[] = [];
  #paused = false;
  #following = true;
  #pending: readonly AuditEntry[] = [];
  constructor(host: HTMLElement, limit: number) {
    this.#host = host; this.#limit = limit;
    this.#loop = motionLoop(host, (time, reduced) => {
      if (this.#paused) return;
      let changed = false;
      for (const line of this.#lines) {
        const length = reduced ? line.text.length : Math.min(line.text.length, Math.max(0, Math.floor((time - line.start) / 5)));
        if (length <= line.length) continue;
        line.element.textContent = line.text.slice(0, length); line.length = length; changed = true;
      }
      if (changed && this.#following) host.scrollTop = Number.MAX_SAFE_INTEGER;
    }, () => !this.#paused && this.#lines.some(line => line.length < line.text.length));
    host.addEventListener('scroll', () => { this.#following = host.scrollHeight - host.scrollTop - host.clientHeight < 36; }, { signal: this.#lifetime.signal });
    this.#lifetime.own(() => this.#loop.destroy());
  }
  update(entries: readonly AuditEntry[]): void {
    this.#pending = entries;
    if (!entries.length) { this.#lines = []; this.#host.replaceChildren(); this.#following = true; }
    if (this.#paused) return;
    const next = entries.slice(-this.#limit); const ids = new Set(next.map(entry => entry.sequence));
    for (const line of this.#lines) if (!ids.has(line.entry.sequence)) line.element.remove();
    this.#lines = this.#lines.filter(line => ids.has(line.entry.sequence));
    const existing = new Set(this.#lines.map(line => line.entry.sequence));
    for (const entry of next) {
      if (existing.has(entry.sequence)) continue;
      const item = node('div', `telemetry-line terminal-event is-${entry.level}`); item.dataset.sequence = String(entry.sequence);
      const text = `${entry.timestamp.slice(11, 23)}Z [${entry.category}]: ${entry.simulated ? 'SIM / ' : ''}${entry.message}`;
      this.#lines.push({ entry, element: item, text, start: performance.now(), length: 0 }); this.#host.append(item);
    }
    if (!next.length) this.#following = true;
    this.#loop.invalidate();
  }
  pause(paused: boolean): void { this.#paused = paused; if (!paused) { this.update(this.#pending); this.#loop.invalidate(); } }
  destroy(): void { this.#lifetime.destroy(); this.#lines = []; this.#pending = []; this.#host.replaceChildren(); }
}

/** No timers, sockets or private payloads: one local audit subscription. */
export class LiveTerminalStream implements Disposable {
  readonly #host: HTMLElement;
  readonly #lifetime = new Lifetime();
  readonly #log: TerminalLog;
  constructor(host: HTMLElement, audit: SecurityAudit) {
    this.#host = host; host.setAttribute('data-independent-controls', '');
    const panel = node('section', 'panel live-terminal'); panel.setAttribute('aria-label', 'Live terminal security stream');
    const heading = node('div', 'panel-heading'); const title = node('h2', '', '04 / Security event stream');
    const badge = node('span', 'stream-badge', 'LOCAL OBSERVER'); badge.append(node('span', 'status-dot')); heading.append(title, badge);
    const layout = node('div', 'stream-layout'); const summary = node('div', 'stream-summary');
    summary.append(node('span', 'eyebrow', 'NODE 07 / AUDIT CHANNEL'), node('h3', '', 'Observe the operation. Protect the payload.'));
    const metrics = node('dl', 'stream-metrics');
    const metric = (label: string, id: string): HTMLElement => {
      const group = node('div'); const value = node('dd'); value.id = id; group.append(node('dt', '', label), value); metrics.append(group); return value;
    };
    const leaks = metric('LEAKS BLOCKED', 'stream-leaks'); const shield = metric('ORCHARD SHIELD', 'stream-shield');
    const bytes = metric('MEMO BYTE CAPACITY', 'stream-bytes');
    const capacity = node('meter', 'stream-capacity'); capacity.min = 0; capacity.max = 512; capacity.setAttribute('aria-label', 'Memo byte capacity');
    const memoState = node('p', 'stream-memo-state'); memoState.id = 'stream-memo-state';
    const boundary = node('p', 'stream-boundary');
    summary.append(metrics, capacity, memoState, boundary);
    const pane = node('div', 'stream-console'); const toolbar = node('div', 'stream-toolbar');
    const indicator = node('span', 'stream-indicator', '● LIVE'); const actions = node('div', 'stream-actions');
    const pause = node('button', 'button quiet', 'Pause stream'); pause.type = 'button'; pause.id = 'stream-pause'; pause.setAttribute('aria-pressed', 'false');
    const clear = node('button', 'button quiet', 'Clear log'); clear.type = 'button'; clear.id = 'stream-clear'; actions.append(pause, clear); toolbar.append(indicator, actions);
    const viewport = node('div', 'stream-log'); viewport.id = 'live-terminal-log'; viewport.tabIndex = 0;
    viewport.setAttribute('role', 'log'); viewport.setAttribute('aria-label', 'Timestamped local security events'); viewport.setAttribute('aria-live', 'off');
    const footer = node('div', 'stream-footer'); const retained = node('span'); retained.id = 'stream-retention'; footer.append(retained, node('span', '', 'UTC / MEMORY ONLY'));
    const help = node('p', 'stream-help', 'Pause freezes this view; collection and counters continue. Clear removes retained events in both views; security counters remain. Scroll up to read history.');
    help.id = 'stream-help'; viewport.setAttribute('aria-describedby', help.id);
    pane.append(toolbar, viewport, footer, help); layout.append(summary, pane); panel.append(heading, layout); host.replaceChildren(panel);
    this.#log = new TerminalLog(viewport, 128); this.#lifetime.own(() => this.#log.destroy());
    this.#lifetime.own(audit.subscribe((state: SecuritySnapshot) => {
      leaks.textContent = String(state.leaksBlocked); shield.textContent = state.shield;
      boundary.textContent = `${state.shieldDetail} Counts observed external CSP blocks; no live chain connection.`;
      bytes.textContent = `${state.memo.bytes}/512`; capacity.value = state.memo.bytes;
      memoState.textContent = `${state.memo.source.toUpperCase()} / ${state.memo.state.toUpperCase()}`; panel.dataset.memoState = state.memo.state;
      retained.textContent = `${state.entries.length}/128 RETAINED · ${state.dropped} EVICTED`; this.#log.update(state.entries);
    }));
    pause.addEventListener('click', () => {
      const paused = pause.getAttribute('aria-pressed') !== 'true'; pause.setAttribute('aria-pressed', String(paused));
      pause.textContent = paused ? 'Resume stream' : 'Pause stream'; indicator.textContent = paused ? 'Ⅱ VIEW PAUSED' : '● LIVE';
      panel.classList.toggle('is-paused', paused); this.#log.pause(paused);
    }, { signal: this.#lifetime.signal });
    clear.addEventListener('click', () => { audit.clear(); }, { signal: this.#lifetime.signal });
  }
  destroy(): void { this.#lifetime.destroy(); this.#host.replaceChildren(); }
}
