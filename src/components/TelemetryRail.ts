import { Lifetime } from '../lib/dom';
import type { MemoAudit } from './MemoScramble';
import type { AuditSource, SecurityAudit, SecurityEvent } from '../lib/security-events';
import { TerminalLog } from './LiveTerminalStream';

/** Compact projection of the same audit state used by the full terminal stream. */
export class TelemetryRail {
  readonly #audit: SecurityAudit;
  readonly #lifetime = new Lifetime();
  constructor(root: HTMLElement, toggle: HTMLButtonElement, log: HTMLElement, leaks: HTMLElement, bytes: HTMLElement, shield: HTMLElement, audit: SecurityAudit) {
    this.#audit = audit;
    const stream = new TerminalLog(log, 18); this.#lifetime.own(() => stream.destroy());
    this.#lifetime.own(audit.subscribe(state => {
      leaks.textContent = String(state.leaksBlocked); bytes.textContent = `${state.memo.bytes}/512`; shield.textContent = state.shield;
      root.dataset.memoState = state.memo.state; stream.update(state.entries);
      root.querySelector('.telemetry-policy')?.replaceChildren(state.shieldDetail);
    }));
    const collapsed = (value: boolean): void => {
      root.classList.toggle('is-collapsed', value); toggle.setAttribute('aria-expanded', String(!value));
      toggle.setAttribute('aria-label', value ? 'Expand telemetry' : 'Collapse telemetry');
    };
    toggle.addEventListener('click', () => collapsed(!root.classList.contains('is-collapsed')), { signal: this.#lifetime.signal });
    const compact = matchMedia('(max-width: 1279px)'); const adapt = (): void => collapsed(compact.matches);
    compact.addEventListener('change', adapt, { signal: this.#lifetime.signal }); adapt();
  }
  memo(audit: MemoAudit, source: AuditSource = 'composer'): void { this.#audit.memo(audit, source); }
  log(event: SecurityEvent): void { this.#audit.log(event); }
  reset(): void { this.#audit.reset(); }
  destroy(): void { this.#lifetime.destroy(); }
}
