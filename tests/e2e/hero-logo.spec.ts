import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const litPixels = (page: Page): Promise<number> => page.locator('#hero-logo').evaluate((node: HTMLCanvasElement) => {
  const context = node.getContext('2d'); if (!context) return -1;
  const data = context.getImageData(0, 0, node.width, node.height).data; let lit = 0;
  for (let i = 0; i < data.length; i += 4) if ((data[i + 1] ?? 0) > 120 && (data[i] ?? 255) < 120) lit++;
  return lit;
});
const frames = (page: Page): Promise<number> => page.locator('#scene-3d').evaluate(node => Number((node as HTMLCanvasElement).dataset.frames ?? 0));

test('full-page WebGL scene renders, animates and brand text settles back', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#scene-3d')).toHaveAttribute('data-scene', 'webgl');
  await expect(page.locator('html')).toHaveClass(/has-scene/);
  const first = await frames(page); await page.waitForTimeout(1200);
  expect(await frames(page)).toBeGreaterThan(first);
  await page.mouse.wheel(0, 600); await page.waitForTimeout(400);
  await expect(page.locator('.brand-word')).toHaveText('DARKZEC');
  expect(errors).toEqual([]);
});

test('reduced motion renders one static 3D frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#scene-3d')).toHaveAttribute('data-scene', 'webgl');
  const first = await frames(page); await page.waitForTimeout(900);
  expect(await frames(page) - first).toBeLessThanOrEqual(2);
  await expect(page.locator('.brand-word')).toHaveText('DARKZEC');
});

test('without WebGL the flat particle mark takes over', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      return kind === 'webgl' || kind === 'webgl2' ? null : (original as (...args: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/has-scene/);
  await expect(page.locator('#hero-logo')).toBeVisible();
  await page.waitForTimeout(2800);
  expect(await litPixels(page)).toBeGreaterThan(400);
});

test('the scene never causes horizontal overflow on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
