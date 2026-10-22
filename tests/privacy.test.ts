import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_VIEWING_KEY, ViewingKeySession } from '../src/lib/viewing-key-session';

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
      // Only this adapter may persist encrypted mock credentials; real keys must be rejected.
      if (filename !== join('src', 'lib', 'viewing-key-session.ts')) expect(source, filename).not.toMatch(/\bsessionStorage\b/);
      expect(source, filename).not.toMatch(/(?:innerHTML|outerHTML|insertAdjacentHTML|document\.cookie|console\.|https?:\/\/|@import|\bany\b)/);
    }
    const html = await readFile('index.html', 'utf8');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("font-src 'none'");
    expect(html).not.toMatch(/https?:\/\//);
  });
  it('rejects non-mock credentials before touching the sole session storage boundary', async () => {
    const touched: string[] = [];
    const session = new ViewingKeySession({
      getItem: () => { touched.push('read'); return null; },
      setItem: () => { touched.push('write'); },
      removeItem: () => { touched.push('remove'); },
    });
    for (const key of ['uview1' + 'q'.repeat(200), 'uviewtest1' + 'q'.repeat(200), 'secret-spending-key', DEMO_VIEWING_KEY + '\n']) {
      await expect(session.save(key, 'correct-local-passphrase')).rejects.toThrow('Mock keys only');
    }
    expect(touched).toEqual([]);
  });
  it('keeps CSS and canvas text at or above twelve pixels', async () => {
    for (const filename of await sources('src')) {
      const source = await readFile(filename, 'utf8');
      const pattern = filename.endsWith('.css') ? /font(?:-size)?\s*:\s*([\d.]+)px/g : /\.font\s*=\s*['"]([\d.]+)px/g;
      for (const match of source.matchAll(pattern)) expect(Number(match[1]), `${filename}: ${match[0]}`).toBeGreaterThanOrEqual(12);
    }
  });
});
