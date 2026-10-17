import { encodeMemo } from '../protocol/memo';
import type { PreparedBid } from '../protocol/memo';
import { motionLoop } from '../lib/motion';
import type { MotionLoop } from '../lib/motion';

export type MemoState = 'empty' | 'scrambling' | 'ready' | 'invalid';
export interface MemoAudit { readonly bytes: number; readonly state: MemoState }

/** A private draft viewer. The exact draft returned here is reused on Prepare. */
export class MemoScramble {
  readonly #root: HTMLElement;
  readonly #payload: HTMLElement;
  readonly #stream: HTMLElement;
  readonly #label: HTMLElement;
  readonly #load: () => Promise<PreparedBid>;
  readonly #audit: (audit: MemoAudit) => void;
  readonly #loop: MotionLoop;
  #revision = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending: Promise<PreparedBid> | undefined;
  #draft: PreparedBid | undefined;
  #state: MemoState = 'empty';
  #target = '';
  #started = 0;

  constructor(root: HTMLElement, payload: HTMLElement, stream: HTMLElement, label: HTMLElement,
    load: () => Promise<PreparedBid>, audit: (audit: MemoAudit) => void) {
    this.#root = root; this.#payload = payload; this.#stream = stream; this.#label = label;
    this.#load = load; this.#audit = audit;
    this.#loop = motionLoop(root, (time, reduced) => this.#draw(time, reduced), () => this.#state === 'scrambling');
  }

  update(): void {
    this.clear();
    this.#state = 'scrambling'; this.#started = performance.now();
    this.#root.dataset.state = this.#state;
    this.#label.textContent = 'ASSEMBLING LOCAL DRAFT';
    this.#payload.textContent = '4F 3A B2 07 D9 A1 6C 80';
    this.#audit({ bytes: 0, state: this.#state });
    const revision = this.#revision;
    this.#timer = setTimeout(() => { this.#timer = undefined; void this.#request(revision).catch(() => undefined); }, 220);
    this.#loop.invalidate();
  }

  async prepare(): Promise<PreparedBid> {
    clearTimeout(this.#timer); this.#timer = undefined;
    if (this.#draft) return this.#draft;
    return this.#pending ?? this.#request(this.#revision);
  }

  #request(revision: number): Promise<PreparedBid> {
    this.#state = 'scrambling'; this.#root.dataset.state = this.#state;
    const pending = Promise.resolve().then(this.#load).then(draft => {
      if (revision !== this.#revision) throw new Error('The draft changed. Prepare the current bid again.');
      this.#draft = draft; this.#target = encodeMemo(draft.memo); this.#started = performance.now();
      this.#audit({ bytes: draft.byteLength, state: 'ready' });
      this.#loop.invalidate(); return draft;
    }).catch((error: unknown) => {
      if (revision === this.#revision) {
        this.#state = 'invalid'; this.#target = ''; this.#draft = undefined;
        this.#payload.textContent = 'AWAITING VALID BID INPUT'; this.#stream.textContent = '— — — — — — — — — — — —';
        this.#label.textContent = 'DRAFT INVALID / CHECK INPUTS'; this.#root.dataset.state = this.#state;
        this.#audit({ bytes: 0, state: 'invalid' });
      }
      throw error;
    }).finally(() => { if (revision === this.#revision) this.#pending = undefined; });
    this.#pending = pending;
    this.#loop.invalidate();
    return pending;
  }

  #draw(time: number, reduced: boolean): void {
    if (this.#state !== 'scrambling') return;
    const progress = this.#target ? (reduced ? 1 : Math.min(1, (time - this.#started) / 650)) : 0;
    const tick = Math.floor(time / 60);
    const bytes = Array.from({ length: 42 }, (_, i) => ((i * 41 + tick * 19 + this.#revision * 7) & 255).toString(16).padStart(2, '0').toUpperCase());
    this.#stream.textContent = bytes.join(' ');
    if (!this.#target) return;
    const resolved = Math.floor(this.#target.length * progress);
    this.#payload.textContent = this.#target.slice(0, resolved) + this.#target.slice(resolved).replace(/./g, (_, offset: number) => '0123456789ABCDEF'[(offset + tick * 3) % 16] ?? '0');
    if (progress >= 1) {
      this.#state = 'ready'; this.#root.dataset.state = this.#state;
      this.#label.textContent = 'BASE64URL READY / LOCAL ONLY';
      this.#stream.textContent = 'ZIP-302 JSON  →  UTF-8 AUDIT  →  ZIP-321 BASE64URL';
    }
  }

  clear(): void {
    this.#revision++; clearTimeout(this.#timer); this.#timer = undefined;
    this.#pending = undefined; this.#draft = undefined; this.#target = ''; this.#state = 'empty';
    this.#payload.textContent = 'NO ACTIVE MEMO DRAFT'; this.#stream.textContent = '— — — — — — — — — — — —';
    this.#label.textContent = 'MEMO BUFFER / CLEARED'; this.#root.dataset.state = this.#state;
    this.#audit({ bytes: 0, state: 'empty' });
  }
  destroy(): void { this.clear(); this.#loop.destroy(); }
}
