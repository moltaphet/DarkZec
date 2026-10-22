import type { Page } from '@playwright/test';
export async function revealLocalReceipts(page: Page): Promise<void> {
  const button = page.locator('#reveal-all');
  if (await button.isEnabled()) await button.click();
}
