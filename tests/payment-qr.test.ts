import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { encodePaymentQr } from '../src/components/PaymentQr';
import { FIXTURE_ADDRESS } from '../src/fixtures';
import { buildPaymentUri } from '../src/protocol/memo';

/** Rasterizes the module matrix the way a phone camera sees it, then decodes it with an independent reader. */
function scan(uri: string): string | undefined {
  const qr = encodePaymentQr(uri); const scale = 4; const side = qr.size * scale;
  const pixels = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const value = qr.data[Math.floor(y / scale)]?.[Math.floor(x / scale)] ? 0 : 255; const offset = (y * side + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value; pixels[offset + 3] = 255;
  }
  return jsQR(pixels, side, side)?.data;
}

describe('payment QR codes', () => {
  it('decode back to the exact commit request', () => {
    const uri = buildPaymentUri({ address: FIXTURE_ADDRESS, amount: '10', memo: JSON.stringify({ v: 2, t: 'commit', a: 'NODE07-001', c: 'ab'.repeat(32) }), network: 'testnet' });
    expect(scan(uri)).toBe(uri);
  });
  it('still decode a reveal request carrying a near-full 512-byte memo', () => {
    const uri = buildPaymentUri({ address: FIXTURE_ADDRESS, amount: '0.0001', memo: 'x'.repeat(500), network: 'testnet' });
    expect(uri.length).toBeGreaterThan(700);
    expect(scan(uri)).toBe(uri);
  });
});
