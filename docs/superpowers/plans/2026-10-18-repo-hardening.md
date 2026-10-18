# Comprehensive Repository Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revalidate all requested controls, fix residual entire-supply self-pricing and runtime type coercion, regenerate official dependency resolution and report fresh verification.

**Architecture:** Retain the versioned refund-bound commitment, accepted-order ties, Orchard-only payment projection and local UI. Extend the existing pure clearing engine without adding a duplicate URI module or weakening established domain separation.

**Tech Stack:** Strict TypeScript, Web Crypto, npm lockfile v3, Vite, Vitest and Playwright.

## Global constraints

- Zero application network requests and no new dependencies.
- UA binding does not make salts ungrindable; tie priority must remain independent of hash values.
- Keep unambiguous commitment framing and auction context rather than unsafe raw concatenation.
- Preserve earlier uncommitted work; record actual counts rather than stale 15/9/29 targets.

### Task 1: Reproduce and fix residual edge cases

Files: `src/lib/darkpool.ts`, `src/protocol/crypto.ts`, `tests/darkpool.test.ts`, `tests/security-core.test.ts`, `tests/e2e/security.spec.ts`.

- [x] Add a regression: supply 10, winning limit 0.90/quantity 11, competitors 0.75/quantity 5 and 0.60/quantity 3; expect 0.75, not 0.90.
- [x] Add runtime tests rejecting numeric strings for quantity and supply, plus non-string auction/price/salt fields at the commitment boundary.
- [x] Confirm the new tests fail before implementation.
- [x] When one envelope wins the whole supply, exclude its own unfilled lots from the competing margin; retain reserve and multi-winner partial-margin rules.
- [x] Validate runtime types before coercion in public commitment and clearing APIs, without introducing `any`.
- [x] Add a complete terminal regression: demo competitors plus 0.90/11 user bid clears at the competing 0.74.

### Task 2: Recreate and clean-install official dependencies

Files: `.npmrc`, `package-lock.json`; verify existing `package.json` scripts and `scripts/serve.ts` behavior.

- [x] Back up the current official lockfile and dependency tree outside the repo, then remove both from resolution.
- [x] Recreate the lock with `npm install --package-lock-only --offline --ignore-scripts --registry=https://registry.npmjs.org --cache=/private/tmp/darkzec-phase1-npm --no-audit --no-fund`, using the previously verified official registry cache.
- [x] Verify all artifact origins/integrities and unchanged package versions. Run clean `npm ci` from that official cache with lifecycle scripts disabled.
- [x] Retain fresh-build-first E2E, friendly missing-build CLI, strict typing and current Node engine compatibility; existing tests must remain enabled.

### Task 3: Verification and reporting

Files: `DARKZEC-STANDARD.md`, `src/components/ProtocolSpecs.ts`, `index.html`, `README.md`, `docs/engineering-report.md`, `docs/repo-hardening-report.md`.

- [x] Update clearing policy everywhere and produce a finding-by-finding A1/B1/B2/B3/B6/D1–D4 audit with existing-versus-new file changes.
- [x] Run `npm test`, `npm run build` and the complete fresh-build E2E script. Recheck unit/build compatibility on available Node 22.18.0 and 24.0.0 runtimes.
- [x] Verify Markdown/links, lockfile consistency and `git diff --check`. Report exact results and remaining prototype trust boundaries without claiming production certification.

Verified on the recreated official dependency tree: 58 unit/privacy/CLI tests, strict 39-module build and 27 E2E scenarios passed. Node 22.18.0 and 24.0.0 each passed the same 58 tests and strict build. Three residual regression groups reproduced before implementation. Markdown/local links, lock/manifest consistency and whitespace checks passed.
