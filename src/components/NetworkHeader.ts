import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';

export function mountNetworkHeader(header: HTMLElement, brand: HTMLElement): Disposable {
  const lifetime = new Lifetime();
  const scan = document.createElement('span');
  scan.className = 'header-scanner'; scan.setAttribute('aria-hidden', 'true');
  header.append(scan);
  const change = (): void => {
    header.classList.toggle('motion-paused', document.hidden);
    document.documentElement.classList.toggle('terminal-paused', document.hidden);
  };
  document.addEventListener('visibilitychange', change, { signal: lifetime.signal });
  const glitch = (): void => {
    brand.classList.remove('is-glitching');
    // Restart through a bounded animation, without reading layout to force a reflow.
    brand.getAnimations().forEach(animation => animation.cancel());
    brand.classList.add('is-glitching');
  };
  brand.addEventListener('pointerenter', glitch, { signal: lifetime.signal });
  brand.addEventListener('focus', glitch, { signal: lifetime.signal });
  brand.addEventListener('animationend', () => brand.classList.remove('is-glitching'), { signal: lifetime.signal });
  change();
  lifetime.own(() => { scan.remove(); brand.classList.remove('is-glitching'); document.documentElement.classList.remove('terminal-paused'); });
  return lifetime;
}
