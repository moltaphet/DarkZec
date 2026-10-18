import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';
import { motionLoop } from '../lib/motion';

interface Particle {
  readonly x: number; readonly y: number; readonly z: number;
  readonly sx: number; readonly sy: number; readonly sz: number;
  readonly delay: number; readonly size: number; readonly tone: 0 | 1 | 2;
}

/** Deterministic generator: the mark has one stable shape and a repeatable assembly. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

type Stroke = readonly [number, number, number, number];
const GLYPH: readonly Stroke[] = [[-0.55, 0.8, 0.55, 0.8], [0.55, 0.8, -0.55, -0.8], [-0.55, -0.8, 0.55, -0.8]];
const BRACKETS: readonly Stroke[] = [
  [-1.15, -0.95, -1.15, 0.95], [-1.15, 0.95, -0.95, 0.95], [-1.15, -0.95, -0.95, -0.95],
  [1.15, -0.95, 1.15, 0.95], [1.15, 0.95, 0.95, 0.95], [1.15, -0.95, 0.95, -0.95],
];

/** The DarkZec mark as a point cloud: a bold Z flanked by two brackets, echoing the [ Z ] brand. */
export function buildLogoParticles(): readonly Particle[] {
  const random = mulberry32(0x07da12);
  const particles: Particle[] = [];
  const sample = (strokes: readonly Stroke[], count: number, thickness: number, depth: number, centre: boolean): void => {
    const lengths = strokes.map(([x1, y1, x2, y2]) => Math.hypot(x2 - x1, y2 - y1));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    strokes.forEach(([x1, y1, x2, y2], index) => {
      const share = Math.round(count * (lengths[index] ?? 0) / total);
      const length = lengths[index] ?? 1;
      const nx = -(y2 - y1) / length; const ny = (x2 - x1) / length;
      for (let i = 0; i < share; i++) {
        const t = random(); const offset = (random() * 2 - 1) * thickness;
        const x = x1 + (x2 - x1) * t + nx * offset; const y = y1 + (y2 - y1) * t + ny * offset;
        const z = (random() * 2 - 1) * depth;
        const radius = 2.2 + random() * 1.6; const theta = random() * Math.PI * 2; const phi = Math.acos(random() * 2 - 1);
        const spark = centre && random() < 0.08;
        particles.push({ x, y, z, sx: radius * Math.sin(phi) * Math.cos(theta), sy: radius * Math.sin(phi) * Math.sin(theta), sz: radius * Math.cos(phi),
          delay: 0.1 + random() * 0.9, size: spark ? 1.7 : 0.9 + random() * 0.7, tone: spark ? 2 : centre ? 0 : 1 });
      }
    });
  };
  sample(GLYPH, 1600, 0.12, 0.11, true);
  sample(BRACKETS, 420, 0.045, 0.07, false);
  return particles;
}

const TONES = ['#00ff66', '#2fbf71', '#d6ffe6'] as const;

/** Floating, swaying particle mark. Assembles once on load; a reduced-motion render is the finished static pose. */
export function mountHeroLogo(canvas: HTMLCanvasElement): Disposable {
  const lifetime = new Lifetime();
  const context = canvas.getContext('2d');
  const particles = buildLogoParticles();
  let width = 440; let height = 320; let started = -1; let pointerX = 0; let pointerY = 0; let smoothX = 0; let smoothY = 0;
  const resize = new ResizeObserver(entries => {
    const bounds = entries[0]?.contentRect; if (!bounds || bounds.width < 1 || bounds.height < 1) return;
    width = bounds.width; height = bounds.height;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0); loop.invalidate();
  });
  resize.observe(canvas);
  document.addEventListener('pointermove', event => {
    pointerX = (event.clientX / innerWidth - 0.5) * 2; pointerY = (event.clientY / innerHeight - 0.5) * 2;
  }, { passive: true, signal: lifetime.signal });

  const draw = (time: number, reduced: boolean): void => {
    if (!context) return;
    if (started < 0) started = time;
    const t = reduced ? 0 : (time - started) / 1000;
    smoothX += (pointerX - smoothX) * 0.06; smoothY += (pointerY - smoothY) * 0.06;
    const ry = reduced ? 0.22 : Math.sin(t * 0.33) * 0.5 + smoothX * 0.22;
    const rz = reduced ? 0 : Math.sin(t * 0.47 + 1) * 0.14;
    const rx = reduced ? 0 : Math.sin(t * 0.4 + 2) * 0.12 + smoothY * 0.1;
    const bob = reduced ? 0 : Math.sin(t * 0.8) * 0.06;
    const cy = Math.cos(ry); const sy = Math.sin(ry); const cz = Math.cos(rz); const sz = Math.sin(rz); const cx = Math.cos(rx); const sx = Math.sin(rx);
    const scale = Math.min(width / 3.4, height / 2.5); const camera = 4.4;
    context.clearRect(0, 0, width, height);
    const glow = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.min(width, height) * 0.5);
    glow.addColorStop(0, 'rgb(0 255 102 / 16%)'); glow.addColorStop(1, 'rgb(0 255 102 / 0%)');
    context.fillStyle = glow; context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'lighter';
    for (const particle of particles) {
      const progress = reduced ? 1 : Math.min(1, Math.max(0, (t - particle.delay) / 1.4));
      const ease = 1 - (1 - progress) ** 3;
      const px = particle.sx + (particle.x - particle.sx) * ease; const py = particle.sy + (particle.y - particle.sy) * ease; const pz = particle.sz + (particle.z - particle.sz) * ease;
      const x1 = px * cz - py * sz; const y1 = px * sz + py * cz;
      const y2 = y1 * cx - pz * sx; const z2 = y1 * sx + pz * cx;
      const x3 = x1 * cy + z2 * sy; const z3 = -x1 * sy + z2 * cy;
      const depth = camera / (camera - z3); const screenX = width / 2 + x3 * scale * depth; const screenY = height / 2 - (y2 + bob) * scale * depth;
      const alpha = Math.min(1, Math.max(0.18, 0.55 + z3 * 0.38)) * (0.25 + 0.75 * ease);
      const size = Math.max(1, particle.size * depth * 1.5);
      context.globalAlpha = alpha; context.fillStyle = TONES[particle.tone];
      context.fillRect(screenX - size / 2, screenY - size / 2, size, size);
    }
    context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
  };
  const loop = motionLoop(canvas, draw);
  lifetime.own(() => resize.disconnect()); lifetime.own(() => loop.destroy());
  return { destroy() { lifetime.destroy(); context?.clearRect(0, 0, width, height); } };
}
