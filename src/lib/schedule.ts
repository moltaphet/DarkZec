/**
 * Auction deadlines are Zcash block heights, not clock times: a commit payment must be mined at or before
 * `commitUntil`, a reveal memo after it and at or before `revealUntil`. The operator cannot move them, and anyone
 * with the vault's viewing key can check every payment's height. Block time on testnet is 25 seconds (NU7).
 */
export interface Schedule { readonly commitUntil: number; readonly revealUntil: number }
export const BLOCK_SECONDS = 25;
/** Chain time: the ledger's clock for a scheduled auction counts blocks, one height = one block of milliseconds. */
export const BLOCK_MS = BLOCK_SECONDS * 1000;
const MAX_HEIGHT = 100_000_000;
const isHeight = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 280_000 && (value as number) <= MAX_HEIGHT;

export function validateSchedule(value: unknown): Schedule {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'commitUntil,revealUntil') throw new Error('Invalid auction schedule.');
  const { commitUntil, revealUntil } = value as Record<string, unknown>;
  if (!isHeight(commitUntil) || !isHeight(revealUntil)) throw new Error('Schedule deadlines must be block heights.');
  if (revealUntil <= commitUntil) throw new Error('The reveal deadline must come after the commit deadline.');
  return Object.freeze({ commitUntil, revealUntil });
}
/** Ledger time at which each phase starts and ends. Both ends are exclusive of the next block, so a deadline block still counts. */
export const chainTime = (height: number): number => height * BLOCK_MS;
export const closeTime = (schedule: Schedule): number => chainTime(schedule.commitUntil + 1);
export const revealEndTime = (schedule: Schedule): number => chainTime(schedule.revealUntil + 1);
export const blocksFor = (minutes: number): number => Math.max(1, Math.ceil(minutes * 60 / BLOCK_SECONDS));

/** Phase of a mined payment: a commit must land before the close, a reveal inside the window after it. */
export function commitOnTime(schedule: Schedule, height: number): boolean { return height <= schedule.commitUntil; }
export function revealOnTime(schedule: Schedule, height: number): boolean { return height > schedule.commitUntil && height <= schedule.revealUntil; }

/** A visitor's browser has no chain access, so countdowns estimate the tip from the listing's anchor; they are never authoritative. */
export interface Anchor { readonly height: number; readonly time: number }
export const estimateHeight = (anchor: Anchor, nowMs: number): number => anchor.height + Math.max(0, Math.floor((nowMs / 1000 - anchor.time) / BLOCK_SECONDS));
export function describeBlocks(blocks: number): string {
  const seconds = Math.max(0, blocks) * BLOCK_SECONDS;
  if (seconds < 90) return `${seconds} seconds`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172_800) return `${Math.round(seconds / 360) / 10} hours`;
  return `${Math.round(seconds / 8640) / 10} days`;
}
