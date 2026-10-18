import { Lifetime } from '../lib/dom';
import { meshNodes, nodePosition } from '../lib/blind-mesh';
import type { MeshNode } from '../lib/blind-mesh';
import { motionLoop } from '../lib/motion';
import type { MotionLoop } from '../lib/motion';
import type { Phase } from '../simulation';

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
  #lastTime = 0;

  constructor(canvas: HTMLCanvasElement, caption: HTMLElement, state: HTMLElement) {
    this.#canvas = canvas; this.#context = canvas.getContext('2d'); this.#caption = caption; this.#state = state;
    this.#loop = motionLoop(canvas, time => this.#draw(time));
    const resize = new ResizeObserver(entries => {
      const bounds = entries[0]?.contentRect; if (!bounds || bounds.width < 1 || bounds.height < 1) return;
      this.#width = bounds.width; this.#height = bounds.height;
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
    if (ids.join() !== this.#nodes.filter(node => !node.fixture).map(node => node.id).join()) this.#nodes = meshNodes(ids);
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
    ctx.lineWidth = 0.7; ctx.strokeStyle = '#123223';
    for (let x = 0; x < w; x += 34) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 34) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = '#225437'; ctx.setLineDash([2, 7]);
    for (const radius of [0.25, 0.41]) {
      ctx.beginPath(); ctx.ellipse(cx, cy, w * radius, h * radius, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);
    const points = this.#nodes.map(node => nodePosition(node, w, h, time));
    points.forEach((point, i) => {
      for (let j = i + 1; j < points.length; j++) {
        const other = points[j]; if (!other || Math.hypot(point.x - other.x, point.y - other.y) > w * 0.42) continue;
        ctx.strokeStyle = '#25533b77'; ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(other.x, other.y); ctx.stroke();
      }
      const selected = i === this.#selected;
      const pulse = 0.6 + Math.sin(time / 850 + (this.#nodes[i]?.phase ?? 0)) * 0.25;
      if (selected) {
        ctx.strokeStyle = '#ffce73'; ctx.lineWidth = 1; ctx.setLineDash([4, 6]); ctx.lineDashOffset = -time / 45;
        ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(cx, cy); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      }
      ctx.strokeStyle = selected ? '#ffce7399' : `rgba(0,255,102,${pulse * 0.45})`;
      ctx.beginPath(); ctx.arc(point.x, point.y, selected ? 12 : 7 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = selected ? '#ffce73' : '#00ff66'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = selected ? 18 : 10;
      ctx.fillRect(point.x - 2.5, point.y - 2.5, 5, 5); ctx.shadowBlur = 0;
      ctx.fillStyle = selected ? '#ffce73' : '#709a80'; ctx.font = '8px ui-monospace, monospace'; ctx.textAlign = point.x > cx ? 'right' : 'left';
      const node = this.#nodes[i];
      ctx.fillText(node?.fixture ? `IDLE_${String(i + 1).padStart(2, '0')}` : (node?.id.slice(0, 6).toUpperCase() ?? ''), point.x + (point.x > cx ? -12 : 12), point.y - 10);
    });
    ctx.fillStyle = '#050d09'; ctx.strokeStyle = '#36764c'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, cy - 47); ctx.lineTo(cx + 66, cy); ctx.lineTo(cx, cy + 47); ctx.lineTo(cx - 66, cy); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  destroy(): void { this.#lifetime.destroy(); this.#nodes = []; this.#context?.clearRect(0, 0, this.#width, this.#height); }
}
