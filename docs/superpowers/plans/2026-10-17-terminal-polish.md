# NODE 07 terminal polish

Goal: deliver the five requested interaction upgrades within the existing Vite/TypeScript checkout, preserving the tested auction and wallet flows. The framework mismatch has been raised with the user; no migration is required to deliver the visual changes.

Architecture: independent DOM components under `src/components/`, shared typed lifecycle and mesh helpers under `src/lib/`, existing protocol unchanged. Components return explicit cleanup methods and never own network or persistence code.

Design: #050806 matte glass, #00FF66 phosphor, #ffce73 amber, #8caa98 secondary data, #263a2c mesh. Local monospace throughout, larger brand/hero, precise small instrument labels. The signature is a commitment-only orbital mesh pointing to a blinded central clearing anchor. Private composer left, orderflow right, floating telemetry at the edge; telemetry becomes a collapsible dock on smaller screens. Header sweep, micro-glitch and button ripples support this hierarchy without obscuring controls.

- [x] Build reusable animation scheduling, deterministic commitment-only mesh geometry and typed DOM helpers.
- [x] Add scanner/glitch, private live memo scramble, interactive canvas orderflow, ripple buttons and a collapsible telemetry feed.
- [x] Integrate input/preparation/commit/close/clear/audit/reset and wallet events without logging payloads or changing escrow math. Live preview and final prepared memo must agree; stale async drafts must be discarded.
- [x] Apply matte glass and responsive visual hierarchy across all panels. Respect reduced motion and document visibility, stop offscreen canvas work, bound event log/node counts and clean up listeners/frames.
- [x] Run protocol/privacy tests, strict production build and browser checks for live memo accuracy, rapid edits, canvas hover/keyboard interaction, telemetry collapse, reduced motion, reset cleanup, complete auction flow and zero outbound requests. Inspect desktop/mobile screenshots. Document created files and local run commands.
