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
