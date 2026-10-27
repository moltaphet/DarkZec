import { encode } from 'uqr';
import type { QrCodeGenerateResult } from 'uqr';

/** Pixels per QR module on the backing canvas; CSS scales it down without smoothing. */
const MODULE_PX = 8;

export const encodePaymentQr = (uri: string): QrCodeGenerateResult => encode(uri, { ecc: 'M', border: 4 });

/**
 * Draws a ZIP-321 request as a QR code in this browser, so the URI never reaches an image service.
 * Dark modules sit on a light quiet zone, which phone wallets scan reliably off a dark page.
 */
export function paymentQrCanvas(uri: string, label: string): HTMLCanvasElement {
  const qr = encodePaymentQr(uri);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = qr.size * MODULE_PX;
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', label); canvas.dataset.version = String(qr.version);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw the QR code. Copy the request or use Open in wallet instead.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#000';
  qr.data.forEach((row, y) => row.forEach((dark, x) => { if (dark) context.fillRect(x * MODULE_PX, y * MODULE_PX, MODULE_PX, MODULE_PX); }));
  return canvas;
}

/** Shows the QR only while its request may be paid; an empty URI hides and clears it. */
export class PaymentQr {
  readonly #host: HTMLElement;
  readonly #label: string;
  #uri = '';
  constructor(host: HTMLElement, label: string) { this.#host = host; this.#label = label; }
  show(uri: string): void {
    if (uri === this.#uri) return;
    this.#uri = uri;
    this.#host.querySelector('canvas')?.remove();
    if (uri) this.#host.prepend(paymentQrCanvas(uri, this.#label));
    this.#host.hidden = uri === '';
  }
}
