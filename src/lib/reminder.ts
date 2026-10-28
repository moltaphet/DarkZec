import type { Listing } from './listing';
import { BLOCK_SECONDS } from './schedule';

/**
 * Calendar reminders for a bidder: an unrevealed bid loses its collateral, and the deadlines are block heights that only the
 * chain can confirm. The times are therefore estimates from the listing's anchor, and every event says so. The file is built and
 * downloaded in the browser; nothing is sent anywhere.
 */
const stamp = (seconds: number): string => new Date(seconds * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const escapeText = (value: string): string => value.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line: string): string => { const parts: string[] = []; let rest = line; while (rest.length > 74) { parts.push(rest.slice(0, 74)); rest = ` ${rest.slice(74)}`; } parts.push(rest); return parts.join('\r\n'); };

export function estimatedTime(listing: Listing, height: number): number {
  return listing.schedule.anchorTime + (height - listing.schedule.anchorHeight) * BLOCK_SECONDS;
}
export function buildReminders(listing: Listing, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const { title, auction, schedule } = listing;
  const events: readonly { readonly uid: string; readonly summary: string; readonly start: number; readonly note: string; readonly alarms: readonly number[] }[] = [
    { uid: 'commit', summary: `Bidding closes: ${title}`, start: estimatedTime(listing, schedule.commitUntil),
      note: `Your collateral payment must be mined by block ${schedule.commitUntil}. Payments can take many blocks to confirm, so pay early. After this block, send your reveal.`, alarms: [60, 15] },
    { uid: 'reveal', summary: `REVEAL YOUR BID before it closes: ${title}`, start: estimatedTime(listing, schedule.revealUntil),
      note: `Send your reveal (a tiny payment whose memo is your receipt) so it is mined by block ${schedule.revealUntil}. A bid that is not revealed loses its ${auction.collateral} ZEC collateral.`, alarms: [60, 20, 5] },
  ];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DarkZec//Auction reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const event of events) {
    lines.push('BEGIN:VEVENT', `UID:${auction.auctionId}-${event.uid}@darkzec`, `DTSTAMP:${stamp(nowSeconds)}`, `DTSTART:${stamp(event.start)}`, `DTEND:${stamp(event.start + 900)}`,
      `SUMMARY:${escapeText(event.summary)}`, `DESCRIPTION:${escapeText(`${event.note} Estimated time: the blocks decide, not this clock. Auction ${auction.auctionId}.`)}`);
    for (const minutes of event.alarms) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(event.summary)}`, `TRIGGER:-PT${minutes}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
