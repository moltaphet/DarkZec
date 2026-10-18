import { Lifetime } from './dom';
import type { Disposable } from './dom';
import type { SecurityAudit } from './security-events';

/** Passive CSP observation only; blocked destinations and raw browser events are never retained. */
export function monitorSecurityPolicy(audit: SecurityAudit): Disposable {
  const lifetime = new Lifetime();
  const meta = document.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]');
  audit.networkGuard((meta?.content ?? '').split(';').some(directive => directive.trim() === "connect-src 'none'"));
  document.addEventListener('securitypolicyviolation', event => {
    if (event.disposition !== 'enforce') return;
    // The HTTP and fallback meta policies both report this application's same restriction.
    if (meta && event.originalPolicy.includes('frame-ancestors')) return;
    try {
      const destination = new URL(event.blockedURI, location.href);
      if (['http:', 'https:', 'ws:', 'wss:'].includes(destination.protocol) && destination.origin !== location.origin) audit.log('blocked');
    } catch { /* Non-URL policy violations do not imply an external request. */ }
  }, { signal: lifetime.signal });
  return lifetime;
}
