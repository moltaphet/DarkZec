import { hex, unhex, utf8 } from '../protocol/crypto';
import { KEY_ALGORITHM, signerFromKey } from './operator-journal';
import type { OperatorSigner } from './operator-journal';

/**
 * A passphrase-encrypted backup of the operator's signing key, so an auction survives a closed tab, a crash or a dropped
 * connection. The session key itself stays non-extractable: it is generated extractable only long enough to be exported
 * and encrypted, then re-imported as non-extractable, and the extractable copy is dropped.
 *
 * File: PBKDF2-SHA256 (600,000 rounds) derives an AES-256-GCM key from the passphrase; the public key is bound as
 * additional authenticated data, so a file cannot be re-labelled with another key.
 */
export interface OperatorKeyFile {
  readonly v: 1; readonly kind: 'darkzec-operator-key'; readonly publicKey: string;
  readonly kdf: { readonly name: 'PBKDF2-SHA256'; readonly iterations: number; readonly salt: string };
  readonly iv: string; readonly data: string;
}
export const OPERATOR_KEY_ROUNDS = 600_000;
export const OPERATOR_KEY_MAX_BYTES = 4096;
export const MIN_PASSPHRASE = 8;
const HEX = (bytes: number) => new RegExp(`^[a-f0-9]{${bytes * 2}}$`);
const aad = (publicKey: string): Uint8Array<ArrayBuffer> => utf8(`DARKZEC/operator-key/v1|${publicKey}`);
const bad = (): never => { throw new Error('Wrong passphrase, or this is not an operator key file.'); };

async function wrappingKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', utf8(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
function publicKeyOf(jwk: JsonWebKey): string {
  const x = jwk.x; const y = jwk.y;
  if (typeof x !== 'string' || typeof y !== 'string') return bad();
  const decode = (value: string): Uint8Array => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), char => char.charCodeAt(0));
  const [px, py] = [decode(x), decode(y)];
  if (px.length !== 32 || py.length !== 32) return bad();
  return `04${hex(px)}${hex(py)}`;
}

/** Generates a fresh operator key and the encrypted file that restores it. */
export async function createBackedUpSigner(passphrase: string, iterations = OPERATOR_KEY_ROUNDS): Promise<{ readonly signer: OperatorSigner; readonly file: OperatorKeyFile }> {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters to encrypt the operator key backup.`);
  const pair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = hex(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(publicKey) }, await wrappingKey(passphrase, salt, iterations, 'encrypt'), utf8(JSON.stringify(jwk)));
  const signingKey = await crypto.subtle.importKey('jwk', jwk, KEY_ALGORITHM, false, ['sign']);
  return Object.freeze({ signer: signerFromKey(signingKey, publicKey),
    file: Object.freeze({ v: 1, kind: 'darkzec-operator-key', publicKey, kdf: Object.freeze({ name: 'PBKDF2-SHA256', iterations, salt: hex(salt) }), iv: hex(iv), data: hex(new Uint8Array(sealed)) }) });
}

export const serializeOperatorKey = (file: OperatorKeyFile): string => `${JSON.stringify(file, null, 2)}\n`;

/** Strict parse of a key file's text; semantic checks happen when it is decrypted. */
export function parseOperatorKeyFile(text: string): OperatorKeyFile {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > OPERATOR_KEY_MAX_BYTES) return bad();
  let value: unknown; try { value = JSON.parse(text); } catch { return bad(); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return bad();
  const record = value as Record<string, unknown>; const kdf = record.kdf as Record<string, unknown> | undefined;
  if (Object.keys(record).sort().join(',') !== 'data,iv,kdf,kind,publicKey,v' || record.v !== 1 || record.kind !== 'darkzec-operator-key' ||
    typeof record.publicKey !== 'string' || !/^04[a-f0-9]{128}$/.test(record.publicKey) || typeof record.iv !== 'string' || !HEX(12).test(record.iv) ||
    typeof record.data !== 'string' || !/^(?:[a-f0-9]{2}){16,2048}$/.test(record.data) ||
    typeof kdf !== 'object' || kdf === null || Object.keys(kdf).sort().join(',') !== 'iterations,name,salt' || kdf.name !== 'PBKDF2-SHA256' ||
    !Number.isSafeInteger(kdf.iterations) || (kdf.iterations as number) < 1000 || (kdf.iterations as number) > 5_000_000 || typeof kdf.salt !== 'string' || !HEX(16).test(kdf.salt)) return bad();
  return Object.freeze({ v: 1, kind: 'darkzec-operator-key', publicKey: record.publicKey, kdf: Object.freeze({ name: 'PBKDF2-SHA256', iterations: kdf.iterations as number, salt: kdf.salt }),
    iv: record.iv, data: record.data });
}

/** Decrypts a key file into a non-extractable signer for the same public key. */
export async function restoreSigner(file: OperatorKeyFile, passphrase: string): Promise<OperatorSigner> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(file.iv), additionalData: aad(file.publicKey) },
      await wrappingKey(passphrase, unhex(file.kdf.salt), file.kdf.iterations, 'decrypt'), unhex(file.data));
    const jwk = JSON.parse(new TextDecoder().decode(plain)) as JsonWebKey;
    if (publicKeyOf(jwk) !== file.publicKey) return bad();
    return signerFromKey(await crypto.subtle.importKey('jwk', jwk, KEY_ALGORITHM, false, ['sign']), file.publicKey);
  } catch { return bad(); }
}
