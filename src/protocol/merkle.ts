import { sha256, unhex, utf8 } from './crypto';

export interface ProofStep { readonly hash: string; readonly side: 'left' | 'right' }
export interface InclusionProof { readonly index: number; readonly count: number; readonly steps: readonly ProofStep[] }
const isHash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);
const leaf = async (value: string): Promise<string> => {
  if (!isHash(value)) throw new Error('Invalid commitment hash.');
  return sha256(new Uint8Array([0, ...unhex(value)]));
};
const parent = async (left: string, right: string): Promise<string> => sha256(new Uint8Array([1, ...unhex(left), ...unhex(right)]));
// Bind tree size so duplicating an odd final leaf cannot impersonate a larger tree.
const bindCount = async (root: string, count: number): Promise<string> => {
  const size = new Uint8Array(8);
  new DataView(size.buffer).setBigUint64(0, BigInt(count), false);
  return sha256(new Uint8Array([2, ...size, ...unhex(root)]));
};
export async function merkleRoot(commitments: readonly string[]): Promise<string> {
  let level = await Promise.all(commitments.map(leaf));
  if (level.length === 0) return sha256(utf8('DARKZEC/merkle/empty/v1'));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]; const right = level[i + 1] ?? left;
      if (left === undefined || right === undefined) throw new Error('Invalid Merkle level.');
      next.push(await parent(left, right));
    }
    level = next;
  }
  const root = level[0]; if (!root) throw new Error('Missing Merkle root.'); return bindCount(root, commitments.length);
}
export async function merkleProof(commitments: readonly string[], index: number): Promise<InclusionProof> {
  if (!Number.isInteger(index) || index < 0 || index >= commitments.length) throw new Error('Invalid leaf index.');
  let level = await Promise.all(commitments.map(leaf)); let position = index;
  const steps: ProofStep[] = [];
  while (level.length > 1) {
    const hash = level[position ^ 1] ?? level[position];
    if (!hash) throw new Error('Missing proof sibling.');
    steps.push({ hash, side: position % 2 ? 'left' : 'right' });
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]; const right = level[i + 1] ?? left;
      if (!left || !right) throw new Error('Invalid Merkle level.');
      next.push(await parent(left, right));
    }
    level = next; position = Math.floor(position / 2);
  }
  return { index, count: commitments.length, steps };
}
export async function verifyProof(value: string, proof: InclusionProof, root: string): Promise<boolean> {
  if (!isHash(value) || !isHash(root) || !Number.isSafeInteger(proof.count) || proof.count <= 0 || !Number.isInteger(proof.index) || proof.index < 0 || proof.index >= proof.count) return false;
  let hash = await leaf(value); let position = proof.index; let width = proof.count; let depth = 0;
  for (const step of proof.steps) {
    if (width <= 1 || !isHash(step.hash) || step.side !== (position % 2 ? 'left' : 'right')) return false;
    if (position % 2 === 0 && position + 1 === width && step.hash !== hash) return false;
    hash = step.side === 'left' ? await parent(step.hash, hash) : await parent(hash, step.hash);
    position = Math.floor(position / 2); width = Math.ceil(width / 2); depth++;
  }
  return width === 1 && depth === Math.ceil(Math.log2(proof.count)) && await bindCount(hash, proof.count) === root;
}
