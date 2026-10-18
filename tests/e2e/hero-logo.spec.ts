import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const litPixels = (page: Page): Promise<number> => page.locator('#hero-logo').evaluate((node: HTMLCanvasElement) => {
  const context = node.getContext('2d'); if (!context) return -1;
  const data = context.getImageData(0, 0, node.width, node.height).data; let lit = 0;
  for (let i = 0; i < data.length; i += 4) if ((data[i + 1] ?? 0) > 120 && (data[i] ?? 255) < 120) lit++;
  return lit;
});

test('hero mark assembles into a green particle logo and brand text settles back', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#hero-logo')).toBeVisible();
  await page.waitForTimeout(2800);
  expect(await litPixels(page)).toBeGreaterThan(400);
  await expect(page.locator('.brand-word')).toHaveText('DARKZEC');
  expect(errors).toEqual([]);
});

test('reduced motion renders one finished static pose', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForTimeout(300);
  const first = await litPixels(page);
  expect(first).toBeGreaterThan(400);
  await page.waitForTimeout(800);
  expect(await litPixels(page)).toBe(first);
  await expect(page.locator('.brand-word')).toHaveText('DARKZEC');
});

test('hero mark stays within the page on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await page.locator('#hero-logo').boundingBox();
  expect(box && box.width > 200 && box.width <= 320).toBe(true);
});
