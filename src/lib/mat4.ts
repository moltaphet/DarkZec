/** Minimal column-major 4x4 matrix helpers for the WebGL scene. */
export type Mat4 = Float32Array;
const at = (matrix: ArrayLike<number>, index: number): number => matrix[index] ?? 0;

export function identity(): Mat4 { const out = new Float32Array(16); out[0] = out[5] = out[10] = out[15] = 1; return out; }

/** Perspective projection. `shiftX` moves the vanishing point sideways in normalised device units. */
export function perspective(fovY: number, aspect: number, near: number, far: number, shiftX = 0): Mat4 {
  const f = 1 / Math.tan(fovY / 2); const out = new Float32Array(16);
  out[0] = f / aspect; out[5] = f; out[8] = -shiftX; out[10] = (far + near) / (near - far); out[11] = -1; out[14] = 2 * far * near / (near - far);
  return out;
}

export function lookAt(eye: readonly [number, number, number], target: readonly [number, number, number]): Mat4 {
  let zx = eye[0] - target[0]; let zy = eye[1] - target[1]; let zz = eye[2] - target[2];
  const zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
  let xx = zz; let xy = 0; let xz = -zx; const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy; const yy = zz * xx - zx * xz; const yz = zx * xy - zy * xx;
  const out = new Float32Array(16);
  out[0] = xx; out[1] = yx; out[2] = zx; out[4] = xy; out[5] = yy; out[6] = zy; out[8] = xz; out[9] = yz; out[10] = zz;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]); out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]); out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]); out[15] = 1;
  return out;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    let sum = 0; for (let k = 0; k < 4; k++) sum += at(a, k * 4 + row) * at(b, column * 4 + k);
    out[column * 4 + row] = sum;
  }
  return out;
}

/** Model matrix: uniform scale, rotation about Y then X then Z, then translation. */
export function model(scale: number, rx: number, ry: number, rz: number, tx: number, ty: number, tz: number): Mat4 {
  const cx = Math.cos(rx); const sx = Math.sin(rx); const cy = Math.cos(ry); const sy = Math.sin(ry); const cz = Math.cos(rz); const sz = Math.sin(rz);
  const out = new Float32Array(16);
  out[0] = (cy * cz + sy * sx * sz) * scale; out[1] = cx * sz * scale; out[2] = (-sy * cz + cy * sx * sz) * scale;
  out[4] = (-cy * sz + sy * sx * cz) * scale; out[5] = cx * cz * scale; out[6] = (sy * sz + cy * sx * cz) * scale;
  out[8] = sy * cx * scale; out[9] = -sx * scale; out[10] = cy * cx * scale;
  out[12] = tx; out[13] = ty; out[14] = tz; out[15] = 1;
  return out;
}

/** Projects a world point through a view-projection matrix to CSS pixels; null when it is behind the camera. */
export function projectToScreen(matrix: Mat4, point: readonly [number, number, number], width: number, height: number): { readonly x: number; readonly y: number } | null {
  const [px, py, pz] = point;
  const w = at(matrix, 3) * px + at(matrix, 7) * py + at(matrix, 11) * pz + at(matrix, 15);
  if (w <= 0) return null;
  const x = (at(matrix, 0) * px + at(matrix, 4) * py + at(matrix, 8) * pz + at(matrix, 12)) / w;
  const y = (at(matrix, 1) * px + at(matrix, 5) * py + at(matrix, 9) * pz + at(matrix, 13)) / w;
  return { x: (x + 1) / 2 * width, y: (1 - y) / 2 * height };
}
