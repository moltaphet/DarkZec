import { parseBidMemo, serializeBidMemo } from '../protocol/memo';
import type { BidMemo } from '../protocol/memo';
import type { Network } from '../protocol/address';

export const RECEIPT_MAX_BYTES = 1024;
export const receiptFilename = (bid: BidMemo, commitment: string): string => `darkzec-receipt-${bid.auctionId}-${commitment.slice(0, 8)}.json`;

/** The receipt file is exactly the canonical reveal JSON, so it can be pasted or imported interchangeably. */
export function receiptText(bid: BidMemo, network: Network): string { return serializeBidMemo(bid, network); }

/** Validates untrusted file text; a receipt is only ever accepted in its canonical form. */
export function parseReceiptText(text: string, network: Network): BidMemo {
  const value = text.trim();
  if (!value) throw new Error('The receipt file is empty.');
  try { return parseBidMemo(value, network); }
  catch { throw new Error('This is not a canonical DarkZec reveal receipt.'); }
}

export async function readReceiptFile(file: File, network: Network): Promise<BidMemo> {
  if (file.size === 0 || file.size > RECEIPT_MAX_BYTES) throw new Error('A reveal receipt is a small JSON file (at most 1 KB).');
  return parseReceiptText(await file.text(), network);
}

/** Starts a browser download of text the user already holds; nothing leaves the device. */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.rel = 'noreferrer'; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
