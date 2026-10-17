import { bech32m } from '@scure/base';
import { f4jumble } from '../protocol/address';
import { hex, utf8 } from '../protocol/crypto';
import { decodeHex, VaultError } from './vault-memo';

export const VIEWING_SESSION_KEY = 'darkzec.viewing-vault.v1';
export const DEMO_VIEWING_KEY = `mock:node07:${'07'.repeat(32)}`;
export const DEMO_UNLOCK_PASSPHRASE = 'node07-demo-passphrase';
const ITERATIONS = 600_000;
const SESSION_AAD = utf8('DARKZEC/viewing-key-session/v1');
export type ViewingKeyKind = 'mock' | 'unified';
export interface SessionStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
interface SavedKey { readonly v: 1; readonly kdf: 'PBKDF2-SHA256'; readonly iterations: number; readonly salt: string; readonly iv: string; readonly ciphertext: string }

/** Unified key envelope/checksum checks only; real key semantics belong to an Orchard adapter. */
export function viewingKeyKind(value: string): ViewingKeyKind {
  if (/^mock:node07:[a-f0-9]{64}$/.test(value)) return 'mock';
  if (value.length > 2048 || value !== value.toLowerCase() || !/^uview(?:test)?1/.test(value)) throw new Error('Enter a Unified Viewing Key or use the demo mock key. Never enter a seed or spending key.');
  try {
    const decoded = bech32m.decode(value as `${string}1${string}`, 2048);
    if (decoded.prefix !== 'uview' && decoded.prefix !== 'uviewtest') throw new Error('prefix');
    const raw = f4jumble(new Uint8Array(bech32m.fromWords(decoded.words)), true);
    const padding = new Uint8Array(16); padding.set(utf8(decoded.prefix));
    if (!raw.slice(-16).every((byte, i) => byte === padding[i])) throw new Error('padding');
  } catch { throw new Error('Unified Viewing Key checksum or envelope is invalid. Real key compatibility still requires an Orchard adapter.'); }
  return 'unified';
}

function validatePassphrase(value: string): void {
  if (value.length < 12 || value.length > 128) throw new Error('Use a local unlock passphrase of 12–128 characters.');
}
async function wrappingKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  validatePassphrase(passphrase);
  const bytes = utf8(passphrase);
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { bytes.fill(0); }
}
function parseRecord(text: string): SavedKey {
  if (text.length > 8192) throw new VaultError('session');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new VaultError('session'); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new VaultError('session');
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(record).sort().join(',') !== 'ciphertext,iterations,iv,kdf,salt,v' || record.v !== 1 || record.kdf !== 'PBKDF2-SHA256' || record.iterations !== ITERATIONS ||
    typeof record.salt !== 'string' || typeof record.iv !== 'string' || typeof record.ciphertext !== 'string') throw new VaultError('session');
  if (!/^[a-f0-9]{32}$/.test(record.salt) || !/^[a-f0-9]{24}$/.test(record.iv) || !/^(?:[a-f0-9]{2}){17,2064}$/.test(record.ciphertext)) throw new VaultError('session');
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: record.salt, iv: record.iv, ciphertext: record.ciphertext };
}

export class ViewingKeySession {
  readonly #store: SessionStore | null;
  #revision = 0;
  constructor(store: SessionStore | null) { this.#store = store; }
  #storage(): SessionStore { if (!this.#store) throw new Error('Tab storage is unavailable. Enable it to save an encrypted viewing-key session.'); return this.#store; }
  status(): 'empty' | 'saved' | 'corrupt' | 'unavailable' {
    try { const record = this.#storage().getItem(VIEWING_SESSION_KEY); if (record === null) return 'empty'; parseRecord(record); return 'saved'; }
    catch (error: unknown) { return error instanceof VaultError ? 'corrupt' : 'unavailable'; }
  }
  cancel(): void { this.#revision++; }
  async save(viewingKey: string, passphrase: string): Promise<ViewingKeyKind> {
    const revision = ++this.#revision;
    const kind = viewingKeyKind(viewingKey); const store = this.#storage();
    const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await wrappingKey(passphrase, salt); const bytes = utf8(viewingKey);
    try {
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: SESSION_AAD }, key, bytes);
      if (revision !== this.#revision) throw new VaultError('cancelled');
      const record: SavedKey = { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: hex(salt), iv: hex(iv), ciphertext: hex(new Uint8Array(ciphertext)) };
      try { store.setItem(VIEWING_SESSION_KEY, JSON.stringify(record)); } catch { throw new Error('Encrypted session could not be saved. Check tab storage permissions.'); }
      return kind;
    } finally { bytes.fill(0); }
  }
  async unlock(passphrase: string): Promise<string> {
    const revision = ++this.#revision;
    const text = this.#storage().getItem(VIEWING_SESSION_KEY); if (text === null) throw new Error('No saved viewing-key session. Save a key first.');
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    try {
      const record = parseRecord(text);
      const key = await wrappingKey(passphrase, decodeHex(record.salt, 16));
      bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeHex(record.iv, 12), additionalData: SESSION_AAD }, key,
        decodeHex(record.ciphertext, record.ciphertext.length / 2)));
      const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      viewingKeyKind(value);
      if (revision !== this.#revision) throw new VaultError('cancelled');
      return value;
    } catch (error: unknown) { if (error instanceof VaultError && error.code === 'cancelled') throw error; throw new VaultError('session'); }
    finally { bytes?.fill(0); }
  }
  forget(): void {
    this.cancel();
    try { this.#storage().removeItem(VIEWING_SESSION_KEY); } catch { throw new Error('Saved session could not be removed. Check tab storage permissions.'); }
  }
}

/** The sole authorized persistence boundary; only encrypted session records are written. */
export function browserViewingKeySession(): ViewingKeySession {
  try { return new ViewingKeySession(window.sessionStorage); } catch { return new ViewingKeySession(null); }
}
