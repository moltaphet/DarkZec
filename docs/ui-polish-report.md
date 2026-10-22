# NODE 07 UI/UX polish

> **Historical stage report.** Written before the commit/reveal ledger rewrite and the UI merge: its test counts, commitment/sandbox-encryption wording and Merkle timing may be outdated. See the [engineering report](engineering-report.md) and the README for the current build.

Historical UI stage report. [Phase 2 QA](phase2-qa-report.md) supersedes its canvas ArrowLeft behavior, reset flow, startup shield/address-policy meaning and verification counts. The current engineering report documents the combined Git-enabled checkout.

Implemented all five requested visual interactions in the checked-out DarkZec app. The repository is **Vite + strict TypeScript**, rather than the Next.js/Tailwind stack described in the request. The implementation preserves the working application and protocol and introduces modular DOM components under `src/components/` and shared helpers under `src/lib/`. No dependencies were added.

## Created components and helpers

| Relative path | Integration |
| --- | --- |
| `src/components/NetworkHeader.ts` | Header radar sweep lifecycle, short brand micro-glitch on pointer/focus and hidden-document pause. |
| `src/components/MemoScramble.ts` | Debounced private bid preview, hex stream, gradual Base64url resolution, stale-result rejection and exact prepared-draft reuse. |
| `src/components/BlindOrderflow.ts` | Interactive 2D canvas mesh using public commitment hashes, phosphor pulses, dashed hover streams and keyboard selection. |
| `src/components/ActionRipples.ts` | Delegated pointer/keyboard click ripples on primary buttons; transient layers are capped and removed after animation. |
| `src/components/TelemetryRail.ts` | Collapsible floating policy rail, live memo byte count, CSP-block counter and bounded typewriter log. |
| `src/components/terminal-effects.css` | Matte glass, phosphor borders, glow layers, scanner/glitch/ripple animation, canvas layout and responsive/reduced-motion rules. |
| `src/lib/dom.ts` | Typed element lookup and centralized listener/observer/frame cleanup ownership. |
| `src/lib/motion.ts` | 30fps-capped rAF scheduler with visibility, intersection and reduced-motion handling. |
| `src/lib/blind-mesh.ts` | Deterministic commitment-only node geometry; no price, quantity, memo or address inputs. |

Modified integration files: `index.html`, `src/main.ts`, `tests/e2e/terminal.spec.ts` and `README.md`. Added `tests/e2e/polish.spec.ts`, this report and `docs/superpowers/plans/2026-10-17-terminal-polish.md`. Cryptographic protocol, auction clearing and dependency files are unchanged.

## Five enhancements

1. **Network scanner and branding.** A restrained green beam traverses the header. Hover/focus on DARKZEC triggers a short stepped text glitch, with amber/green slices and neon glow. The “no RPC” and local-session labels remain explicit: this is a visual scanner, not network traffic.
2. **Live memo scramble.** Editing bid price or quantity immediately begins the hex-byte/typewriter effect. After a 220ms debounce, the existing protocol creates a real private draft, validates UTF-8 size and generates unpadded Base64url. A 650ms scramble resolves into that payload. Prepare reuses this exact draft, including its salt. Edits invalidate older pending work, and invalid inputs settle into a clear state without uncaught errors. Commit/close/reset/view changes clear private buffers. The preview explicitly says encoding is readable and that real memo encryption belongs to the wallet.
3. **Blind orderflow canvas.** An orbital mesh displays at most 24 commitment nodes, with subtle drift, phosphor pulses and a blinded central clearing anchor. Hovering highlights a node and connects it to the anchor with an animated dashed stream. Arrow keys inspect nodes and Escape clears selection. With no bids, the mesh is explicitly labeled as an idle simulation. Node positions, sizes, labels and connections never use bid amounts; accessibility text and the ordinary commitment list remain available.
4. **Neon glass and ripples.** Auction, composer, orderbook, audit, result, wallet and telemetry panels use translucent `#050806` surfaces, 12px backdrop blur and phosphor borders. Static shadows on an opacity-animated layer provide a soft pulse. Primary actions produce a localized green radial ripple on pointer or keyboard activation. Focus states remain visible, including the canvas.
5. **Telemetry rail.** Desktop gets a floating right-edge rail. Below 1280px it becomes a collapsed bottom dock; the toggle exposes accurate expanded state and controls. Counters start at `LEAKS BLOCKED: 0`, show the active Orchard-only **address policy**, and report the current memo's actual UTF-8 length out of 512. The event stream uses fixed event names and typewriter rendering. IVK entries are marked `[MOCK]`, and the rail identifies the local/mock feed and absence of a live chain connection. CSP reports from the duplicate HTTP/meta policies are counted once.

## Privacy, accessibility and performance

- No fonts, trackers, icon services, remote images, RPC calls or other external runtime requests were introduced. Inline SVG and system monospace are used. Existing restrictive CSP and zero-request source guard remain intact.
- Only commitments and phase enter the visualizer. Only byte length/state enter the memo counter. Logs accept a fixed `SecurityEvent` union; user input, exceptions, salts, payloads and addresses cannot be passed as log messages.
- No telemetry persistence or background polling. The log is capped at 18 entries and ripples at three layers per button. All frame loops, timers, listeners and observers are cleaned up on page exit.
- Canvas rendering uses a DPR cap of 2 and a 30fps cap, with dimensions cached by ResizeObserver. Hover uses pointer offsets, avoiding layout reads per move. Rendering pauses while offscreen or hidden; typewriter loops stop when settled. CSS ambient animation pauses when the document is hidden.
- Reduced-motion mode skips scrambles/ripples and renders a static canvas/header. Mobile telemetry starts collapsed. Decorative text streams are hidden from screen readers; keyboard alternatives and status text remain available.

## Build and view locally

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4173**. This app's existing dev command builds the production bundle and serves it without an HMR connection. Restart the command after edits, or rebuild while the server is running and refresh the browser.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Where Chromium is already cached, `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome-headless-shell npm run test:e2e` selects it. Verification in this workspace uses the same cached-browser temporary override documented in the original engineering report, outside maintained source.

Browser coverage includes the complete auction/wallet flow, zero external requests, CSP enforcement, exact live-preview/prepared-memo agreement after rapid edits, invalid draft recovery, ripple cleanup, canvas pointer/keyboard selection, mobile telemetry/reset, reduced-motion rendering and responsive screenshots. Screenshots are generated under ignored `test-results/`, including `polished-desktop.png` and `polished-mobile.png`.

Final observed results: **15 unit/privacy tests passed**, strict TypeScript/Vite production build passed, and **9 browser tests passed** using `npm run test:e2e -- --config /private/tmp/darkzec-playwright.config.ts`. `git diff --check` passed. Desktop (1440px) and mobile (390px) previews were visually inspected. A combined shell verification command encountered the macOS browser-launch sandbox restriction; the standalone pre-approved browser-test command completed successfully. The final runtime JavaScript bundle is approximately 17.44 kB gzipped.
