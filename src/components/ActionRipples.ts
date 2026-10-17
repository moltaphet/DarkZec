import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';

export function mountActionRipples(root: HTMLElement): Disposable {
  const lifetime = new Lifetime();
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  root.addEventListener('click', event => {
    if (preference.matches || !(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('.button.primary');
    if (!target || target.getAttribute('aria-disabled') === 'true' || (target instanceof HTMLButtonElement && target.disabled)) return;
    const bounds = target.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'action-ripple'; ripple.setAttribute('aria-hidden', 'true');
    const x = event.detail ? event.clientX - bounds.left : bounds.width / 2;
    const y = event.detail ? event.clientY - bounds.top : bounds.height / 2;
    const size = Math.max(bounds.width, bounds.height) * 2;
    ripple.style.width = `${size}px`; ripple.style.height = `${size}px`;
    ripple.style.left = `${x - size / 2}px`; ripple.style.top = `${y - size / 2}px`;
    // At most three transient layers per button even under repeated clicks.
    const existing = target.querySelectorAll('.action-ripple');
    if (existing.length >= 3) existing[0]?.remove();
    target.append(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true, signal: lifetime.signal });
  }, { capture: true, signal: lifetime.signal });
  lifetime.own(() => root.querySelectorAll('.action-ripple').forEach(ripple => ripple.remove()));
  return lifetime;
}
