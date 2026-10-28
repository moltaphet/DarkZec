import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';
import { lookAt, model, multiply, perspective, projectToScreen } from '../lib/mat4';
import type { Mat4 } from '../lib/mat4';
import { buildLogoParticles } from './HeroLogo';

const RING_Y = 2;
const VERTEX = `
attribute vec3 aPos;
attribute float aSeed;
uniform mat4 uMvp;
uniform mat4 uView;
uniform float uTime;
uniform float uBuild;
uniform float uMode;
uniform float uSize;
uniform float uPixel;
uniform float uSpin;
varying float vFade;
varying float vSeed;
varying float vBoost;
varying float vTwinkle;
float hash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
void main() {
  vec3 p = aPos;
  float boost = 1.0;
  float twinkle = 1.0;
  float sizeScale = 1.0;
  vec2 c = p.xy - vec2(0.0, ${RING_Y.toFixed(1)});
  if (uMode > 1.5 && uMode < 2.5) {
    float base = atan(c.y, c.x);
    float r = length(c) + sin(uTime * 1.4 + aSeed * 30.0) * 0.035;
    float a = base + uTime * 0.12;
    p.xy = vec2(0.0, ${RING_Y.toFixed(1)}) + r * vec2(cos(a), sin(a));
    p.z += sin(uTime * 0.9 + aSeed * 20.0) * 0.05;
    boost = 0.62 + 0.38 * sin(base * 2.0 - uTime * 0.9);
  } else if (uMode > 2.5 && uMode < 3.5) {
    float a = uSpin * uTime; float cs = cos(a); float sn = sin(a);
    p.xy = vec2(0.0, ${RING_Y.toFixed(1)}) + vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
  } else if (uMode > 3.5 && uMode < 4.5) {
    twinkle = 0.55 + 0.45 * sin(uTime * 1.6 + aSeed * 80.0);
  } else if (uMode > 4.5 && uMode < 5.5) {
    p.x += sin(uTime * 0.2 + aSeed * 40.0) * 0.8;
    p.y = mod(p.y + uTime * (0.1 + aSeed * 0.16), 9.0);
    p.z += cos(uTime * 0.17 + aSeed * 30.0) * 0.8;
  } else if (uMode > 5.5 && uMode < 6.5) {
    p.y += sin(uTime * 0.6 + aSeed * 20.0) * 0.05;
    p.x += sin(uTime * 0.3 + aSeed * 50.0) * 0.12;
  } else if (uMode > 6.5) {
    twinkle = 0.15 + 0.85 * abs(sin(uTime * 2.2 + aSeed * 40.0));
  }
  if (uMode > 0.5 && uMode < 1.5) sizeScale = 1.0 + 0.35 * sin(uTime * 2.0);
  float delay = 0.2 + hash(aSeed * 17.0) * 0.9;
  float k = clamp((uBuild - delay) / 1.3, 0.0, 1.0);
  k = 1.0 - pow(1.0 - k, 3.0);
  if (uMode < 3.5 || uMode > 6.5) {
    vec3 scatter = (vec3(hash(aSeed * 3.1), hash(aSeed * 5.7), hash(aSeed * 7.3)) - 0.5) * 14.0;
    p = mix(scatter, p, k);
  } else { k = clamp(uBuild * 0.7, 0.0, 1.0); }
  vec4 world = vec4(p, 1.0);
  vec4 viewPos = uView * world;
  gl_Position = uMvp * world;
  float depth = max(0.4, -viewPos.z);
  gl_PointSize = clamp(uSize * sizeScale * uPixel / depth, 1.2, 10.0);
  vFade = exp(-depth * 0.04) * (0.25 + 0.75 * k);
  vSeed = aSeed; vBoost = boost; vTwinkle = twinkle;
}`;
const FRAGMENT = `
precision mediump float;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uFlash;
varying float vFade;
varying float vSeed;
varying float vBoost;
varying float vTwinkle;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float soft = smoothstep(0.5, 0.0, d);
  vec3 tint = mix(uColor, vec3(0.92, 1.0, 0.95), step(0.94, vSeed) * uFlash);
  gl_FragColor = vec4(tint, soft * soft * vFade * uAlpha * vBoost * vTwinkle);
}`;

type Point = readonly [number, number, number];
type Colour = readonly [number, number, number];
interface PointSet { readonly buffer: WebGLBuffer; readonly count: number; readonly mode: number; readonly size: number; readonly colour: Colour; readonly alpha: number; readonly flash: number; readonly spin: number }

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type); if (!shader) throw new Error('Shader allocation failed.');
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compile failed.');
  return shader;
}
const smooth = (edge0: number, edge1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0))); return t * t * (3 - 2 * t); };

/**
 * Full-page scroll-driven scene: a particle portal ring with HUD halos and the DarkZec mark, standing in a misty
 * particle field. The camera flies towards the gate as the introduction scrolls by.
 */
/** The gate ring's on-screen centre and outer radius in CSS pixels, so page elements can sit inside it. */
export interface GateFrame { readonly x: number; readonly y: number; readonly radius: number }
export function mountScene(canvas: HTMLCanvasElement, onUnavailable: () => void, onProgress: (progress: number) => void = () => undefined,
  onGate: (gate: GateFrame) => void = () => undefined): Disposable | null {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!gl) return null;
  let program: WebGLProgram;
  try {
    program = gl.createProgram() ?? (() => { throw new Error('Program allocation failed.'); })();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX)); gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Program link failed.');
  } catch { return null; }
  gl.useProgram(program);
  const lifetime = new Lifetime();
  const uniform = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  const U = { mvp: uniform('uMvp'), view: uniform('uView'), time: uniform('uTime'), build: uniform('uBuild'), mode: uniform('uMode'), size: uniform('uSize'),
    pixel: uniform('uPixel'), spin: uniform('uSpin'), colour: uniform('uColor'), alpha: uniform('uAlpha'), flash: uniform('uFlash') };
  const aPos = gl.getAttribLocation(program, 'aPos'); const aSeed = gl.getAttribLocation(program, 'aSeed');
  const random = mulberry32(0x3d07a9);
  const gauss = (): number => (random() + random() + random() - 1.5) / 1.5;

  const fixed: PointSet[] = []; const marked: PointSet[] = [];
  const add = (target: PointSet[], points: readonly Point[], mode: number, size: number, colour: Colour, alpha: number, flash = 0, spin = 0): void => {
    const data = new Float32Array(points.length * 4);
    points.forEach(([x, y, z], i) => { data[i * 4] = x; data[i * 4 + 1] = y; data[i * 4 + 2] = z; data[i * 4 + 3] = random(); });
    const buffer = gl.createBuffer(); if (!buffer) throw new Error('Buffer allocation failed.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    target.push({ buffer, count: points.length, mode, size, colour, alpha, flash, spin });
  };

  // Ground: a dusty field fading into fog, plus mist hugging the base of the gate.
  const ground: Point[] = [];
  for (let i = 0; i < 24000; i++) ground.push([gauss() * 17, (random() - 0.5) * 0.06, 12 - Math.pow(random(), 1.7) * 62]);
  add(fixed, ground, 4, 0.04, [0.72, 0.85, 0.78], 0.85, 0);
  const mist: Point[] = [];
  for (let i = 0; i < 1400; i++) mist.push([gauss() * 2.6, random() * 0.45, gauss() * 1.4]);
  add(fixed, mist, 6, 0.05, [0.75, 0.95, 0.82], 0.55);
  const dust: Point[] = [];
  for (let i = 0; i < 1500; i++) dust.push([(random() * 2 - 1) * 18, random() * 9, -20 + random() * 30]);
  add(fixed, dust, 5, 0.05, [0.45, 1.0, 0.6], 0.6);

  // HUD halos: broken grey arcs and a faint cloud around the ring.
  const arcs = (radius: number, count: number, gaps: number): Point[] => {
    const out: Point[] = [];
    for (let i = 0; i < count; i++) {
      const slot = Math.floor(random() * gaps); const within = random() * 0.62 + slot; const angle = within / gaps * Math.PI * 2;
      const r = radius + (random() - 0.5) * 0.06;
      out.push([Math.cos(angle) * r, RING_Y + Math.sin(angle) * r, (random() - 0.5) * 0.18]);
    }
    return out;
  };
  add(fixed, arcs(2.55, 1300, 9), 3, 0.028, [0.6, 0.72, 0.66], 0.55, 0, 0.05);
  add(fixed, arcs(2.95, 1200, 6), 3, 0.026, [0.55, 0.68, 0.62], 0.5, 0, -0.035);
  const cloud: Point[] = [];
  for (let i = 0; i < 1600; i++) { const angle = random() * Math.PI * 2; const r = 2.9 + gauss() * 0.4; cloud.push([Math.cos(angle) * r, RING_Y + Math.sin(angle) * r, gauss() * 0.3]); }
  add(fixed, cloud, 3, 0.03, [0.5, 0.62, 0.56], 0.28, 0, 0.02);

  // The portal ring and its sparks.
  const ring: Point[] = [];
  for (let i = 0; i < 17000; i++) { const angle = random() * Math.PI * 2; const r = 1.9 + gauss() * 0.3; ring.push([Math.cos(angle) * r, RING_Y + Math.sin(angle) * r, gauss() * 0.2]); }
  add(fixed, ring, 2, 0.058, [0.0, 1.0, 0.3], 1, 1);
  const sparks: Point[] = [];
  for (let i = 0; i < 170; i++) { const r = Math.sqrt(random()) * 1.6; const angle = random() * Math.PI * 2; sparks.push([Math.cos(angle) * r, RING_Y + Math.sin(angle) * r, gauss() * 0.4]); }
  add(fixed, sparks, 7, 0.05, [0.5, 1.0, 0.7], 0.95);

  // The DarkZec mark (Z between brackets) sits in the gate with a mint core.
  const logo = buildLogoParticles();
  add(marked, logo.filter(p => p.tone !== 1).map((p): Point => [p.x, p.y, p.z]), 0, 0.04, [0.82, 0.94, 0.87], 1, 1);
  add(marked, logo.filter(p => p.tone === 1).map((p): Point => [p.x, p.y, p.z]), 0, 0.03, [0.45, 0.58, 0.5], 0.8);
  const core: Point[] = [];
  for (let i = 0; i < 90; i++) { const a = random() * Math.PI * 2; const b = Math.acos(random() * 2 - 1); const r = 0.07 + random() * 0.04; core.push([r * Math.sin(b) * Math.cos(a), r * Math.sin(b) * Math.sin(a), 0.1 + r * Math.cos(b)]); }
  add(marked, core, 1, 0.032, [0.49, 1.0, 0.68], 0.9);

  let width = 1; let height = 1; let pointerX = 0; let pointerY = 0; let smoothX = 0; let smoothY = 0; let frames = 0; let raf = 0; let disposed = false; let start = performance.now();
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const journey = document.getElementById('journey');
  // Scroll position and the journey's rectangle are both visual pixels, so the mapping holds under the desktop page zoom too.
  const progress = (): number => journey ? Math.min(1, Math.max(0, scrollY / Math.max(1, journey.getBoundingClientRect().height - innerHeight))) : 0;
  const resize = (): void => {
    const ratio = Math.min(devicePixelRatio || 1, 1.25);
    width = Math.max(1, Math.round(canvas.clientWidth * ratio)); height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
  };
  const observer = new ResizeObserver(() => { resize(); if (preference.matches) render(); });
  observer.observe(canvas);

  const render = (): void => {
    const reduced = preference.matches;
    const t = reduced ? 4 : (performance.now() - start) / 1000;
    smoothX += (pointerX - smoothX) * 0.05; smoothY += (pointerY - smoothY) * 0.05;
    const p = progress(); onProgress(p);
    const pe = 0.55 * p + 0.45 * p * p * (3 - 2 * p);
    const aspect = width / height; const back = aspect > 1.1 ? 14 : 19;
    const eye: [number, number, number] = [(Math.sin(t * 0.13) * 0.4 + smoothX * 0.7) * (1 - pe), 1.0 + 0.9 * pe - smoothY * 0.2, back - (back - 0.35) * pe];
    const view = lookAt(eye, [0, 3.5 * (1 - pe) + RING_Y * pe, -3 * pe]);
    const projection = perspective(0.9, aspect, 0.1, 120);
    const viewProjection = multiply(projection, view);
    const centre = projectToScreen(viewProjection, [0, RING_Y, 0], canvas.clientWidth, canvas.clientHeight);
    const rim = projectToScreen(viewProjection, [1.9, RING_Y, 0], canvas.clientWidth, canvas.clientHeight);
    if (centre && rim) onGate({ x: centre.x, y: centre.y, radius: Math.hypot(rim.x - centre.x, rim.y - centre.y) });
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.disable(gl.DEPTH_TEST);
    gl.uniform1f(U.time, t); gl.uniform1f(U.build, reduced ? 9 : t); gl.uniform1f(U.pixel, height);
    const dim = 1 - 0.72 * smooth(0.9, 1, p);
    const draw = (set: PointSet, mvp: Mat4, viewMatrix: Mat4): void => {
      gl.bindBuffer(gl.ARRAY_BUFFER, set.buffer);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(aSeed); gl.vertexAttribPointer(aSeed, 1, gl.FLOAT, false, 16, 12);
      gl.uniformMatrix4fv(U.mvp, false, mvp); gl.uniformMatrix4fv(U.view, false, viewMatrix);
      gl.uniform1f(U.mode, set.mode); gl.uniform1f(U.size, set.size); gl.uniform1f(U.spin, reduced ? 0 : set.spin);
      gl.uniform3f(U.colour, set.colour[0], set.colour[1], set.colour[2]); gl.uniform1f(U.alpha, set.alpha * dim); gl.uniform1f(U.flash, set.flash);
      gl.drawArrays(gl.POINTS, 0, set.count);
    };
    for (const set of fixed) draw(set, viewProjection, view);
    const sway = reduced ? 0.2 : Math.sin(t * 0.33) * 0.5; const bob = reduced ? 0 : Math.sin(t * 0.8) * 0.04;
    const mark = model(0.78, reduced ? 0 : Math.sin(t * 0.4 + 2) * 0.1, sway, reduced ? 0 : Math.sin(t * 0.47 + 1) * 0.05, 0, RING_Y + bob, 0);
    const modelView = multiply(view, mark); const modelViewProjection = multiply(projection, modelView);
    for (const set of marked) draw(set, modelViewProjection, modelView);
    frames++; if (frames % 15 === 0 || frames === 1) canvas.dataset.frames = String(frames);
  };

  let lastDraw = 0; let scrollQueued = false;
  const loop = (now = 0): void => {
    if (disposed) return;
    // 30 fps cap: plenty for slow drift, and kinder to batteries and software renderers.
    if (!document.hidden && !preference.matches && now - lastDraw >= 33) { lastDraw = now; render(); }
    raf = preference.matches ? 0 : requestAnimationFrame(now2 => loop(now2));
  };
  const restart = (): void => {
    cancelAnimationFrame(raf); start = performance.now();
    if (preference.matches) { resize(); render(); } else raf = requestAnimationFrame(now => loop(now));
  };
  document.addEventListener('pointermove', event => { pointerX = (event.clientX / innerWidth - 0.5) * 2; pointerY = (event.clientY / innerHeight - 0.5) * 2; }, { passive: true, signal: lifetime.signal });
  addEventListener('scroll', () => {
    if (!preference.matches || scrollQueued) return;
    scrollQueued = true; requestAnimationFrame(() => { scrollQueued = false; render(); });
  }, { passive: true, signal: lifetime.signal });
  preference.addEventListener('change', restart, { signal: lifetime.signal });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); disposed = true; cancelAnimationFrame(raf); onUnavailable(); }, { signal: lifetime.signal });
  canvas.dataset.scene = 'webgl'; resize(); restart();
  lifetime.own(() => { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); delete canvas.dataset.scene; gl.getExtension('WEBGL_lose_context')?.loseContext(); });
  return lifetime;
}
