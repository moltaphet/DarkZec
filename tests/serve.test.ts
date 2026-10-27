import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('preview server build preflight', () => {
  for (const incomplete of [false, true]) {
    it(`exits with actionable CLI guidance when ${incomplete ? 'dist exists without index.html' : 'dist is absent'}`, async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'darkzec-serve-test-'));
      try {
        if (incomplete) await mkdir(join(cwd, 'dist'));
        const result = spawnSync(process.execPath, [resolve('scripts/serve.ts')], { cwd, encoding: 'utf8', timeout: 3000 });
        expect(result.error).toBeUndefined(); expect(result.status).toBe(1);
        expect(result.stderr).toContain('production build is missing or unreadable');
        expect(result.stderr).toContain('npm run build'); expect(result.stderr).toContain('npm run dev');
        expect(result.stderr).not.toMatch(/\bat .+\(/); expect(result.stdout).not.toContain('local terminal:');
      } finally { await rm(cwd, { recursive: true, force: true }); }
    });
  }
});

describe('hosted deployment headers', () => {
  it('serve the same security headers on Vercel as the local server', async () => {
    const { readFile } = await import('node:fs/promises');
    const serve = await readFile('scripts/serve.ts', 'utf8');
    const local = new Map([...serve.matchAll(/response\.setHeader\('([A-Za-z-]+)', ('[^']*'|csp)\)/g)].map(([, key, value]) =>
      [key, value === 'csp' ? /const csp = "([^"]+)"/.exec(serve)?.[1] : value?.slice(1, -1)]));
    // Caching and content type differ by file and host; only the security headers must match.
    local.delete('Cache-Control'); local.delete('Content-Type');
    const vercel = JSON.parse(await readFile('vercel.json', 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
    const hosted = new Map(vercel.headers.find(rule => rule.source === '/(.*)')?.headers.map(({ key, value }) => [key, value]));
    expect(local.size).toBeGreaterThanOrEqual(6);
    expect(hosted).toEqual(local);
    expect(hosted.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });
});
