import { blake2b } from '@noble/hashes/blake2.js';
import { bech32m } from '@scure/base';

export type Network = 'mainnet' | 'testnet';
export interface Receiver { readonly type: number; readonly bytes: Uint8Array }
const encoder = new TextEncoder();
const MAX_ADDRESS_LENGTH = 2048;

function xor(left: Uint8Array, right: Uint8Array): Uint8Array {
  return left.map((byte, i) => byte ^ (right[i] ?? 0));
}

/** ZIP-316 four-round Feistel permutation; independently tested against official UAs. */
export function f4jumble(input: Uint8Array, inverse = false): Uint8Array {
  if (input.length < 48 || input.length > 1280) throw new Error('Unsupported Unified Address length.');
  const leftLength = Math.min(64, Math.floor(input.length / 2));
  let left: Uint8Array = input.slice(0, leftLength);
  let right: Uint8Array = input.slice(leftLength);
  const h = (round: number, data: Uint8Array): Uint8Array => blake2b(data, {
    dkLen: leftLength, personalization: new Uint8Array([...encoder.encode('UA_F4Jumble_H'), round, 0, 0]),
  });
  const g = (round: number, data: Uint8Array): Uint8Array => {
    const output = new Uint8Array(right.length);
    for (let block = 0; block * 64 < output.length; block++) {
      const digest = blake2b(data, { dkLen: 64, personalization: new Uint8Array([
        ...encoder.encode('UA_F4Jumble_G'), round, block & 255, block >>> 8,
      ]) });
      output.set(digest.slice(0, Math.min(64, output.length - block * 64)), block * 64);
    }
    return output;
  };
  if (inverse) {
    for (const round of [1, 0]) { left = xor(left, h(round, right)); right = xor(right, g(round, left)); }
  } else {
    for (const round of [0, 1]) { right = xor(right, g(round, left)); left = xor(left, h(round, right)); }
  }
  return new Uint8Array([...left, ...right]);
}

function readCompact(bytes: Uint8Array, cursor: { offset: number }): number {
  const lead = bytes[cursor.offset++];
  if (lead === undefined) throw new Error('Truncated Unified Address item.');
  if (lead < 253) return lead;
  const length = lead === 253 ? 2 : lead === 254 ? 4 : 8;
  if (cursor.offset + length > bytes.length) throw new Error('Truncated CompactSize.');
  let value = 0n;
  for (let i = 0; i < length; i++) value |= BigInt(bytes[cursor.offset++] ?? 0) << BigInt(i * 8);
  const minimum = length === 2 ? 253n : length === 4 ? 65536n : 4294967296n;
  if (value < minimum || value > 0x2000000n) throw new Error('Invalid CompactSize.');
  return Number(value);
}

export function decodeUnifiedAddress(address: string, network: Network): readonly Receiver[] {
  if (address.length > MAX_ADDRESS_LENGTH || address !== address.toLowerCase()) throw new Error('Use a lowercase Unified Address (maximum 2048 characters).');
  const prefix = network === 'mainnet' ? 'u' : 'utest';
  let decoded: ReturnType<typeof bech32m.decode>;
  try { decoded = bech32m.decode(address as `${string}1${string}`, MAX_ADDRESS_LENGTH); }
  catch { throw new Error('Invalid Unified Address or Bech32m checksum.'); }
  if (decoded.prefix !== prefix) throw new Error(`A ${network} Unified Address is required.`);
  const raw = f4jumble(new Uint8Array(bech32m.fromWords(decoded.words)), true);
  const padding = new Uint8Array(16); padding.set(encoder.encode(prefix));
  if (!raw.slice(-16).every((byte, i) => byte === padding[i])) throw new Error('Invalid Unified Address padding.');
  const payload = raw.slice(0, -16);
  const receivers: Receiver[] = [];
  const cursor = { offset: 0 };
  let previous = -1;
  while (cursor.offset < payload.length) {
    const type = readCompact(payload, cursor);
    const length = readCompact(payload, cursor);
    if (type <= previous || length === 0 || cursor.offset + length > payload.length) throw new Error('Invalid Unified Address receiver ordering or length.');
    const bytes = payload.slice(cursor.offset, cursor.offset + length);
    cursor.offset += length;
    const expected = type <= 1 ? 20 : type <= 3 ? 43 : undefined;
    if (expected !== undefined && length !== expected) throw new Error('Invalid receiver length.');
    receivers.push({ type, bytes }); previous = type;
  }
  if (!receivers.some(({ type }) => type === 2 || type === 3)) throw new Error('A shielded receiver is required.');
  if (receivers.some(({ type }) => type === 0) && receivers.some(({ type }) => type === 1)) throw new Error('Conflicting transparent receivers.');
  return receivers;
}

// Orchard encodes a nonidentity Pallas point as little-endian x plus the sign of y.
// Pallas has cofactor one. Euler's criterion checks whether x^3 + 5 has a square root.
function validOrchardPoint(receiver: Uint8Array): boolean {
  const encoded = receiver.slice(11);
  const last = encoded[31];
  if (last === undefined || encoded.every(byte => byte === 0)) return false;
  const sign = last >>> 7; encoded[31] = last & 127;
  let x = 0n;
  for (let i = 31; i >= 0; i--) x = (x << 8n) | BigInt(encoded[i] ?? 0);
  const modulus = 0x40000000000000000000000000000000224698fc094cf91b992d30ed00000001n;
  if (x >= modulus) return false;
  const rhs = (x * x % modulus * x + 5n) % modulus;
  if (rhs === 0n) return sign === 0;
  let exponent = (modulus - 1n) / 2n; let base = rhs; let result = 1n;
  while (exponent > 0n) {
    if (exponent & 1n) result = result * base % modulus;
    base = base * base % modulus; exponent >>= 1n;
  }
  return result === 1n;
}

/** Deliberately stricter than ZIP-316: no fallback receivers or unknown extensions. */
export function validateOrchardAddress(address: string, network: Network): string {
  const receivers = decodeUnifiedAddress(address, network);
  const orchard = receivers[0];
  if (receivers.length !== 1 || orchard?.type !== 3) throw new Error('Use an Orchard-only Unified Address to prevent receiver fallback.');
  if (!validOrchardPoint(orchard.bytes)) throw new Error('Invalid Orchard payment point.');
  return address;
}

/** Encodes public receiver bytes; does not generate keys or prove address ownership. */
export function encodeOrchardAddress(receiver: Uint8Array, network: Network): string {
  if (receiver.length !== 43 || !validOrchardPoint(receiver)) throw new Error('Invalid Orchard receiver.');
  const prefix = network === 'mainnet' ? 'u' : 'utest';
  const padding = new Uint8Array(16); padding.set(encoder.encode(prefix));
  const raw = new Uint8Array([3, 43, ...receiver, ...padding]);
  return bech32m.encode(prefix, bech32m.toWords(f4jumble(raw)), MAX_ADDRESS_LENGTH);
}
