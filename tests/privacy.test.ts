import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? sources(join(directory, entry.name)) : Promise.resolve([join(directory, entry.name)])));
  return nested.flat();
}

describe('application privacy regression guard', () => {
  it('keeps network, persistence, trackers and unsafe HTML sinks out of application sources', async () => {
    for (const filename of await sources('src')) {
      const source = await readFile(filename, 'utf8');
      expect(source, filename).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|indexedDB|sendBeacon)\b/);
      // User-authorized exception: only this adapter may persist an encrypted viewing-key record.
      if (filename !== join('src', 'lib', 'viewing-key-session.ts')) expect(source, filename).not.toMatch(/\bsessionStorage\b/);
      expect(source, filename).not.toMatch(/(?:innerHTML|outerHTML|insertAdjacentHTML|document\.cookie|console\.|https?:\/\/|@import|\bany\b)/);
    }
    const html = await readFile('index.html', 'utf8');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("font-src 'none'");
    expect(html).not.toMatch(/https?:\/\//);
  });
});
