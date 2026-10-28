import { base64urlnopad } from '@scure/base';
import { orchardPaymentAddress } from '../protocol/address';
import { formatZec, parseQuantity, parseZec, validateAuctionId } from '../protocol/amount';
import { sha256, utf8 } from '../protocol/crypto';
import { COLLATERAL_TIERS } from '../protocol/memo';
import { listingStatement, verifyStatement } from './operator-journal';
import { validateSchedule } from './schedule';
import type { Schedule } from './schedule';

/**
 * A shareable auction: what is for sale, the rules, the vault to pay and the block-height deadlines, signed by the
 * operator's session key. The whole listing travels inside the link's fragment, which a browser never sends to a server,
 * so the public site needs no database and learns nothing about who opens which auction.
 */
export interface Listing {
  readonly v: 1;
  readonly title: string;
  readonly description: string;
  readonly auction: {
    readonly auctionId: string; readonly network: 'testnet'; readonly vault: string; readonly supply: number; readonly reserve: string;
    readonly collateral: string; readonly unitDemand: boolean; readonly procurement: boolean;
  };
  readonly schedule: Schedule & { readonly anchorHeight: number; readonly anchorTime: number };
}
export interface SignedListing { readonly listing: Listing; readonly publicKey: string; readonly signature: string }
export interface OpenedListing extends SignedListing { readonly digest: string }

export const LISTING_TITLE_MAX = 80;
export const LISTING_DESCRIPTION_MAX = 600;
const LINK_PREFIX = '#/a/';
const LINK_MAX = 8000;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const keysAre = (value: object, expected: string): boolean => Object.keys(value).sort().join(',') === expected;

/** Strict structural and semantic validation; throws a readable error on anything unexpected. */
export function parseListing(value: unknown): Listing {
  const fail = (message = 'This is not a valid DarkZec auction listing.'): never => { throw new Error(message); };
  if (!isRecord(value) || !keysAre(value, 'auction,description,schedule,title,v') || value.v !== 1) return fail();
  const { title, description, auction, schedule } = value;
  if (typeof title !== 'string' || title.trim() !== title || title.length < 1 || title.length > LISTING_TITLE_MAX || CONTROL.test(title)) return fail(`The title must be 1–${LISTING_TITLE_MAX} characters on one line.`);
  if (typeof description !== 'string' || description.length > LISTING_DESCRIPTION_MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/.test(description)) return fail(`The description is at most ${LISTING_DESCRIPTION_MAX} characters.`);
  if (!isRecord(auction) || !keysAre(auction, 'auctionId,collateral,network,procurement,reserve,supply,unitDemand,vault')) return fail();
  const { auctionId, network, vault, supply, reserve, collateral, unitDemand, procurement } = auction;
  if (typeof auctionId !== 'string' || network !== 'testnet' || typeof vault !== 'string' || typeof supply !== 'number' || typeof reserve !== 'string' ||
    typeof collateral !== 'string' || typeof unitDemand !== 'boolean' || typeof procurement !== 'boolean') return fail();
  validateAuctionId(auctionId); parseQuantity(String(supply));
  if (supply > 100 || parseZec(reserve) === 0n || formatZec(parseZec(reserve)) !== reserve) return fail('The reserve must be a positive ZEC amount.');
  if (!COLLATERAL_TIERS.includes(collateral)) return fail('The collateral must be 0.1, 1, 10 or 100 ZEC.');
  if (orchardPaymentAddress(vault, 'testnet') !== vault) return fail('The vault must be an Orchard-only testnet Unified Address.');
  if (procurement && !unitDemand) return fail('A procurement auction is always unit demand.');
  if (!isRecord(schedule) || !keysAre(schedule, 'anchorHeight,anchorTime,commitUntil,revealUntil')) return fail();
  const { anchorHeight, anchorTime, commitUntil, revealUntil } = schedule;
  const checked = validateSchedule({ commitUntil, revealUntil });
  if (!Number.isSafeInteger(anchorHeight) || !Number.isSafeInteger(anchorTime) || (anchorHeight as number) < 280_000 || (anchorHeight as number) > checked.commitUntil || (anchorTime as number) < 1_600_000_000 || (anchorTime as number) > 4_000_000_000) return fail('The listing anchor is invalid.');
  return Object.freeze({ v: 1, title, description, auction: Object.freeze({ auctionId, network, vault, supply, reserve, collateral, unitDemand, procurement }),
    schedule: Object.freeze({ ...checked, anchorHeight: anchorHeight as number, anchorTime: anchorTime as number }) });
}

/** Typed tuple over every field, so the signed digest binds the whole public promise. */
export function canonicalListing(listing: Listing): string {
  const { auction, schedule } = listing;
  return JSON.stringify(['DARKZEC/listing-body/v1', listing.title, listing.description, auction.auctionId, auction.network, auction.vault, auction.supply, auction.reserve,
    auction.collateral, auction.unitDemand, auction.procurement, schedule.commitUntil, schedule.revealUntil, schedule.anchorHeight, schedule.anchorTime]);
}
export const listingDigest = (listing: Listing): Promise<string> => sha256(utf8(canonicalListing(listing)));

/** The fragment that carries a signed listing. */
export function encodeListingLink(signed: SignedListing): string {
  const payload = base64urlnopad.encode(utf8(JSON.stringify({ l: signed.listing, k: signed.publicKey, s: signed.signature })));
  if (payload.length > LINK_MAX) throw new Error('The listing is too large to share as a link.');
  return `${LINK_PREFIX}${payload}`;
}
export const isListingLink = (hash: string): boolean => hash.startsWith(LINK_PREFIX);

/** Decodes a link and verifies the operator's signature over it. Throws when the link is malformed or the signature is wrong. */
export async function openListingLink(hash: string): Promise<OpenedListing> {
  const bad = (): never => { throw new Error('This auction link is damaged or was not issued by a DarkZec operator.'); };
  if (!hash.startsWith(LINK_PREFIX) || hash.length > LINK_MAX + LINK_PREFIX.length) return bad();
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(base64urlnopad.decode(hash.slice(LINK_PREFIX.length)))); } catch { return bad(); }
  if (!isRecord(decoded) || !keysAre(decoded, 'k,l,s') || typeof decoded.k !== 'string' || typeof decoded.s !== 'string') return bad();
  let listing: Listing;
  try { listing = parseListing(decoded.l); } catch { return bad(); }
  const digest = await listingDigest(listing);
  const statement = listingStatement(listing.auction.auctionId, digest);
  if (!await verifyStatement(decoded.k, { statement, signature: decoded.s })) return bad();
  return Object.freeze({ listing, publicKey: decoded.k, signature: decoded.s, digest });
}
