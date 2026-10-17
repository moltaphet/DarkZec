export function element<T extends HTMLElement>(id: string, constructor: { new (): T }): T {
  const found = document.getElementById(id);
  if (!(found instanceof constructor)) throw new Error(`Missing interface element: ${id}`);
  return found;
}

export interface Disposable { destroy(): void }

/** One owner for listeners, observers, timers and frame loops on this document. */
export class Lifetime implements Disposable {
  readonly abort = new AbortController();
  readonly #cleanups: (() => void)[] = [];
  get signal(): AbortSignal { return this.abort.signal; }
  own(dispose: () => void): void { this.#cleanups.push(dispose); }
  destroy(): void {
    this.abort.abort();
    for (const dispose of this.#cleanups.splice(0).reverse()) dispose();
  }
}
