import { Lifetime } from '../lib/dom';
import { meshNodes, nodePosition } from '../lib/blind-mesh';
import type { MeshNode } from '../lib/blind-mesh';
import { motionLoop } from '../lib/motion';
import type { MotionLoop } from '../lib/motion';
import type { Phase } from '../simulation';

interface Box { x: number; y: number; w: number; h: number }

/** Below this canvas width the clearing anchor drops its side labels. */
const COMPACT_WIDTH = 520;

export class BlindOrderflow {
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D | null;
  readonly #caption: HTMLElement;
  readonly #state: HTMLElement;
  readonly #loop: MotionLoop;
  readonly #lifetime = new Lifetime();
  #nodes: readonly MeshNode[] = meshNodes([]);
  #width = 640;
  #height = 280;
  #selected = -1;
  readonly #labelSpots = new Map<number, number>();
  #lastTime = 0;

  constructor(canvas: HTMLCanvasElement, caption: HTMLElement, state: HTMLElement) {
    this.#canvas = canvas; this.#context = canvas.getContext('2d'); this.#caption = caption; this.#state = state;
    this.#loop = motionLoop(canvas, time => this.#draw(time));
    const resize = new ResizeObserver(entries => {
      const bounds = entries[0]?.contentRect; if (!bounds || bounds.width < 1 || bounds.height < 1) return;
      this.#width = bounds.width; this.#height = bounds.height;
      // A narrow mesh has no room for the side labels, so the anchor shrinks to the state word alone.
      canvas.parentElement?.toggleAttribute('data-compact', bounds.width < COMPACT_WIDTH);
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(bounds.width * ratio); canvas.height = Math.round(bounds.height * ratio);
      this.#context?.setTransform(ratio, 0, 0, ratio, 0, 0); this.#loop.invalidate();
    });
    resize.observe(canvas);
    canvas.addEventListener('pointermove', event => {
      // The canvas has no child targets; pointer offsets avoid layout reads on every move.
      const x = event.offsetX; const y = event.offsetY;
      this.#select(this.#nodes.findIndex(node => {
        const point = nodePosition(node, this.#width, this.#height, this.#lastTime);
        return Math.hypot(point.x - x, point.y - y) <= 20;
      }));
    }, { signal: this.#lifetime.signal });
    canvas.addEventListener('pointerleave', () => this.#select(-1), { signal: this.#lifetime.signal });
    canvas.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Escape') this.#select(-1);
      else if (event.key === 'Home') this.#select(0);
      else {
        const count = this.#nodes.length;
        const next = this.#selected < 0 ? (event.key === 'ArrowLeft' ? count - 1 : 0) :
          (this.#selected + (event.key === 'ArrowLeft' ? -1 : 1) + count) % count;
        this.#select(count ? next : -1);
      }
    }, { signal: this.#lifetime.signal });
    canvas.addEventListener('blur', () => this.#select(-1), { signal: this.#lifetime.signal });
    this.#lifetime.own(() => resize.disconnect()); this.#lifetime.own(() => this.#loop.destroy());
    if (!this.#context) caption.textContent = 'Canvas unavailable. Commitment hashes remain listed below.';
    this.update([], 'open');
  }

  update(commitments: readonly string[], phase: Phase): void {
    const ids = commitments.slice(0, 24);
    if (ids.join() !== this.#nodes.filter(node => !node.fixture).map(node => node.id).join()) { this.#nodes = meshNodes(ids); this.#labelSpots.clear(); }
    this.#selected = -1;
    this.#canvas.dataset.activeNode = '-1';
    this.#state.textContent = phase === 'cleared' ? 'RESOLVED' : 'BLINDED';
    this.#canvas.setAttribute('aria-label', `Blind orderflow: ${commitments.length} sealed commitments. Arrow keys inspect nodes; Escape clears selection. No bid amounts are shown.`);
    this.#canvas.dataset.nodeCount = String(commitments.length);
    this.#caption.textContent = commitments.length ? `${Math.min(24, commitments.length)} NODES / COMMITMENTS ONLY · HOVER OR USE ARROW KEYS` : 'IDLE MESH / NO BIDS · LOCAL VISUAL SIMULATION';
    this.#loop.invalidate();
  }

  #select(index: number): void {
    if (index === this.#selected) return;
    this.#selected = index; this.#canvas.dataset.activeNode = String(index);
    const node = this.#nodes[index];
    this.#caption.textContent = node ? (node.fixture ? 'IDLE NODE / NO BID ATTACHED' : `COMMITMENT ${node.id.slice(0, 16).toUpperCase()}… / AMOUNT WITHHELD`) :
      (this.#nodes[0]?.fixture ? 'IDLE MESH / NO BIDS · LOCAL VISUAL SIMULATION' : `${this.#nodes.length} NODES / COMMITMENTS ONLY · HOVER OR USE ARROW KEYS`);
    this.#loop.invalidate();
  }

  #draw(time: number): void {
    const ctx = this.#context; if (!ctx) return;
    this.#lastTime = time;
    const w = this.#width; const h = this.#height; const cx = w / 2; const cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 0.7; ctx.strokeStyle = '#222024';
    for (let x = 0; x < w; x += 34) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 34) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = '#3b383e'; ctx.setLineDash([2, 7]);
    for (const radius of [0.25, 0.41]) {
      ctx.beginPath(); ctx.ellipse(cx, cy, w * radius, h * radius, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);
    const points = this.#nodes.map(node => nodePosition(node, w, h, time));
    points.forEach((point, i) => {
      for (let j = i + 1; j < points.length; j++) {
        const other = points[j]; if (!other || Math.hypot(point.x - other.x, point.y - other.y) > w * 0.42) continue;
        ctx.strokeStyle = '#3c393f77'; ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(other.x, other.y); ctx.stroke();
      }
      const selected = i === this.#selected;
      const pulse = 0.6 + Math.sin(time / 850 + (this.#nodes[i]?.phase ?? 0)) * 0.25;
      if (selected) {
        ctx.strokeStyle = '#7dffae'; ctx.lineWidth = 1; ctx.setLineDash([4, 6]); ctx.lineDashOffset = -time / 45;
        ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(cx, cy); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      }
      ctx.strokeStyle = selected ? '#7dffae99' : `rgba(0,255,102,${pulse * 0.45})`;
      ctx.beginPath(); ctx.arc(point.x, point.y, selected ? 12 : 7 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = selected ? '#7dffae' : '#00ff66'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = selected ? 18 : 10;
      ctx.fillRect(point.x - 2.5, point.y - 2.5, 5, 5); ctx.shadowBlur = 0;
    });
    ctx.fillStyle = '#090909'; ctx.strokeStyle = '#00ff66'; ctx.lineWidth = 1;
    // Wide enough that the HTML labels centred on it (CLEARING / state / PRICE ANCHOR, or the state alone when compact) stay inside its edges.
    const compact = w < COMPACT_WIDTH; const hw = compact ? 64 : 112; const hh = compact ? 32 : 66;
    ctx.beginPath(); ctx.moveTo(cx, cy - hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx - hw, cy); ctx.closePath(); ctx.fill(); ctx.stroke();
    this.#drawLabels(ctx, points, { cx, cy, hw, hh, w, h });
  }

  /**
   * Labels go last and never overlap: each tries a few spots around its node and is skipped if every spot
   * collides with another label, the clearing anchor or the canvas edge. The selected node is placed first.
   */
  #drawLabels(ctx: CanvasRenderingContext2D, points: readonly { x: number; y: number }[], area: { cx: number; cy: number; hw: number; hh: number; w: number; h: number }): void {
    const placed: Box[] = []; const { cx, cy, hw, hh, w, h } = area;
    const inAnchor = (x: number, y: number): boolean => Math.abs(x - cx) / (hw + 4) + Math.abs(y - cy) / (hh + 4) <= 1;
    const free = (box: Box): boolean => box.x >= 2 && box.y >= 2 && box.x + box.w <= w - 2 && box.y + box.h <= h - 2 &&
      !placed.some(other => box.x < other.x + other.w + 4 && other.x < box.x + box.w + 4 && box.y < other.y + other.h + 2 && other.y < box.y + box.h + 2) &&
      ![[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h], [box.x + box.w / 2, box.y], [box.x + box.w / 2, box.y + box.h]].some(([x, y]) => inAnchor(x ?? 0, y ?? 0)) &&
      !points.some(dot => dot.x > box.x - 9 && dot.x < box.x + box.w + 9 && dot.y > box.y - 9 && dot.y < box.y + box.h + 9);
    ctx.font = '12px Consolas, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const order = points.map((_, i) => i).sort((a, b) => Number(b === this.#selected) - Number(a === this.#selected));
    for (const i of order) {
      const point = points[i]; const node = this.#nodes[i]; if (!point || !node) continue;
      const label = node.fixture ? `IDLE_${String(i + 1).padStart(2, '0')}` : node.id.slice(0, 6).toUpperCase();
      const width = ctx.measureText(label).width; const height = 12; const outward = point.x > cx ? 1 : -1;
      const side = (direction: number): number => direction > 0 ? point.x + 12 : point.x - 12 - width;
      const spots: Box[] = [
        { x: side(outward), y: point.y - 10 - height, w: width, h: height }, { x: side(-outward), y: point.y - 10 - height, w: width, h: height },
        { x: side(outward), y: point.y + 10, w: width, h: height }, { x: side(-outward), y: point.y + 10, w: width, h: height },
        { x: point.x - width / 2, y: point.y - 16 - height, w: width, h: height }, { x: point.x - width / 2, y: point.y + 16, w: width, h: height }];
      // Keep last frame's spot while it stays free, so drifting nodes do not make labels hop.
      const previous = spots[this.#labelSpots.get(i) ?? -1]; const spot = previous && free(previous) ? previous : spots.find(free);
      if (!spot) { this.#labelSpots.delete(i); continue; }
      this.#labelSpots.set(i, spots.indexOf(spot)); placed.push(spot); ctx.fillStyle = i === this.#selected ? '#7dffae' : '#85808a'; ctx.fillText(label, spot.x, spot.y + height - 2);
    }
  }
  destroy(): void { this.#lifetime.destroy(); this.#nodes = []; this.#context?.clearRect(0, 0, this.#width, this.#height); }
}
