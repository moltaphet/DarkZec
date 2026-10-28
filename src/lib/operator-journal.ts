import { formatZec, parseZec, validateAuctionId } from '../protocol/amount';
import { hex, sha256, unhex, utf8 } from '../protocol/crypto';
import type { Allocation } from './darkpool';

/** A canonical statement text and the operator's ECDSA P-256 / SHA-256 signature over its UTF-8 bytes. */
export interface SignedStatement { readonly statement: string; readonly signature: string }
export interface OperatorSigner { readonly publicKey: string; sign(statement: string): Promise<string> }
export interface ResultSummary {
  readonly clearingPrice: string; readonly filled: number; readonly excluded: number;
  readonly forfeitedCollateral: string; readonly postedCollateral: string; readonly allocations: readonly Allocation[];
}
export type ParsedStatement =
  | { readonly type: 'listing'; readonly auctionId: string; readonly digest: string }
  | { readonly type: 'close'; readonly auctionId: string; readonly root: string; readonly count: number; readonly closedAt: number; readonly revealDeadline: number }
  | { readonly type: 'reveal-ack'; readonly auctionId: string; readonly root: string; readonly commitment: string; readonly index: number; readonly acceptedAt: number }
  | { readonly type: 'result'; readonly auctionId: string; readonly root: string; readonly digest: string };

const KEY = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' } as const;
const HASH = /^[a-f0-9]{64}$/;
const isTime = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isIndex = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < 128;

/** The private key is generated non-extractable, so it never leaves WebCrypto; only the public key is exported. */
export async function createOperatorSigner(): Promise<OperatorSigner> {
  const pair = await crypto.subtle.generateKey(KEY, false, ['sign', 'verify']);
  const publicKey = hex(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  return Object.freeze({
    publicKey,
    async sign(statement: string): Promise<string> { return hex(new Uint8Array(await crypto.subtle.sign(SIGNATURE, pair.privateKey, utf8(statement)))); },
  });
}

/** Never throws: malformed keys, signatures or statements simply fail verification. */
export async function verifyStatement(publicKey: string, signed: SignedStatement): Promise<boolean> {
  if (typeof publicKey !== 'string' || !/^04[a-f0-9]{128}$/.test(publicKey)) return false;
  if (typeof signed?.signature !== 'string' || !/^[a-f0-9]{128}$/.test(signed.signature) || typeof signed.statement !== 'string') return false;
  try {
    const key = await crypto.subtle.importKey('raw', unhex(publicKey), KEY, false, ['verify']);
    return await crypto.subtle.verify(SIGNATURE, key, unhex(signed.signature), utf8(signed.statement));
  } catch { return false; }
}

/** Signed before the first bid: binds the operator key to the public listing (rules, vault and deadlines). */
export function listingStatement(auctionId: string, digest: string): string {
  validateAuctionId(auctionId);
  if (!HASH.test(digest)) throw new Error('Invalid listing statement.');
  return JSON.stringify(['DARKZEC/listing/v1', auctionId, digest]);
}
export function closeStatement(auctionId: string, root: string, count: number, closedAt: number, revealDeadline: number): string {
  validateAuctionId(auctionId);
  if (!HASH.test(root) || !Number.isSafeInteger(count) || count < 0 || count > 128 || !isTime(closedAt) || !isTime(revealDeadline) || revealDeadline <= closedAt) throw new Error('Invalid close statement.');
  return JSON.stringify(['DARKZEC/close/v1', auctionId, root, count, closedAt, revealDeadline]);
}
export function revealAckStatement(auctionId: string, root: string, commitment: string, index: number, acceptedAt: number): string {
  validateAuctionId(auctionId);
  if (!HASH.test(root) || !HASH.test(commitment) || !isIndex(index) || !isTime(acceptedAt)) throw new Error('Invalid reveal acknowledgement.');
  return JSON.stringify(['DARKZEC/reveal-ack/v1', auctionId, root, commitment, index, acceptedAt]);
}
export function resultStatement(auctionId: string, root: string, digest: string): string {
  validateAuctionId(auctionId);
  if (!HASH.test(root) || !HASH.test(digest)) throw new Error('Invalid result statement.');
  return JSON.stringify(['DARKZEC/result/v1', auctionId, root, digest]);
}

/** Strict parser: the text must be exactly the canonical statement it claims to be. */
export function parseStatement(text: string): ParsedStatement {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Invalid operator statement.'); }
  if (!Array.isArray(value) || typeof value[1] !== 'string') throw new Error('Invalid operator statement.');
  const [tag, auctionId, root] = value as unknown[];
  let parsed: ParsedStatement;
  if (tag === 'DARKZEC/listing/v1' && value.length === 3) {
    if (typeof root !== 'string') throw new Error('Invalid operator statement.');
    parsed = { type: 'listing', auctionId: auctionId as string, digest: root };
    if (listingStatement(parsed.auctionId, root) !== text) throw new Error('Invalid operator statement.');
  } else if (tag === 'DARKZEC/close/v1' && value.length === 6) {
    const [, , , count, closedAt, revealDeadline] = value as unknown[];
    if (typeof root !== 'string' || typeof count !== 'number' || !isTime(closedAt) || !isTime(revealDeadline)) throw new Error('Invalid operator statement.');
    parsed = { type: 'close', auctionId: auctionId as string, root, count, closedAt, revealDeadline };
    if (closeStatement(parsed.auctionId, root, count, closedAt, revealDeadline) !== text) throw new Error('Invalid operator statement.');
  } else if (tag === 'DARKZEC/reveal-ack/v1' && value.length === 6) {
    const [, , , commitment, index, acceptedAt] = value as unknown[];
    if (typeof root !== 'string' || typeof commitment !== 'string' || !isIndex(index) || !isTime(acceptedAt)) throw new Error('Invalid operator statement.');
    parsed = { type: 'reveal-ack', auctionId: auctionId as string, root, commitment, index, acceptedAt };
    if (revealAckStatement(parsed.auctionId, root, commitment, index, acceptedAt) !== text) throw new Error('Invalid operator statement.');
  } else if (tag === 'DARKZEC/result/v1' && value.length === 4) {
    const digest = value[3] as unknown;
    if (typeof root !== 'string' || typeof digest !== 'string') throw new Error('Invalid operator statement.');
    parsed = { type: 'result', auctionId: auctionId as string, root, digest };
    if (resultStatement(parsed.auctionId, root, digest) !== text) throw new Error('Invalid operator statement.');
  } else throw new Error('Invalid operator statement.');
  return Object.freeze(parsed);
}

/** Typed tuple over every published result field, so a digest binds the whole clearing outcome. */
export function canonicalResult(result: ResultSummary): string {
  for (const amount of [result.clearingPrice, result.forfeitedCollateral, result.postedCollateral]) if (formatZec(parseZec(amount)) !== amount) throw new Error('Noncanonical result amount.');
  return JSON.stringify(['DARKZEC/result-body/v1', result.clearingPrice, result.filled, result.excluded, result.forfeitedCollateral, result.postedCollateral,
    result.allocations.map(row => [row.commitment, row.price, row.requested, row.filled, row.paid, row.refundAmount, row.refundAddress])]);
}
export const resultDigest = (result: ResultSummary): Promise<string> => sha256(utf8(canonicalResult(result)));

/**
 * The operator's signed record of an auction: the root it froze at close, every reveal it accepted and the result.
 * A bidder holding an acknowledgement can prove an accepted reveal that a published result later omits.
 */
export class OperatorJournal {
  readonly #signer: OperatorSigner;
  readonly #auctionId: string;
  readonly #statements: SignedStatement[] = [];
  #root: string | undefined;
  #resultSigned = false;
  private constructor(signer: OperatorSigner, auctionId: string) { this.#signer = signer; this.#auctionId = auctionId; }
  static async create(auctionId: string, signer?: OperatorSigner): Promise<OperatorJournal> {
    validateAuctionId(auctionId);
    return new OperatorJournal(signer ?? await createOperatorSigner(), auctionId);
  }
  get publicKey(): string { return this.#signer.publicKey; }
  statements(): readonly SignedStatement[] { return Object.freeze([...this.#statements]); }
  async #append(statement: string): Promise<SignedStatement> {
    const signed = Object.freeze({ statement, signature: await this.#signer.sign(statement) });
    this.#statements.push(signed); return signed;
  }
  async recordListing(digest: string): Promise<SignedStatement> {
    if (this.#root !== undefined || this.#statements.some(item => item.statement.startsWith('["DARKZEC/listing/'))) throw new Error('The listing can be signed once, before close.');
    return this.#append(listingStatement(this.#auctionId, digest));
  }
  async recordClose(root: string, count: number, closedAt: number, revealDeadline: number): Promise<SignedStatement> {
    if (this.#root !== undefined) throw new Error('The close statement is already signed.');
    const statement = closeStatement(this.#auctionId, root, count, closedAt, revealDeadline);
    const signed = await this.#append(statement); this.#root = root; return signed;
  }
  async acknowledgeReveal(commitment: string, index: number, acceptedAt: number): Promise<SignedStatement> {
    if (this.#root === undefined || this.#resultSigned) throw new Error('Reveals can be acknowledged only between close and result.');
    return this.#append(revealAckStatement(this.#auctionId, this.#root, commitment, index, acceptedAt));
  }
  async recordResult(result: ResultSummary): Promise<SignedStatement> {
    if (this.#root === undefined || this.#resultSigned) throw new Error('The result can be signed once, after close.');
    const signed = await this.#append(resultStatement(this.#auctionId, this.#root, await resultDigest(result)));
    this.#resultSigned = true; return signed;
  }
}
