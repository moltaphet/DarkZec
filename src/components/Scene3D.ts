import { Lifetime } from '../lib/dom';
import type { Disposable } from '../lib/dom';
import { lookAt, model, multiply, perspective } from '../lib/mat4';
import type { Mat4 } from '../lib/mat4';
import { buildLogoParticles } from './HeroLogo';

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
varying float vFade;
varying float vSeed;
float hash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
void main() {
  vec3 p = aPos;
  float lift = 0.0;
  if (uMode > 2.5 && uMode < 3.5) {
    float r = length(p.xy - vec2(0.0, 2.3));
    float a = uTime * (0.35 + 0.25 / (0.4 + r)) + aSeed * 6.2831;
    vec2 c = p.xy - vec2(0.0, 2.3);
    float cs = cos(a * 0.25); float sn = sin(a * 0.25);
    p.xy = vec2(0.0, 2.3) + vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
    p.z += sin(a * 2.0 + r * 3.0) * 0.12;
  } else if (uMode > 3.5 && uMode < 4.5) {
    p.z = mod(p.z + uTime * 0.7 + 40.0, 56.0) - 44.0;
  } else if (uMode > 4.5) {
    p.x += sin(uTime * 0.2 + aSeed * 40.0) * 0.8;
    p.y = mod(p.y + uTime * (0.12 + aSeed * 0.2), 9.0);
    p.z += cos(uTime * 0.17 + aSeed * 30.0) * 0.8;
  }
  float delay = 0.2 + hash(aSeed * 17.0) * 0.9;
  float k = clamp((uBuild - delay) / 1.3, 0.0, 1.0);
  k = 1.0 - pow(1.0 - k, 3.0);
  vec3 scatter = (vec3(hash(aSeed * 3.1), hash(aSeed * 5.7), hash(aSeed * 7.3)) - 0.5) * 14.0;
  if (uMode < 2.5 || (uMode > 2.5 && uMode < 3.5)) p = mix(scatter, p, k);
  vec4 world = vec4(p, 1.0);
  vec4 viewPos = uView * world;
  gl_Position = uMvp * world;
  float depth = max(0.4, -viewPos.z);
  gl_PointSize = clamp(uSize * uPixel / depth, 1.4, 9.0);
  float fog = exp(-depth * (uMode > 3.5 && uMode < 4.5 ? 0.075 : 0.045));
  vFade = fog * (0.25 + 0.75 * k);
  vSeed = aSeed;
}`;
const FRAGMENT = `
precision mediump float;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uFlash;
varying float vFade;
varying float vSeed;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float soft = smoothstep(0.5, 0.0, d);
  vec3 tint = mix(uColor, vec3(0.84, 1.0, 0.9), step(0.93, vSeed) * uFlash);
  gl_FragColor = vec4(tint, soft * soft * vFade * uAlpha);
}`;

interface PointSet {
  readonly buffer: WebGLBuffer; readonly count: number; readonly mode: number; readonly size: number;
  readonly color: readonly [number, number, number]; readonly alpha: number; readonly flash: number;
}

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

/** Full-page 3D scene: a particle gate, a swirling portal, the DarkZec mark, a receding grid, dust and stars. */
export function mountScene(canvas: HTMLCanvasElement, onUnavailable: () => void): Disposable | null {
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
    pixel: uniform('uPixel'), color: uniform('uColor'), alpha: uniform('uAlpha'), flash: uniform('uFlash') };
  const aPos = gl.getAttribLocation(program, 'aPos'); const aSeed = gl.getAttribLocation(program, 'aSeed');

  const random = mulberry32(0x3d07a9);
  const make = (points: readonly (readonly [number, number, number])[]): { buffer: WebGLBuffer; count: number } => {
    const data = new Float32Array(points.length * 4);
    points.forEach(([x, y, z], i) => { data[i * 4] = x; data[i * 4 + 1] = y; data[i * 4 + 2] = z; data[i * 4 + 3] = random(); });
    const buffer = gl.createBuffer(); if (!buffer) throw new Error('Buffer allocation failed.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buffer, count: points.length };
  };
  const sets: PointSet[] = []; const logoSets: PointSet[] = [];
  const add = (target: PointSet[], points: readonly (readonly [number, number, number])[], mode: number, size: number, color: readonly [number, number, number], alpha: number, flash = 0): void => {
    const { buffer, count } = make(points); target.push({ buffer, count, mode, size, color, alpha, flash });
  };

  // Logo: the same Z-and-brackets cloud as the hero mark, here living in the gate.
  const logo = buildLogoParticles();
  add(logoSets, logo.filter(p => p.tone !== 1).map(p => [p.x, p.y, p.z] as const), 1, 0.045, [0.0, 1.0, 0.2], 0.85, 1);
  add(logoSets, logo.filter(p => p.tone === 1).map(p => [p.x, p.y, p.z] as const), 1, 0.038, [0.12, 0.8, 0.28], 0.8);

  // Gate: two pillars and a lintel, sampled in volume and pulled towards the surface.
  const boxes: readonly (readonly [number, number, number, number, number, number])[] = [
    [-1.7, -1.4, 0, 4.7, -0.3, 0.3], [1.4, 1.7, 0, 4.7, -0.3, 0.3], [-1.7, 1.7, 4.4, 4.7, -0.3, 0.3], [-1.95, 1.95, -0.08, 0.1, -0.5, 0.5],
  ];
  const gate: (readonly [number, number, number])[] = [];
  boxes.forEach(([x0, x1, y0, y1, z0, z1], index) => {
    for (let i = 0; i < (index === 3 ? 500 : 1000); i++) {
      const point: [number, number, number] = [x0 + random() * (x1 - x0), y0 + random() * (y1 - y0), z0 + random() * (z1 - z0)];
      if (random() < 0.75) { const axis = Math.floor(random() * 3); const lows = [x0, y0, z0]; const highs = [x1, y1, z1]; point[axis] = random() < 0.5 ? lows[axis] ?? 0 : highs[axis] ?? 0; }
      gate.push(point);
    }
  });
  add(sets, gate, 2, 0.034, [0.0, 0.85, 0.2], 0.8, 1);

  // Portal: a plane of points inside the frame, swirled in the vertex shader.
  const portal: (readonly [number, number, number])[] = [];
  for (let i = 0; i < 2600; i++) portal.push([(random() * 2 - 1) * 1.35, 0.15 + random() * 4.1, (random() - 0.5) * 0.1]);
  add(logoSets, portal, 3, 0.03, [0.0, 0.62, 0.2], 0.5);

  // Ground grid receding to the horizon; it scrolls towards the camera in the shader.
  const ground: (readonly [number, number, number])[] = [];
  for (let line = -30; line <= 30; line += 1.5) for (let z = -44; z < 12; z += 0.5) ground.push([line, 0, z]);
  for (let row = -44; row < 12; row += 1.5) for (let x = -30; x <= 30; x += 0.5) ground.push([x, 0, row]);
  add(sets, ground, 4, 0.03, [0.0, 0.58, 0.18], 0.6);

  // Dust and stars.
  const dust: (readonly [number, number, number])[] = [];
  for (let i = 0; i < 900; i++) dust.push([(random() * 2 - 1) * 14, random() * 9, -18 + random() * 28]);
  add(sets, dust, 5, 0.05, [0.35, 1.0, 0.5], 0.7);

  let width = 1; let height = 1; let pointerX = 0; let pointerY = 0; let smoothX = 0; let smoothY = 0; let frames = 0;
  let raf = 0; let disposed = false; let start = performance.now();
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
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
    const scroll = reduced ? 0 : Math.min(1, scrollY / Math.max(1, innerHeight * 1.1));
    const aspect = width / height; const wide = aspect > 1.1;
    const eye: [number, number, number] = [Math.sin(t * 0.13) * 0.5 + smoothX * 0.9, 2.1 + smoothY * -0.35 + scroll * 0.3, (wide ? 9.6 : 12.5) - scroll * 5.2];
    const view = lookAt(eye, [0, 2.3 + scroll * 0.2, 0]);
    const projection = perspective(0.9, aspect, 0.1, 80, wide ? 0.36 : 0);
    const viewProjection = multiply(projection, view);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.disable(gl.DEPTH_TEST);
    gl.uniform1f(U.time, t); gl.uniform1f(U.build, reduced ? 9 : t); gl.uniform1f(U.pixel, height);
    const fade = 1 - scroll * 0.55;
    const draw = (set: PointSet, mvp: Mat4, viewMatrix: Mat4): void => {
      gl.bindBuffer(gl.ARRAY_BUFFER, set.buffer);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(aSeed); gl.vertexAttribPointer(aSeed, 1, gl.FLOAT, false, 16, 12);
      gl.uniformMatrix4fv(U.mvp, false, mvp); gl.uniformMatrix4fv(U.view, false, viewMatrix);
      gl.uniform1f(U.mode, set.mode); gl.uniform1f(U.size, set.size); gl.uniform3f(U.color, set.color[0], set.color[1], set.color[2]);
      gl.uniform1f(U.alpha, set.alpha * fade); gl.uniform1f(U.flash, set.flash);
      gl.drawArrays(gl.POINTS, 0, set.count);
    };
    for (const set of sets) draw(set, viewProjection, view);
    // The mark and the portal share the model matrix: a slow sway plus a vertical bob.
    const sway = reduced ? 0.22 : Math.sin(t * 0.33) * 0.5; const bob = reduced ? 0 : Math.sin(t * 0.8) * 0.08;
    const mark = model(1.0, reduced ? 0 : Math.sin(t * 0.4 + 2) * 0.1, sway, reduced ? 0 : Math.sin(t * 0.47 + 1) * 0.05, 0, 2.4 + bob, 0);
    const identityModel = model(1, 0, 0, 0, 0, 0, 0);
    for (const set of logoSets) {
      const matrix = set.mode === 3 ? identityModel : mark;
      const modelView = multiply(view, matrix); draw(set, multiply(projection, modelView), modelView);
    }
    frames++; if (frames % 15 === 0 || frames === 1) canvas.dataset.frames = String(frames);
  };

  let lastDraw = 0;
  const loop = (now = 0): void => {
    if (disposed) return;
    // 30 fps cap: plenty for slow drift, and kinder to batteries and software renderers.
    if (!document.hidden && !preference.matches && now - lastDraw >= 33) { lastDraw = now; render(); }
    raf = preference.matches ? 0 : requestAnimationFrame(now => loop(now));
  };
  const restart = (): void => {
    cancelAnimationFrame(raf); start = performance.now();
    if (preference.matches) { resize(); render(); } else raf = requestAnimationFrame(now => loop(now));
  };
  document.addEventListener('pointermove', event => { pointerX = (event.clientX / innerWidth - 0.5) * 2; pointerY = (event.clientY / innerHeight - 0.5) * 2; }, { passive: true, signal: lifetime.signal });
  preference.addEventListener('change', restart, { signal: lifetime.signal });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); disposed = true; cancelAnimationFrame(raf); onUnavailable(); }, { signal: lifetime.signal });
  canvas.dataset.scene = 'webgl'; resize(); restart();
  lifetime.own(() => { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); delete canvas.dataset.scene; gl.getExtension('WEBGL_lose_context')?.loseContext(); });
  return lifetime;
}
