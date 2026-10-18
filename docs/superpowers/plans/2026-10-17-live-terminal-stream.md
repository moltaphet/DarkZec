# Live terminal security stream — Step 2

Goal: add a dedicated timestamped terminal stream and unify it with the existing telemetry rail using bounded, memory-only structured events.

Design: matte #050806 panels, 1px #00FF66 borders, local monospace, UTC timestamps, category labels and progressive typewriter text. Full-width stream follows the active workspace; the floating rail displays a compact projection of the same model. Keep payloads private and all network observation passive.

- [x] Add a typed event store with immutable snapshots, fixed messages, validated numeric metadata, bounded history, timestamps and subscriber cleanup.
- [x] Add `LiveTerminalStream.tsx` and styling with shared counters, memo-capacity meter, pause/resume, clear, reduced-motion support and bounded rendering.
- [x] Refactor the floating rail onto the same model and move CSP observation into one lifecycle-owned monitor.
- [x] Instrument actual URI/memo/commitment preparation, vault save/unlock/scan results and existing mock auction controls. Never emit keys, salts, bid values, payloads, addresses, raw exceptions or blocked URLs.
- [x] Verify event sequencing/redaction, nonintrusive observers, failed decryption, shared counters, retained CSP block counts, bounded logs, no external requests and responsive screenshots; update documentation and report final checks.

Network text describes the configured CSP guard and observed violations, not device-wide leak detection. Orchard ACTIVE means address policy validated; mock chain operations are explicitly marked. No logging persistence, background polling, network API monkeypatching or new dependencies.

Verification: 35 unit/privacy tests, strict TypeScript/Vite build, 17 browser tests and `git diff --check` passed. Desktop and 390px mobile screenshots visually inspected. Details in `docs/live-terminal-report.md`.
