/**
 * 6-dimensional vector math utilities for the recommendation engine.
 *
 * The tuple order mirrors TrackFeatures / TasteVector:
 *   0 → energy
 *   1 → valence
 *   2 → danceability
 *   3 → tempo_norm  (tempo / 200, clamped [0, 1])
 *   4 → acousticness
 *   5 → instrumentalness
 */

export type Vector6 = [number, number, number, number, number, number];

/**
 * Returns the cosine similarity between two 6-dimensional vectors.
 * Result is in the range [-1, 1]; returns 0 when either vector is the zero vector.
 */
export function cosineSimilarity(a: Vector6, b: Vector6): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < 6; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Returns a unit-length copy of `v`.
 * Returns the zero vector if `v` has zero magnitude.
 */
export function normalizeVector(v: Vector6): Vector6 {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (mag === 0) return [0, 0, 0, 0, 0, 0];
  return v.map(x => x / mag) as Vector6;
}

/**
 * Linearly interpolates between vectors `a` and `b` by factor `t`.
 * `t = 0` returns `a`, `t = 1` returns `b`.
 */
export function lerpVector(a: Vector6, b: Vector6, t: number): Vector6 {
  return a.map((x, i) => x + (b[i] - x) * t) as Vector6;
}
