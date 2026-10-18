import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
describe('official npm dependency resolution', () => {
  it('pins registry artifacts to official npm with integrity and rejects mirror metadata', async () => {
    const source = await readFile('package-lock.json', 'utf8'); const lock: unknown = JSON.parse(source);
    if (!object(lock) || !object(lock.packages)) throw new Error('Invalid lockfile packages');
    expect(lock.lockfileVersion).toBe(3);
    const packages = Object.entries(lock.packages).filter(([path]) => path !== ''); expect(packages.length).toBeGreaterThan(0);
    for (const [path, value] of packages) {
      if (!object(value) || typeof value.resolved !== 'string') throw new Error(`Missing registry artifact: ${path}`);
      const resolved = new URL(value.resolved);
      expect(resolved.origin, path).toBe('https://registry.npmjs.org');
      expect(resolved.username, path).toBe(''); expect(resolved.password, path).toBe('');
      expect(value.integrity, path).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/);
    }
    expect(source).not.toMatch(/npmmirror|yarnpkg|registry\.npm\.taobao/);
    expect((await readFile('.npmrc', 'utf8')).trim()).toBe('registry=https://registry.npmjs.org/');
  });
});
