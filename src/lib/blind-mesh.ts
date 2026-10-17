export interface MeshNode { readonly id: string; readonly x: number; readonly y: number; readonly phase: number; readonly fixture: boolean }

/** Coordinates depend only on public commitment bytes, never amounts, quantities or addresses. */
export function meshNodes(commitments: readonly string[]): readonly MeshNode[] {
  const values = commitments.length ? commitments.slice(0, 24) : ['07', '23', '49', '61', '83', 'a7', 'c1', 'e9'];
  return values.map((id, index) => {
    const seed = Number.parseInt(id.slice(0, 6), 16);
    const phase = (seed % 1000) / 1000 * Math.PI * 2;
    const angle = index / values.length * Math.PI * 2 + Math.PI / 12;
    const distance = 0.29 + (seed % 7) / 100;
    return Object.freeze({ id, phase, x: 0.5 + Math.cos(angle) * distance, y: 0.5 + Math.sin(angle) * distance,
      fixture: commitments.length === 0 });
  });
}

export function nodePosition(node: MeshNode, width: number, height: number, time: number): { x: number; y: number } {
  return { x: node.x * width + Math.sin(time / 2100 + node.phase) * 4,
    y: node.y * height + Math.cos(time / 2600 + node.phase) * 4 };
}
