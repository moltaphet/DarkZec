# Production polish: CI, typography and mobile results

Date: 2026-10-18. This pass supersedes the earlier 11px typography minimum and build/unit-only CI configuration.

## Applied changes and file inventory

All paths below are relative to the repository root.

| Modified file | Change |
| --- | --- |
| `.github/workflows/ci.yml` | Uses `npm ci`; installs Chromium/Linux dependencies; runs build, unit tests and E2E sequentially on Node 22/24. Preserves SHA-pinned actions, read-only permissions and credential cleanup; allows 20 minutes per job. |
| `playwright.config.ts` | Forbids focused tests in CI and caps CI concurrency at two workers. CI starts its own server; local runs can still reuse an existing preview. |
| `index.html` | Uses exact `0.00 ZEC` and `0 Qty` placeholders in both bid forms; adds explicit responsive scrolling utility classes to clearing results. |
| `src/style.css` | Raises all secondary text to at least 12px and primary inputs, auction values, receipts, commitment hashes and result cells to at least 14px. Defines local `max-w-full`/`overflow-x-auto` utilities and preserves focus outlines/mobile scroll hints. |
| `src/components/terminal-effects.css` | Raises labels, canvas overlays and responsive overrides to at least 12px; primary memo payloads, telemetry events and counters use at least 14px. |
| `src/components/LiveTerminalStream.css` | Uses 12px supporting text and 14px event lines/actions; numeric readouts retain their 14px minimum. |
| `src/components/ViewingKeyVault.css` | Uses 12px labels and 14px input/table readouts; action buttons wrap rather than clipping at the larger size. |
| `src/components/ProtocolSpecs.css` | Uses 12px supporting copy and 14px primary titles, including mobile overrides. |
| `src/components/BlindOrderflow.ts` | Uses 12px canvas commitment labels. |
| `src/components/ViewingKeyVault.tsx` | Adds explicit responsive scrolling classes to the private scanner results. |
| `tests/privacy.test.ts` | Tightens the existing CSS/canvas floor from 11px to 12px; preserves network, persistence and type guards. |
| `tests/e2e/targeted-hardening.spec.ts` | Asserts exact placeholders, explicit scroll behavior, 12px labels and 14px primary readouts across five widths. Existing test counts are preserved. |
| `README.md`, `DARKZEC-STANDARD.md`, `docs/engineering-report.md` | Updates the active typography standard, CI steps, required-check guidance and verification results. |

Created: `docs/production-polish-report.md` (this report).

## CI failure handling and main-branch enforcement

Each matrix job runs these commands in order:

```sh
npm ci
npx --no-install playwright install --with-deps chromium
npm run build
npm test
npm run test:e2e
```

The browser installation uses the locally installed, lockfile-pinned Playwright CLI, following [Playwright's CI setup](https://playwright.dev/docs/ci-intro). No step uses `continue-on-error` or bypasses a preceding failure. The E2E script intentionally retains its fresh-build requirement. Focused `.only` tests fail in CI.

To block merges into `main`, [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) must require both matrix checks:

- `Node 22 / build, unit and E2E tests`
- `Node 24 / build, unit and E2E tests`

Require up-to-date branches and restrict direct pushes/bypasses as well. A workflow file cannot itself enforce repository merge permissions. Those remote settings have not been changed, and a GitHub-hosted CI run is not claimed.

## Verification evidence

| Command/check | Observed result |
| --- | --- |
| `npm ci` | Passed: 45 platform packages installed; lockfile unchanged. |
| `npm run build` | Passed: strict TypeScript and 39 production modules. |
| `npm test` | 62/62 tests passed across nine files. |
| `npm run test:e2e -- --config /private/tmp/darkzec-playwright.config.ts` | 30/30 E2E tests passed using cached Chromium. |
| `npm run test:e2e -- --config /private/tmp/darkzec-ci-playwright.config.mts` | 30/30 passed in CI mode, with two workers and managed preview-server startup/cleanup. |
| Responsive checks | No horizontal page overflow at 320, 390, 768, 1280 and 1440px; mobile tables scroll with the keyboard and retain visible hints. |
| Security checks | Mock-only credentials, ciphertext-only session persistence, private event redaction and offline/CSP tests remain passing. |
| CI configuration | YAML command order, Node matrix, immutable action pins and fail-on-error policy validated. CI config imports confirm focused-test rejection and dedicated server ownership. |

The temporary CI config only enables CI mode, selects this machine's cached Chromium and resolves the test/output/server directories relative to the checkout. Maintained source contains no machine-specific browser paths. Desktop/mobile screenshots in ignored `test-results/` were reviewed. No runtime dependency, external font, analytics or application network request was introduced. No commit or push was performed.

Portable local verification:

```sh
npm ci
npx --no-install playwright install --with-deps chromium
npm run build
npm test
npm run test:e2e
npm run dev
```
