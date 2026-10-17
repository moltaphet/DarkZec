import { Lifetime } from './dom';

export interface MotionLoop {
  invalidate(): void;
  destroy(): void;
}

/** Capped animation loop. A reduced-motion render receives a stable time of zero. */
export function motionLoop(target: HTMLElement, draw: (time: number, reduced: boolean) => void, continuous: boolean | (() => boolean) = true): MotionLoop {
  const lifetime = new Lifetime();
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let visible = true;
  let previous = -Infinity;
  let dirty = true;
  let disposed = false;
  const tick = (time: number): void => {
    frame = 0;
    if (disposed || document.hidden || !visible) return;
    if (dirty || time - previous >= 1000 / 30) {
      draw(preference.matches ? 0 : time, preference.matches);
      previous = time; dirty = false;
    }
    const running = typeof continuous === 'function' ? continuous() : continuous;
    if (running && !preference.matches) frame = requestAnimationFrame(tick);
  };
  const invalidate = (): void => {
    dirty = true;
    if (!frame && !disposed && !document.hidden && visible) frame = requestAnimationFrame(tick);
  };
  const pause = (): void => { cancelAnimationFrame(frame); frame = 0; };
  const observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    if (visible) invalidate(); else pause();
  });
  observer.observe(target);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else invalidate(); }, { signal: lifetime.signal });
  preference.addEventListener('change', () => { pause(); invalidate(); }, { signal: lifetime.signal });
  lifetime.own(() => observer.disconnect());
  lifetime.own(pause);
  invalidate();
  return { invalidate, destroy() { disposed = true; lifetime.destroy(); } };
}
