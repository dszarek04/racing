import type { BezierSegment } from '../entities/Track';

// ─── Seeded PRNG ─────────────────────────────────────────────────────────────

/** mulberry32 — fast, high-quality 32-bit seeded PRNG. Returns floats in [0, 1). */
function mkRng(seed: number): () => number {
  let s = (seed >>> 0) || 1; // never allow zero state
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t     = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

/** Returns true if segment AB strictly intersects segment CD (shared endpoints ignored). */
function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(denom) < 1e-9) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;
  return t > 0.002 && t < 0.998 && u > 0.002 && u < 0.998;
}

/** Tessellate a cubic Bezier into `steps+1` sample points. */
function tessellate(seg: BezierSegment, steps = 20): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, mt = 1 - t;
    pts.push([
      mt ** 3 * seg.p0[0] + 3 * mt ** 2 * t * seg.p1[0] + 3 * mt * t ** 2 * seg.p2[0] + t ** 3 * seg.p3[0],
      mt ** 3 * seg.p0[1] + 3 * mt ** 2 * t * seg.p1[1] + 3 * mt * t ** 2 * seg.p2[1] + t ** 3 * seg.p3[1],
    ]);
  }
  return pts;
}

/**
 * Checks whether `candidate` intersects any of `prior` except the very last
 * entry (which is the immediately preceding segment that shares an endpoint).
 */
function intersectsAny(candidate: BezierSegment, prior: BezierSegment[]): boolean {
  if (prior.length < 2) return false; // nothing far enough away to check
  const cp = tessellate(candidate);
  for (let si = 0; si < prior.length - 1; si++) {
    const pp = tessellate(prior[si]);
    for (let a = 0; a < cp.length - 1; a++) {
      for (let b = 0; b < pp.length - 1; b++) {
        if (segmentsIntersect(
          cp[a][0], cp[a][1], cp[a + 1][0], cp[a + 1][1],
          pp[b][0], pp[b][1], pp[b + 1][0], pp[b + 1][1],
        )) return true;
      }
    }
  }
  return false;
}

// ─── Spine generation ────────────────────────────────────────────────────────

interface SpinePoint { x: number; y: number; }

/**
 * Builds the spine (centerline turn-points) using a constrained random walk.
 *
 * Each segment consumes exactly 4 RNG values so the entire layout is fully
 * deterministic for a given seed regardless of which branch is taken:
 *   r1 – segment type selector
 *   r2 – turn direction (left vs right)
 *   r3 – turn magnitude fraction
 *   r4 – segment length fraction
 *
 * Four types with increasing sharpness:
 *   Straight  (15%) – tiny drift, 300–600 px long
 *   Gentle    (30%) – 11–34°,    350–650 px long
 *   Tight     (30%) – 34–69°,    300–600 px long
 *   Hairpin   (25%) – 72–120°,   400–750 px long
 *
 * No total-angle budget is enforced; the intersection test in generateTrack
 * rejects any layout that self-crosses, guaranteeing a clean result.
 */
function generateSpine(rng: () => number, numSegs: [number, number]): SpinePoint[] {
  const numSegments = numSegs[0] + Math.floor(rng() * (numSegs[1] - numSegs[0] + 1));
  const pts: SpinePoint[] = [{ x: 0, y: 0 }];
  let heading = 0;
  let segsSinceSharp = 2; // allow a sharp turn from the start

  for (let i = 0; i < numSegments; i++) {
    // Consume exactly 4 RNG values every iteration (keeps seed determinism).
    const r1 = rng(); // segment type
    const r2 = rng(); // turn direction
    const r3 = rng(); // turn magnitude fraction
    const r4 = rng(); // segment length fraction

    // Classify the desired segment type from r1.
    // If a sharp type would appear too soon after the last sharp, demote it.
    type SegType = 'straight' | 'gentle' | 'tight' | 'sharp';
    let segType: SegType;
    if      (r1 < 0.15) segType = 'straight';
    else if (r1 < 0.45) segType = 'gentle';
    else if (r1 < 0.75) segType = 'tight';
    else                segType = 'sharp';

    if (segsSinceSharp < 2 && (segType === 'tight' || segType === 'sharp')) {
      // Demote: remap r1 into straight/gentle range using same value.
      segType = r1 < 0.30 ? 'straight' : 'gentle';
    }

    let turn:   number;
    let segLen: number;

    if (segType === 'straight') {
      turn   = (r2 < 0.5 ? 1 : -1) * r3 * 0.08;
      segLen = 300 + r4 * 300;                          // 300–600 px
    } else if (segType === 'gentle') {
      turn   = (r2 < 0.5 ? 1 : -1) * (0.20 + r3 * 0.40);
      segLen = 350 + r4 * 300;                          // 350–650 px
    } else if (segType === 'tight') {
      turn   = (r2 < 0.5 ? 1 : -1) * (0.60 + r3 * 0.55);
      segLen = 300 + r4 * 300;                          // 300–600 px
    } else {
      // sharp: 46–80°  (was hairpin 72–120°)
      turn   = (r2 < 0.5 ? 1 : -1) * (0.80 + r3 * 0.60);
      segLen = 500 + r4 * 500;                          // 500–1 000 px
    }

    segsSinceSharp = (segType === 'tight' || segType === 'sharp') ? 0 : segsSinceSharp + 1;

    // Enforce a minimum chord so the Bezier apex radius of curvature stays
    // a safe multiple above the road width.
    //
    // For a symmetric Catmull-Rom bezier with handle fraction f and chord d,
    // the apex radius is R = d / (6 * f * sin(|turn|/2)).
    // With f = HANDLE_FRACTION = 0.28 (see spineToSegments), we need:
    //   R_min = hw_max + MIN_INNER_CLEARANCE = 100 + 350 = 450 px
    //   chord_min = R_min * 6 * f * sin(|turn|/2)
    //             = 450 * 6 * 0.28 * sin(|turn|/2)
    //             = 756 * sin(|turn|/2)
    // We add an extra ×1.5 safety factor to stay clear of the clamp limit.
    const HANDLE_FRACTION = 0.28;   // must match spineToSegments
    const R_MIN           = 500;    // px — guaranteed centre-line apex radius
    const chordMin = R_MIN * 6 * HANDLE_FRACTION * Math.sin(Math.abs(turn) / 2) * 1.5;
    segLen = Math.max(segLen, chordMin);

    heading += turn;
    const last = pts[pts.length - 1];
    pts.push({
      x: last.x + Math.cos(heading) * segLen,
      y: last.y + Math.sin(heading) * segLen,
    });
  }
  return pts;
}

// ─── Bezier curve fitting ────────────────────────────────────────────────────

/**
 * Converts spine points to Catmull-Rom cubic Bezier segments.
 * Adjacent segments automatically share edge widths so road width
 * transitions are smooth rather than jumpy.
 */
function spineToSegments(pts: SpinePoint[], rng: () => number): BezierSegment[] {
  // One width value per spine point; each step drifts by up to ±40 px,
  // clamped to [80, 160].  Narrower maximum (was 200) reduces the risk of a
  // wide road at a sharp turn pushing the inner wall to an uncomfortably tight
  // radius — the hw floor + curvature clamp in buildGeometry handles the rest.
  const widths: number[] = [100 + rng() * 60];
  for (let i = 1; i < pts.length; i++) {
    const prev  = widths[i - 1];
    const delta = (rng() * 2 - 1) * 40;
    widths.push(Math.max(80, Math.min(160, prev + delta)));
  }

  const alpha    = 1 / 6; // Catmull-Rom tension
  const segments: BezierSegment[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const p1   = pts[i];
    const p2   = pts[i + 1];
    const next = pts[Math.min(pts.length - 1, i + 2)];

    // Compute unclamped Catmull-Rom handles
    let h1x = (p2.x - prev.x) * alpha,  h1y = (p2.y - prev.y) * alpha;
    let h2x = -(next.x - p1.x) * alpha, h2y = -(next.y - p1.y) * alpha;

    // Clamp handle lengths to 28% of chord distance.
    // Lower fraction (was 38%) → larger apex radius of curvature for the same
    // chord length, giving the inner wall more room.  Must match the
    // HANDLE_FRACTION constant in generateSpine used to size chordMin.
    const chord    = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const maxH     = chord * 0.28;
    const len1     = Math.hypot(h1x, h1y);
    const len2     = Math.hypot(h2x, h2y);
    if (len1 > maxH) { const s = maxH / len1; h1x *= s; h1y *= s; }
    if (len2 > maxH) { const s = maxH / len2; h2x *= s; h2y *= s; }

    segments.push({
      p0: [p1.x,        p1.y],
      p1: [p1.x + h1x,  p1.y + h1y],
      p2: [p2.x + h2x,  p2.y + h2y],
      p3: [p2.x,        p2.y],
      start_width: widths[i],
      end_width:   widths[i + 1],
    });
  }
  return segments;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generates a non-looping procedural track from a numeric seed.
 *
 * `length` controls the number of segments:
 *   short  – 10–16   segments
 *   medium – 20–28   segments (~2×)
 *   long   – 40–52   segments (~2× medium)
 *
 * The same seed + length always produces the same track.
 */
export function generateTrack(
  seed: number,
  length: 'short' | 'medium' | 'long' | 'xl' = 'short',
  maxAttempts = 80,
): BezierSegment[] {
  const segCounts: Record<string, [number, number]> = {
    short:  [10, 16],
    medium: [20, 28],
    long:   [40, 52],
    xl:     [80, 104],
  };
  const numSegs = segCounts[length];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng      = mkRng(seed + attempt * 997);
    const spine    = generateSpine(rng, numSegs);
    const segments = spineToSegments(spine, rng);

    let clean = true;
    const placed: BezierSegment[] = [];
    for (const seg of segments) {
      if (intersectsAny(seg, placed)) { clean = false; break; }
      placed.push(seg);
    }
    if (clean) return segments;
  }

  // Fallback: a four-segment gentle S-curve that is always safe
  return [
    { p0: [0, 0],         p1: [400, 0],        p2: [700, -200],    p3: [900, -200],    start_width: 120, end_width: 110 },
    { p0: [900, -200],    p1: [1200, -200],     p2: [1500, 50],     p3: [1800, 0],      start_width: 110, end_width: 140 },
    { p0: [1800, 0],      p1: [2100, -50],      p2: [2400, -250],   p3: [2700, -200],   start_width: 140, end_width: 130 },
    { p0: [2700, -200],   p1: [2950, -150],     p2: [3200, 0],      p3: [3500, 0],      start_width: 130, end_width: 120 },
  ];
}
