export type SecurityEvent = 'boot' | 'draft' | 'prepared' | 'committed' | 'seeded' | 'closed' | 'merkle' | 'cleared' | 'proof' | 'reset' | 'wallet' | 'erased' | 'blocked' | 'invalid';
export type PayloadSecurityState = 'idle' | 'auction-sealed' | 'vault-verified' | 'invalid';
export type AuditSource = 'composer' | 'wallet' | 'auction' | 'vault';
export type MemoAuditState = 'empty' | 'scrambling' | 'ready' | 'invalid';
export type AuditCategory = 'SYS_INIT' | 'ZIP-302' | 'ZIP-321' | 'AUDIT' | 'AUCTION' | 'VAULT' | 'NETWORK';
export type AuditLevel = 'info' | 'success' | 'warning';
export type ProtocolAuditEvent =
  | { readonly type: 'memo-validated'; readonly bytes: number }
  | { readonly type: 'commitment-created' }
  | { readonly type: 'uri-generated' }
  | { readonly type: 'preparation-rejected'; readonly phase: 'input' | 'memo' | 'commitment' | 'uri' };
export type ScanAuditEvent =
  | { readonly type: 'scan-started'; readonly total: number }
  | { readonly type: 'decryption-attempt' }
  | { readonly type: 'decryption-succeeded' }
  | { readonly type: 'scan-memo-validated'; readonly bytes: number }
  | { readonly type: 'note-rejected'; readonly authentication: boolean }
  | { readonly type: 'scan-completed'; readonly accepted: number; readonly rejected: number; readonly empty: number };
export type VaultOperation = 'save' | 'unlock' | 'load' | 'scan' | 'incoming';
export type VaultAuditEvent = ScanAuditEvent
  | { readonly type: 'vault-attempt'; readonly operation: VaultOperation }
  | { readonly type: 'vault-saved' }
  | { readonly type: 'vault-unlocked'; readonly mock: true }
  | { readonly type: 'vault-failed'; readonly operation: VaultOperation }
  | { readonly type: 'vault-locked' }
  | { readonly type: 'vault-forgotten' };
export type AuditObserver<T> = (event: T) => void;

/** Observability must never change a cryptographic operation's result. */
export function notifyAudit<T>(observer: AuditObserver<T> | undefined, event: T): void {
  try { observer?.(event); } catch { /* An isolated observer failure cannot interrupt the operation. */ }
}

export interface AuditEntry {
  readonly sequence: number;
  readonly timestamp: string;
  readonly category: AuditCategory;
  readonly level: AuditLevel;
  readonly simulated: boolean;
  readonly message: string;
}
export interface SecuritySnapshot {
  readonly entries: readonly AuditEntry[];
  readonly leaksBlocked: number;
  readonly shield: 'ACTIVE' | 'IDLE' | 'OFFLINE';
  readonly shieldDetail: string;
  readonly payloadState: PayloadSecurityState;
  readonly networkGuard: boolean;
  readonly memo: { readonly bytes: number; readonly state: MemoAuditState; readonly source: AuditSource };
  readonly totalEvents: number;
  readonly dropped: number;
}
const LABELS: Readonly<Record<SecurityEvent, readonly [AuditCategory, string, AuditLevel, boolean]>> = {
  boot: ['SYS_INIT', 'Local policy guard initialized', 'info', false],
  draft: ['ZIP-302', 'Private memo draft refreshed', 'info', false],
  prepared: ['AUDIT', 'Private payment request ready for review', 'success', false],
  committed: ['AUDIT', 'Bid payload encrypted and committed locally', 'success', true],
  seeded: ['AUCTION', 'Three sealed demo notes received', 'info', true],
  closed: ['AUCTION', 'Commitment set frozen', 'success', true],
  merkle: ['AUDIT', 'Merkle leaf generated for frozen commitment set; root compiled', 'success', true],
  cleared: ['AUCTION', 'Local uniform-price clearing completed', 'success', true],
  proof: ['AUDIT', 'Local inclusion proof verified', 'success', false],
  reset: ['AUCTION', 'Session buffers discarded', 'info', true],
  wallet: ['ZIP-321', 'Orchard-only wallet request ready for review', 'success', false],
  erased: ['AUDIT', 'Sensitive request erased', 'info', false],
  blocked: ['NETWORK', 'External request blocked by CSP', 'warning', false],
  invalid: ['AUDIT', 'Invalid operation refused; private details omitted', 'warning', false],
};
const OPERATIONS: Readonly<Record<VaultOperation, string>> = { save: 'encrypted session save', unlock: 'local session unlock', load: 'mock fixture load', scan: 'mock note scan', incoming: 'mock incoming note' };
const isBytes = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= 512;
const isCount = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= 128;
const PAYLOAD_STATES: Readonly<Record<PayloadSecurityState, readonly [SecuritySnapshot['shield'], string]>> = {
  idle: ['IDLE', 'No verified encrypted bid payload in this view; wallet URIs are readable.'],
  'auction-sealed': ['ACTIVE', 'Sealed local auction payloads use mock AES-GCM; no live Orchard connection.'],
  'vault-verified': ['ACTIVE', 'Mock note authentication and bid validation verified locally; no real Orchard decryption.'],
  invalid: ['OFFLINE', 'Local payload verification failed; no verified payload is active in this view.'],
};

/** Fixed event vocabulary only. No event object, free-form string or private input is retained. */
export class SecurityAudit {
  readonly #clock: () => number;
  readonly #listeners = new Set<(snapshot: SecuritySnapshot) => void>();
  readonly #entries: AuditEntry[] = [];
  #sequence = 0;
  #dropped = 0;
  #blocked = 0;
  #payloadState: PayloadSecurityState = 'idle';
  #guard = false;
  #memo: SecuritySnapshot['memo'] = Object.freeze({ bytes: 0, state: 'empty', source: 'composer' });
  #lastTime = 0;
  #disposed = false;
  constructor(clock: () => number = Date.now) { this.#clock = clock; }

  snapshot(): SecuritySnapshot {
    const [shield, shieldDetail] = PAYLOAD_STATES[this.#payloadState];
    return Object.freeze({ entries: Object.freeze([...this.#entries]), leaksBlocked: this.#blocked, shield, shieldDetail, payloadState: this.#payloadState,
      networkGuard: this.#guard, memo: this.#memo, totalEvents: this.#sequence, dropped: this.#dropped });
  }
  subscribe(listener: (snapshot: SecuritySnapshot) => void): () => void {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener); notifyAudit(listener, this.snapshot());
    return () => { this.#listeners.delete(listener); };
  }
  #publish(): void {
    if (this.#disposed) return;
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) notifyAudit(listener, snapshot);
  }
  #record(category: AuditCategory, message: string, level: AuditLevel = 'info', simulated = false): void {
    if (this.#disposed) return;
    const now = this.#clock();
    this.#lastTime = Math.max(this.#lastTime, Number.isFinite(now) && now >= 0 && now < 8.64e15 ? Math.floor(now) : 0);
    this.#entries.push(Object.freeze({ sequence: ++this.#sequence, timestamp: new Date(this.#lastTime).toISOString(), category, message, level, simulated }));
    if (this.#entries.length > 128) { this.#entries.shift(); this.#dropped++; }
    this.#publish();
  }
  log(event: SecurityEvent): void {
    if (!Object.hasOwn(LABELS, event) || this.#disposed) return;
    const label = LABELS[event];
    if (event === 'blocked') this.#blocked++;
    this.#record(...label);
  }
  encryption(state: PayloadSecurityState): void {
    if (!Object.hasOwn(PAYLOAD_STATES, state) || state === this.#payloadState || this.#disposed) return;
    this.#payloadState = state;
    this.#record('AUDIT', PAYLOAD_STATES[state][1], state === 'invalid' ? 'warning' : 'info', state === 'auction-sealed' || state === 'vault-verified');
  }
  networkGuard(active: boolean): void {
    this.#guard = active;
    this.#record('NETWORK', active ? 'Outbound connection guard enabled: CSP connect-src none' : 'Outbound connection guard is not confirmed', active ? 'success' : 'warning');
  }
  memo(audit: { readonly bytes: number; readonly state: MemoAuditState }, source: AuditSource = 'composer'): void {
    if (this.#disposed || !isBytes(audit.bytes) || !['empty', 'scrambling', 'ready', 'invalid'].includes(audit.state) || !['composer', 'wallet', 'auction', 'vault'].includes(source)) return;
    if (this.#memo.bytes === audit.bytes && this.#memo.state === audit.state && this.#memo.source === source) return;
    this.#memo = Object.freeze({ bytes: audit.bytes, state: audit.state, source });
    if (audit.state === 'invalid') this.#record('ZIP-302', 'Memo draft rejected; private input omitted', 'warning');
    else this.#publish();
  }
  protocol(event: ProtocolAuditEvent, source: AuditSource): void {
    if (!['composer', 'wallet', 'auction', 'vault'].includes(source)) return;
    switch (event.type) {
      case 'memo-validated': if (isBytes(event.bytes)) this.#record('ZIP-302', `UTF-8 memo validated: ${event.bytes}/512 bytes (${source})`, 'success'); break;
      case 'commitment-created': this.#record('AUDIT', 'Salted SHA-256 commitment created locally', 'success'); break;
      case 'uri-generated': this.#record('ZIP-321', 'Payment URI generated locally; payload withheld', 'success'); break;
      case 'preparation-rejected': this.#record(event.phase === 'memo' ? 'ZIP-302' : 'ZIP-321', 'Private request preparation refused; input omitted', 'warning'); break;
    }
  }
  vault(event: VaultAuditEvent): void {
    switch (event.type) {
      case 'vault-attempt': if (Object.hasOwn(OPERATIONS, event.operation)) { this.encryption('idle'); this.#record('VAULT', `Attempt started: ${OPERATIONS[event.operation]}`); } break;
      case 'vault-saved': this.#record('VAULT', 'Viewing-key session encrypted and saved; key withheld', 'success'); break;
      case 'vault-unlocked': this.#record('VAULT', 'Mock vault unlocked locally', 'success', true); break;
      case 'vault-failed': if (Object.hasOwn(OPERATIONS, event.operation)) { this.encryption('invalid'); this.#record('VAULT', `Attempt refused: ${OPERATIONS[event.operation]}; private details omitted`, 'warning'); } break;
      case 'vault-locked': this.encryption('idle'); this.memo({ bytes: 0, state: 'empty' }, 'vault'); this.#record('VAULT', 'Vault locked; live keys and private rows cleared'); break;
      case 'vault-forgotten': this.#record('VAULT', 'Encrypted viewing-key session removed'); break;
      case 'scan-started': if (isCount(event.total)) { this.encryption('idle'); this.memo({ bytes: 0, state: 'empty' }, 'vault'); this.#record('VAULT', `Authenticated scan started: ${event.total} mock envelopes`, 'info', true); } break;
      case 'decryption-attempt': this.#record('VAULT', 'Mock note decryption attempted', 'info', true); break;
      case 'decryption-succeeded': this.#record('ZIP-302', '512-byte memo field extracted after authenticated mock decryption', 'success', true); break;
      case 'scan-memo-validated': if (isBytes(event.bytes)) { this.encryption('vault-verified'); this.memo({ bytes: event.bytes, state: 'ready' }, 'vault'); this.#record('ZIP-302', `Decoded bid schema validated: ${event.bytes}/512 JSON bytes`, 'success', true); } break;
      case 'note-rejected': this.#record('VAULT', event.authentication ? 'Mock decryption authentication failed; note quarantined' : 'Mock note validation failed; note quarantined', 'warning', true); break;
      case 'scan-completed': if ([event.accepted, event.rejected, event.empty].every(isCount) && event.accepted + event.rejected + event.empty <= 128) {
        this.encryption(event.accepted > 0 ? 'vault-verified' : event.rejected > 0 ? 'invalid' : 'idle');
        this.#record('VAULT', `Mock scan complete: ${event.accepted} accepted / ${event.rejected} quarantined / ${event.empty} empty`, 'success', true);
      } break;
    }
  }
  clear(): void { if (!this.#disposed) { this.#entries.splice(0); this.#dropped = 0; this.#publish(); } }
  reset(): void { this.#payloadState = 'idle'; this.clear(); this.memo({ bytes: 0, state: 'empty' }); this.log('reset'); }
  destroy(): void { this.#disposed = true; this.#listeners.clear(); this.#entries.splice(0); }
}
