import { Vec2 } from '../engine/Physics';

export interface BezierSegment {
  p0: number[]; p1: number[]; p2: number[]; p3: number[];
  start_width: number; end_width: number;
}

export class Track {
  innerWall: Vec2[] = [];
  outerWall: Vec2[] = [];
  centerLine: Vec2[] = [];
  outerIsTight: boolean[] = [];
  barrierInner: Vec2[][] = [];
  barrierOuter: Vec2[][] = [];
  // Pre-computed marking polylines so draw() allocates nothing per frame
  outerMarkingRuns: Vec2[][] = [];
  innerMarkingRuns: Vec2[][] = [];
  segmentBoundaries: number[] = []; // start index in wall arrays for each bezier segment
  checkpoints: { p1: Vec2, p2: Vec2 }[] = [];
  startPos: Vec2 = new Vec2();
  startHeading: number = 0;
  /** Multiplier applied to the car's maximum forward speed on this track. Default 1. */
  topSpeedMultiplier: number = 1;

  async load(url: string) {
    const res  = await fetch(url);
    const data: { segments: BezierSegment[]; top_speed_multiplier?: number } = await res.json();
    this.topSpeedMultiplier = data.top_speed_multiplier ?? 1;
    this.buildGeometry(data.segments);
  }

  buildGeometry(segments: BezierSegment[], topSpeedMultiplier = 1) {
    this.topSpeedMultiplier = topSpeedMultiplier;
    this.innerWall = []; this.outerWall = []; this.centerLine = []; this.checkpoints = [];
    this.barrierInner = []; this.barrierOuter = []; this.outerIsTight = [];
    this.segmentBoundaries = [];

    const steps      = 20;
    const grassWidth = 20;

    // ── Stage 1: sample Bezier geometry ──────────────────────────────────
    // Collect raw per-point geometry without mutating any arrays yet.
    const ptX:      number[] = [];
    const ptY:      number[] = [];
    const nX:       number[] = [];
    const nY:       number[] = [];
    const tanX:     number[] = [];
    const tanY:     number[] = [];
    const rawHw:    number[] = [];
    const isSegStart: boolean[] = [];

    segments.forEach((seg, index) => {
      for (let i = 0; i <= steps; i++) {
        if (i === steps && index < segments.length - 1) continue;
        const t = i / steps, mt = 1 - t;

        const x   = mt**3*seg.p0[0] + 3*mt**2*t*seg.p1[0] + 3*mt*t**2*seg.p2[0] + t**3*seg.p3[0];
        const y   = mt**3*seg.p0[1] + 3*mt**2*t*seg.p1[1] + 3*mt*t**2*seg.p2[1] + t**3*seg.p3[1];
        const dx  = 3*mt**2*(seg.p1[0]-seg.p0[0]) + 6*mt*t*(seg.p2[0]-seg.p1[0]) + 3*t**2*(seg.p3[0]-seg.p2[0]);
        const dy  = 3*mt**2*(seg.p1[1]-seg.p0[1]) + 6*mt*t*(seg.p2[1]-seg.p1[1]) + 3*t**2*(seg.p3[1]-seg.p2[1]);
        const ddx = 6*mt*(seg.p2[0]-2*seg.p1[0]+seg.p0[0]) + 6*t*(seg.p3[0]-2*seg.p2[0]+seg.p1[0]);
        const ddy = 6*mt*(seg.p2[1]-2*seg.p1[1]+seg.p0[1]) + 6*t*(seg.p3[1]-2*seg.p2[1]+seg.p1[1]);

        const mag   = Math.hypot(dx, dy);
        const width = seg.start_width + (seg.end_width - seg.start_width) * t;
        const cross = Math.abs(dx * ddy - dy * ddx);
        const localR = cross > 1e-6 ? (mag * mag * mag) / cross : Infinity;

        ptX.push(x);  ptY.push(y);
        nX.push(-dy / mag);  nY.push(dx / mag);
        tanX.push(dx);  tanY.push(dy);
        rawHw.push(Math.max(40, Math.min(width / 2, localR * 0.82)));
        isSegStart.push(i === 0);
      }
    });

    // ── Stage 2: smooth hw to remove abrupt width-transition kinks ────────
    // A sudden hw change (clamped apex → full width) creates a kink in the
    // wall polyline.  3 passes of a 5-point moving average spreads out the
    // transition so it looks like the road naturally narrows into a corner.
    const hw = rawHw.slice();
    for (let pass = 0; pass < 3; pass++) {
      const prev = hw.slice();
      for (let i = 2; i < hw.length - 2; i++) {
        hw[i] = (prev[i-2] + prev[i-1] + prev[i] + prev[i+1] + prev[i+2]) / 5;
      }
    }

    // ── Stage 3: build wall / barrier / checkpoint arrays ─────────────────
    const tmpBarrierInner: Vec2[] = [];
    const tmpBarrierOuter: Vec2[] = [];

    for (let idx = 0; idx < ptX.length; idx++) {
      if (isSegStart[idx]) this.segmentBoundaries.push(this.innerWall.length);

      const h      = hw[idx];
      const x      = ptX[idx],  y  = ptY[idx];
      const nx     = nX[idx],   ny = nY[idx];
      const center = new Vec2(x, y);
      const inner  = new Vec2(x - nx * h, y - ny * h);
      const outer  = new Vec2(x + nx * h, y + ny * h);

      this.centerLine.push(center);
      this.innerWall.push(inner);
      this.outerWall.push(outer);

      const toOutX = outer.x - x, toOutY = outer.y - y;
      const magO   = Math.hypot(toOutX, toOutY) || 1;
      tmpBarrierOuter.push(new Vec2(outer.x + (toOutX / magO) * grassWidth,
                                    outer.y + (toOutY / magO) * grassWidth));

      const toInX = inner.x - x, toInY = inner.y - y;
      const magI  = Math.hypot(toInX, toInY) || 1;
      tmpBarrierInner.push(new Vec2(inner.x + (toInX / magI) * grassWidth,
                                    inner.y + (toInY / magI) * grassWidth));

      this.outerIsTight.push(false);

      if (idx === 0) {
        this.startPos    = center;
        this.startHeading = Math.atan2(tanY[idx], tanX[idx]);
      }

      if (idx % 10 === 0) {
        this.checkpoints.push({ p1: inner, p2: outer });
      }
    }

        // After building walls compute tight segments using centerLine tangents.
        // only mark genuinely tight corners; increase threshold accordingly
        // 0.1 rad ≈ 5.7°
        const thresh = 0.1;
        for (let j = 1; j < this.centerLine.length - 1; j++) {
          const a = this.centerLine[j-1];
          const b = this.centerLine[j];
          const c = this.centerLine[j+1];
          const v1x = b.x - a.x, v1y = b.y - a.y;
          const v2x = c.x - b.x, v2y = c.y - b.y;
          const m1 = Math.hypot(v1x, v1y);
          const m2 = Math.hypot(v2x, v2y);
          if (m1>0 && m2>0) {
            const dot = (v1x*v2x+v1y*v2y)/(m1*m2);
            const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
            if (ang > thresh) {
              if (j < this.outerIsTight.length) this.outerIsTight[j] = true;
            }
          }
        }

    // Build barrier runs, skipping points that fall inside asphalt of another segment
    // (handles self-intersecting tracks like figure-8 where barriers would form a cage)
    const isInsideAsphalt = (pt: Vec2): boolean => {
      let minDist = Infinity, minIdx = 0;
      for (let i = 0; i < this.centerLine.length; i++) {
        const d = Math.hypot(pt.x - this.centerLine[i].x, pt.y - this.centerLine[i].y);
        if (d < minDist) { minDist = d; minIdx = i; }
      }
      const hw = Math.hypot(this.innerWall[minIdx].x - this.centerLine[minIdx].x,
                            this.innerWall[minIdx].y - this.centerLine[minIdx].y);
      return minDist < hw;
    };
    const toRuns = (pts: Vec2[]): Vec2[][] => {
      const runs: Vec2[][] = [];
      let cur: Vec2[] = [];
      for (const pt of pts) {
        if (isInsideAsphalt(pt)) {
          if (cur.length >= 2) runs.push(cur);
          cur = [];
        } else {
          cur.push(pt);
        }
      }
      if (cur.length >= 2) runs.push(cur);
      return runs;
    };
    this.barrierInner = toRuns(tmpBarrierInner);
    this.barrierOuter = toRuns(tmpBarrierOuter);

    // Pre-compute marking runs once so draw() has zero per-frame allocations
    this.outerMarkingRuns = this.computeMarkingRuns(this.outerWall);
    this.innerMarkingRuns = this.computeMarkingRuns(this.innerWall);
  }

  private computeMarkingRuns(wall: Vec2[]): Vec2[][] {
    const grassWidth = 20;
    const halfStripe = (grassWidth * 3 / 4) / 2; // 7.5
    const offset = grassWidth - halfStripe;        // 12.5
    const dashCycle = 40;
    const runs: Vec2[][] = [];
    let current: Vec2[] = [];

    for (let i = 0; i < wall.length; i++) {
      if (!this.outerIsTight[i]) {
        if (current.length >= 2) runs.push(current);
        current = [];
        continue;
      }
      const p = wall[i];
      const c = this.centerLine[i] || p;
      // Direction away from road center (toward grass), not toward it
      const dirX = p.x - c.x, dirY = p.y - c.y;
      const mag = Math.hypot(dirX, dirY) || 1;
      current.push(new Vec2(p.x + (dirX / mag) * offset, p.y + (dirY / mag) * offset));
    }
    if (current.length >= 2) runs.push(current);

    return runs.map(pts => {
      let totalLen = 0;
      for (let i = 1; i < pts.length; i++)
        totalLen += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
      const truncLen = Math.floor(totalLen / dashCycle) * dashCycle;
      if (truncLen <= 0) return [];

      const result: Vec2[] = [pts[0]];
      let walked = 0;
      for (let i = 1; i < pts.length; i++) {
        const segLen = Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
        if (walked + segLen >= truncLen) {
          const t = (truncLen - walked) / segLen;
          result.push(new Vec2(
            pts[i-1].x + t * (pts[i].x - pts[i-1].x),
            pts[i-1].y + t * (pts[i].y - pts[i-1].y)
          ));
          break;
        }
        result.push(pts[i]);
        walked += segLen;
      }
      return result;
    }).filter(r => r.length >= 2);
  }

  draw(ctx: CanvasRenderingContext2D, nextCheckpointIdx: number) {
    if (this.centerLine.length === 0) return;

    const grassWidth = 20;

    // Helper: stroke a wall polyline, closing it if the track forms a closed loop
    const strokeWall = (wall: Vec2[]) => {
      if (wall.length === 0) return;
      ctx.beginPath();
      wall.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      const w0 = wall[0], wL = wall[wall.length - 1];
      if (Math.hypot(w0.x - wL.x, w0.y - wL.y) < 1) ctx.closePath();
      ctx.stroke();
    };

    // Single polygon causes canvas fill voids when hw narrows and reverses
    // winding (counter-wound sections are left unfilled by the non-zero rule).
    // Per-segment fills avoid this: each segment is convex / single-wound.
    // Extending 2 points into the next segment guarantees full overlap so
    // there are zero anti-aliased seams at segment boundaries.
    const fillAsphalt = () => {
      ctx.fillStyle = '#333';
      for (let s = 0; s < this.segmentBoundaries.length; s++) {
        const segStart = this.segmentBoundaries[s];
        const nextSeg  = s + 1 < this.segmentBoundaries.length
          ? this.segmentBoundaries[s + 1]
          : this.innerWall.length;
        const segEnd = Math.min(nextSeg + 2, this.innerWall.length - 1);
        ctx.beginPath();
        for (let i = segStart; i <= segEnd; i++)
          ctx[i === segStart ? 'moveTo' : 'lineTo'](this.innerWall[i].x, this.innerWall[i].y);
        for (let i = segEnd; i >= segStart; i--)
          ctx.lineTo(this.outerWall[i].x, this.outerWall[i].y);
        ctx.closePath();
        ctx.fill();
      }
    };

    // 1. Asphalt first (base road surface)
    fillAsphalt();

    // 2. Grass strokes on top — extend 20px on each side of wall, giving green road-edge border
    // Round joins/caps prevent miter spikes at polyline kinks (tight-corner hw transitions).
    ctx.lineWidth = grassWidth * 2;
    ctx.strokeStyle = '#4b7b4b';
    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';
    strokeWall(this.innerWall);
    strokeWall(this.outerWall);
    ctx.lineJoin = 'miter';
    ctx.lineCap  = 'butt';

    // 3. Asphalt again — covers any grass that bled into the road area.
    fillAsphalt();
    // Hairline seal: a thin asphalt-coloured stroke exactly on each wall edge
    // catches any sub-pixel ghost left by the round grass caps at kink points.
    ctx.lineWidth   = 4;
    ctx.strokeStyle = '#333';
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    strokeWall(this.innerWall);
    strokeWall(this.outerWall);
    ctx.lineJoin = 'miter';
    ctx.lineCap  = 'butt';

    // Barrier lines (darker gray) outside the grass — runs skip points inside crossing asphalt
    ctx.lineWidth = 15;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#222';
    const drawBarrierRuns = (runs: Vec2[][]) => {
      for (const run of runs) {
        if (run.length < 2) continue;
        ctx.beginPath();
        run.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        const r0 = run[0], rL = run[run.length - 1];
        if (Math.hypot(r0.x - rL.x, r0.y - rL.y) < 1) ctx.closePath();
        ctx.stroke();
      }
    };
    drawBarrierRuns(this.barrierInner);
    drawBarrierRuns(this.barrierOuter);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    // red/white markings — use pre-computed runs (no per-frame allocation)
    const drawRuns = (runs: Vec2[][]) => {
      for (const pts of runs) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    };

    ctx.lineWidth = grassWidth * 3 / 4;
    ctx.setLineDash([20, 20]);
    ctx.strokeStyle = '#f00';
    drawRuns(this.outerMarkingRuns);
    drawRuns(this.innerMarkingRuns);

    ctx.lineDashOffset = 20;
    ctx.strokeStyle = '#fff';
    drawRuns(this.outerMarkingRuns);
    drawRuns(this.innerMarkingRuns);

    ctx.lineDashOffset = 0;
    ctx.setLineDash([]);
    
    // Center Dashed
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([20, 20]);
    ctx.beginPath();
    this.centerLine.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.setLineDash([]);

    // Checkpoints (Start/Finish & Next)
    this.checkpoints.forEach((cp, i) => {
      if (i === 0) {
        // Checkered start/finish line - visible across track width
        const lineVec = new Vec2(cp.p2.x - cp.p1.x, cp.p2.y - cp.p1.y);
        const lineDist = Math.hypot(lineVec.x, lineVec.y);
        const lineDir = new Vec2(lineVec.x / lineDist, lineVec.y / lineDist);

        const checkSize = 20;
        const numChecks = Math.ceil(lineDist / checkSize);
        const halfWidth = 8; // narrow checkered stripe
        for (let c = 0; c < numChecks; c++) {
          const t1 = c / numChecks;
          const t2 = (c + 1) / numChecks;
          const x1 = cp.p1.x + lineDir.x * lineDist * t1;
          const y1 = cp.p1.y + lineDir.y * lineDist * t1;
          const x2 = cp.p1.x + lineDir.x * lineDist * t2;
          const y2 = cp.p1.y + lineDir.y * lineDist * t2;
          const perpDirX = -lineDir.y;
          const perpDirY = lineDir.x;
          ctx.fillStyle = c % 2 === 0 ? '#fff' : '#000';
          ctx.beginPath();
          ctx.moveTo(x1 + perpDirX * halfWidth, y1 + perpDirY * halfWidth);
          ctx.lineTo(x2 + perpDirX * halfWidth, y2 + perpDirY * halfWidth);
          ctx.lineTo(x2 - perpDirX * halfWidth, y2 - perpDirY * halfWidth);
          ctx.lineTo(x1 - perpDirX * halfWidth, y1 - perpDirY * halfWidth);
          ctx.closePath();
          ctx.fill();
        }
      } else if (i === nextCheckpointIdx) {
        ctx.beginPath();
        ctx.moveTo(cp.p1.x, cp.p1.y);
        ctx.lineTo(cp.p2.x, cp.p2.y);
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    });
  }

  /**
   * Return a friction multiplier based on the car position.
   * - 1.0 on asphalt
   * - 2.0 on grass (within grassWidth from either wall)
   * - 1.2 on red/white markings on outer tight turns
   */
  getFrictionMultiplier(pos: Vec2): number {
    const grassWidth = 20;
    // Find nearest centerLine point and its half-width
    let minDist = Infinity, nearestIdx = 0;
    for (let i = 0; i < this.centerLine.length; i++) {
      const d = Math.hypot(pos.x - this.centerLine[i].x, pos.y - this.centerLine[i].y);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }
    const hw = Math.hypot(
      this.innerWall[nearestIdx].x - this.centerLine[nearestIdx].x,
      this.innerWall[nearestIdx].y - this.centerLine[nearestIdx].y
    );
    // On asphalt: no friction penalty
    if (minDist <= hw) return 1.0;
    // On grass band (between wall and barrier)
    if (minDist <= hw + grassWidth) return 0.97;
    return 1.0;
  }
}