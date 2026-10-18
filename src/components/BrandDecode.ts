import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%/<>*';

/** Brand text settles left to right out of random glyphs on load and whenever it is hovered or focused. */
export function mountBrandDecode(target: HTMLElement, trigger: HTMLElement = target): Disposable {
  const lifetime = new Lifetime();
  const original = target.textContent ?? '';
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0; let timer = 0; let running = false;
  const restore = (): void => { target.textContent = original; running = false; };
  const play = (): void => {
    if (running || preference.matches || document.hidden || original.length === 0) return;
    running = true; const started = performance.now(); let lastSwap = 0;
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - started) / 1100);
      if (now - lastSwap > 60 || progress >= 1) {
        lastSwap = now; let text = '';
        for (let index = 0; index < original.length; index++) {
          const settled = progress >= 0.15 + 0.8 * index / original.length;
          text += settled || original[index] === ' ' ? original[index] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
        target.textContent = text;
      }
      if (progress < 1) frame = requestAnimationFrame(tick); else restore();
    };
    frame = requestAnimationFrame(tick);
  };
  trigger.addEventListener('pointerenter', play, { signal: lifetime.signal });
  trigger.addEventListener('focus', play, { signal: lifetime.signal });
  timer = window.setTimeout(play, 250);
  lifetime.own(() => { cancelAnimationFrame(frame); clearTimeout(timer); restore(); });
  return lifetime;
}
