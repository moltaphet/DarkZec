export const ZATOSHIS = 100_000_000n;
export const MAX_MONEY = 21_000_000n * ZATOSHIS;

/** Exact decimal arithmetic; no floating-point conversion anywhere in escrow accounting. */
export function parseZec(value: string): bigint {
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,8})?$/.test(value)) throw new Error('Enter a ZEC amount with at most 8 decimal places and no leading zeros.');
  const [whole = '', fraction = ''] = value.split('.');
  const amount = BigInt(whole) * ZATOSHIS + BigInt(fraction.padEnd(8, '0'));
  if (amount > MAX_MONEY) throw new Error('Amount exceeds the ZEC monetary limit.');
  return amount;
}

export function formatZec(amount: bigint): string {
  if (amount < 0n || amount > MAX_MONEY) throw new Error('Amount is outside the ZEC monetary range.');
  const fraction = (amount % ZATOSHIS).toString().padStart(8, '0').replace(/0+$/, '');
  return `${amount / ZATOSHIS}${fraction ? `.${fraction}` : ''}`;
}

export function parseQuantity(value: string): number {
  if (!/^[1-9]\d{0,5}$/.test(value)) throw new Error('Quantity must be a whole number from 1 to 999999.');
  return Number(value);
}

export function validateAuctionId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(value)) throw new Error('Auction ID must contain 1–48 letters, digits, underscores or hyphens.');
  return value;
}
