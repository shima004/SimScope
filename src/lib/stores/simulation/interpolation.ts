import type { SimEntity } from "$lib/rcrs/types";

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function catmullRom(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 *
      (2 * p1[0] +
        (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 *
      (2 * p1[1] +
        (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

function posOnPath(hist: number[], t: number): [number, number] {
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < hist.length; i += 2) pts.push([hist[i], hist[i + 1]]);
  if (pts.length === 0) return [0, 0];
  if (pts.length === 1) return pts[0];

  const et = easeInOut(t);

  if (pts.length === 2) {
    return [
      pts[0][0] + (pts[1][0] - pts[0][0]) * et,
      pts[0][1] + (pts[1][1] - pts[0][1]) * et,
    ];
  }

  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    lens.push(d);
    total += d;
  }
  if (total === 0) return pts[pts.length - 1];

  let rem = et * total;
  for (let i = 0; i < lens.length; i++) {
    if (rem <= lens[i] || i === lens.length - 1) {
      const s = lens[i] === 0 ? 0 : Math.min(rem / lens[i], 1);
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[Math.min(pts.length - 1, i + 1)];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      return catmullRom(p0, p1, p2, p3, s);
    }
    rem -= lens[i];
  }
  return pts[pts.length - 1];
}

export function interpolateEntities(
  current: Map<number, SimEntity>,
  next: Map<number, SimEntity>,
  t: number,
): Map<number, SimEntity> {
  const result = new Map(current);
  for (const [id, nextE] of next) {
    const curE = current.get(id);
    if (!curE || !("x" in curE) || !("x" in nextE)) continue;
    if ((nextE as { x: number }).x === 0 && (nextE as { y: number }).y === 0) continue;

    const hist = (nextE as { positionHistory?: number[] }).positionHistory;
    let nx: number;
    let ny: number;
    if (hist && hist.length >= 4) {
      [nx, ny] = posOnPath(hist, t);
    } else {
      nx = (curE as { x: number }).x + ((nextE as { x: number }).x - (curE as { x: number }).x) * t;
      ny = (curE as { y: number }).y + ((nextE as { y: number }).y - (curE as { y: number }).y) * t;
    }
    result.set(id, { ...curE, x: nx, y: ny });
  }
  return result;
}
