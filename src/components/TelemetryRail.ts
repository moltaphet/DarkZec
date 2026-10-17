import { Lifetime } from '../lib/dom';
import { motionLoop } from '../lib/motion';
import type { MotionLoop } from '../lib/motion';
import type { MemoAudit } from './MemoScramble';

export type SecurityEvent = 'boot' | 'draft' | 'prepared' | 'committed' | 'seeded' | 'closed' | 'cleared' | 'proof' | 'reset' | 'wallet' | 'erased' | 'blocked' | 'invalid';
const EVENTS: Readonly<Record<SecurityEvent, string>> = {
  boot: '[SYSTEM]: Local policy guard initialized',
  draft: '[AUDIT]: Private memo draft refreshed',
  prepared: '[AUDIT]: UTF-8 memo boundary verified',
  committed: '[AUDIT]: Merkle leaf generated',
  seeded: '[MOCK]: Three sealed notes received',
  closed: '[AUDIT]: Commitment set frozen',
  cleared: '[MOCK]: IVK decryption verified',
  proof: '[AUDIT]: Inclusion proof verified',
  reset: '[SYSTEM]: Session buffers discarded',
  wallet: '[POLICY]: Orchard-only request prepared',
  erased: '[SYSTEM]: Sensitive request erased',
  blocked: '[POLICY]: Outbound attempt blocked',
  invalid: '[POLICY]: Invalid input refused',
};
interface LogLine { readonly element: HTMLElement; readonly message: string; readonly start: number; complete: boolean }

export class TelemetryRail {
  readonly #root: HTMLElement;
  readonly #log: HTMLElement;
  readonly #leaks: HTMLElement;
  readonly #bytes: HTMLElement;
  readonly #shield: HTMLElement;
  readonly #loop: MotionLoop;
  readonly #lifetime = new Lifetime();
  readonly #lines: LogLine[] = [];
  #blocked = 0;
  #sequence = 0;
  #lastDraft = 0;

  constructor(root: HTMLElement, toggle: HTMLButtonElement, log: HTMLElement, leaks: HTMLElement, bytes: HTMLElement, shield: HTMLElement) {
    this.#root = root; this.#log = log; this.#leaks = leaks; this.#bytes = bytes; this.#shield = shield;
    this.#loop = motionLoop(log, (time, reduced) => {
      let changed = false;
      for (const line of this.#lines) {
        if (line.complete) continue;
        const length = reduced ? line.message.length : Math.min(line.message.length, Math.floor((time - line.start) / 9));
        line.element.textContent = line.message.slice(0, Math.max(0, length));
        if (length >= line.message.length) line.complete = true;
        changed = true;
      }
      if (changed) this.#log.scrollTop = this.#log.scrollHeight;
    }, () => this.#lines.some(line => !line.complete));
    toggle.addEventListener('click', () => {
      const collapsed = root.classList.toggle('is-collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? 'Expand telemetry' : 'Collapse telemetry');
      this.#loop.invalidate();
    }, { signal: this.#lifetime.signal });
    const compact = matchMedia('(max-width: 1279px)');
    const adapt = (): void => {
      root.classList.toggle('is-collapsed', compact.matches);
      toggle.setAttribute('aria-expanded', String(!compact.matches));
      toggle.setAttribute('aria-label', compact.matches ? 'Expand telemetry' : 'Collapse telemetry');
      this.#loop.invalidate();
    };
    compact.addEventListener('change', adapt, { signal: this.#lifetime.signal });
    adapt();
    document.addEventListener('securitypolicyviolation', event => {
      // Our HTTP policy and fallback meta both enforce outbound restrictions.
      // Count the meta event once; the HTTP-only frame-ancestors policy duplicates it.
      if (event.originalPolicy.includes('frame-ancestors') && document.querySelector('meta[http-equiv="Content-Security-Policy"]')) return;
      this.#leaks.textContent = String(++this.#blocked); this.log('blocked');
    }, { signal: this.#lifetime.signal });
    this.#lifetime.own(() => this.#loop.destroy());
    this.log('boot');
  }

  shield(active: boolean): void { this.#shield.textContent = active ? 'ACTIVE' : 'OFFLINE'; }
  memo(audit: MemoAudit): void {
    this.#bytes.textContent = `${audit.bytes}/512`;
    this.#root.dataset.memoState = audit.state;
    if (audit.state === 'ready' && performance.now() - this.#lastDraft > 1200) {
      this.#lastDraft = performance.now(); this.log('draft');
    }
  }
  log(event: SecurityEvent): void {
    // Only fixed event identifiers cross this boundary. Never pass user input or errors.
    const item = document.createElement('div'); item.className = 'telemetry-line';
    const number = String(++this.#sequence).padStart(3, '0');
    const message = `${number} ${EVENTS[event]}`;
    this.#lines.push({ element: item, message, start: performance.now(), complete: false });
    this.#log.append(item);
    if (this.#lines.length > 18) this.#lines.shift()?.element.remove();
    this.#loop.invalidate();
  }
  reset(): void {
    this.#lines.splice(0); this.#log.replaceChildren(); this.#sequence = 0; this.#lastDraft = 0;
    this.memo({ bytes: 0, state: 'empty' }); this.log('reset');
  }
  destroy(): void { this.#lifetime.destroy(); this.#lines.splice(0); this.#log.replaceChildren(); }
}
