import { Vec2 } from '../engine/Physics';
import { Input } from '../utils/Input';

export class Particle {
  life: number = 1.0;
  constructor(public pos: Vec2, public vel: Vec2) {}
}

export class Car {
  pos: Vec2;
  vel: Vec2 = new Vec2();
  heading: number = 0; // radians
  angularVel: number = 0;
  
  // Specs
  width = 1.8 * 20; // scaled for rendering (2x larger)
  length = 4.0 * 20; // 2x larger
  
  // Physics config
  acceleration = 500; // pixels/sec²
  friction = 0.990; // velocity multiplier each frame (higher = less friction, higher top speed)
  // Max speed is now dynamic: acceleration / (1 - friction) = terminal velocity
  // With current values: 400 / (1 - 0.985) = 400 / 0.015 = 26,666 pixels/sec
  turnSpeed = 0.035; // radians per frame (scaled by speed factor)
  steerInputSensitivity = 1.0;
  currentSteer = 0; // -1 to 1
  private _sharpSteerTime = 0; // seconds holding a sharp steer (> 0.5) — gates drift
  driftRatio = 0; // exposed for audio/effects (0 = no drift, 1+ = heavy drift)

  particles: Particle[] = [];
  skidMarks: { left: Vec2[], right: Vec2[] }[] = [];
  private _skidActive = false;

  constructor(startX: number, startY: number, startHeading: number) {
    this.pos = new Vec2(startX, startY);
    this.heading = startHeading;
  }

    // track parameter added to determine surface friction
  update(dt: number, input: Input, track?: import('./Track').Track) {
    // Terminal velocity: v where accel*dt == v*(1-friction) each frame
    const terminalVel = this.acceleration / (60 * (1 - this.friction));
    const driftThreshold = terminalVel * 0.034;

    // Decompose velocity into car-relative components (forward/lateral)
    const fwdX = Math.cos(this.heading), fwdY = Math.sin(this.heading);
    const rightX = -Math.sin(this.heading), rightY = Math.cos(this.heading);

    let fwdSpeed = this.vel.x * fwdX + this.vel.y * fwdY; // signed: + = forward, - = reverse
    let latSpeed = this.vel.x * rightX + this.vel.y * rightY; // lateral slip
    const absSpeed = Math.abs(fwdSpeed);

    // Steering: rate decreases at higher speed; inverted when reversing
    const rawSteer = input.right - input.left;
    const steerInput = fwdSpeed < -5 ? -rawSteer : rawSteer;
    this.currentSteer += (steerInput - this.currentSteer) * (1 - Math.pow(0.8, dt * 60));
    if (absSpeed > 5) {
      // Wheel simulation: turning builds with speed (no tank-spinning), then decreases at high speed
      const turnFactor = Math.min(absSpeed / 80, 1) / (1 + absSpeed / 500);
      this.heading += this.currentSteer * this.turnSpeed * turnFactor * dt * 60;
    }

    // Integrate collision-induced angular velocity
    this.heading += this.angularVel * dt;
    this.angularVel *= Math.pow(0.9, dt * 60);

    // Use raw key state for which pedal is active so that the smoothing decay
    // on one input never blocks the other (e.g. releasing W while pressing S).
    const throttleHeld  = !!(input.keys['w'] || input.keys['arrowup']);
    const brakeHeld     = !!(input.keys['s'] || input.keys['arrowdown']);
    const handbrakeHeld = !!(input.keys[' ']);

    let accel = 0;
    if (throttleHeld) {
      accel = fwdSpeed < 0
        ? this.acceleration * input.throttle * 2.0  // cancel reverse faster
        : this.acceleration * input.throttle;
    } else if (brakeHeld) {
      accel = fwdSpeed > 10
        ? -this.acceleration * 1.5 * input.brake
        : -this.acceleration * input.brake; // reverse when nearly stopped
    }

    fwdSpeed += accel * dt;
    fwdSpeed = Math.max(-300, fwdSpeed);
    fwdSpeed *= Math.pow(this.friction, dt * 60);

    if (track) {
      fwdSpeed *= Math.pow(track.getFrictionMultiplier(this.pos), dt * 60);
    }

    // Timer only counts when both conditions are active: sharp steer AND near top speed.
    // This prevents the ramp from being pre-charged before the speed threshold is crossed.
    if (Math.abs(this.currentSteer) > 0.5 && absSpeed > terminalVel * 0.7) {
      this._sharpSteerTime += dt;
    } else {
      this._sharpSteerTime = 0;
    }

    // Lateral dynamics: centrifugal force ramps in gradually after holding a sharp turn
    // for 0.25 s, reaching full strength at 0.65 s — prevents an abrupt snap into drift.
    if (absSpeed > terminalVel * 0.7 && this._sharpSteerTime > 0.25) {
      const ramp = Math.min(1, (this._sharpSteerTime - 0.25) / 0.4);
      const centrifugalAccel = this.currentSteer * fwdSpeed * 5.0 * ramp;
      latSpeed += centrifugalAccel * dt;
    }

    // Lateral grip: weakens at speed with steering → visible drift
    const driftFactor = Math.min(1, absSpeed / 300) * Math.abs(this.currentSteer);
    let lateralGrip = 0.85 - driftFactor * 0.35; // 0.50–0.85 range

    // Handbrake: inject lateral force from steering and kill rear grip
    if (handbrakeHeld && absSpeed > 30) {
      latSpeed += this.currentSteer * absSpeed * 0.055 * dt * 60;
      lateralGrip = Math.min(lateralGrip, 0.55);
      fwdSpeed *= Math.pow(0.97, dt * 60); // light drag
    }

    latSpeed *= Math.pow(lateralGrip, dt * 60);

    // Drift effects: proportional to how far latSpeed exceeds the drift threshold
    const driftRatio = Math.max(0, Math.abs(latSpeed) - driftThreshold) / driftThreshold;
    this.driftRatio = driftRatio;
    if (driftRatio > 0 && fwdSpeed > 0) {
      fwdSpeed *= Math.pow(1 - driftRatio * 0.005, dt * 60); // up to 0.5% speed bleed per frame at full drift
    }

    // Body rotation: always proportional to lateral slip so it builds/fades smoothly
    if (fwdSpeed > 0) {
      this.heading += latSpeed * 0.00035 * dt * 60;
    }

    // Recombine using updated heading axes
    const nFwdX = Math.cos(this.heading), nFwdY = Math.sin(this.heading);
    const nRightX = -Math.sin(this.heading), nRightY = Math.cos(this.heading);
    this.vel.x = nFwdX * fwdSpeed + nRightX * latSpeed;
    this.vel.y = nFwdY * fwdSpeed + nRightY * latSpeed;

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    const isDrifting = Math.abs(latSpeed) > 28;

    // Skid marks at rear tire positions when drifting, hard braking, or handbraking (not reversing)
    if ((isDrifting || (brakeHeld && fwdSpeed > 50) || (handbrakeHeld && absSpeed > 30)) && fwdSpeed >= 0) {
      const cs2 = Math.cos(this.heading), sn2 = Math.sin(this.heading);
      const hl = this.length / 2, hw = this.width / 2 - 4;
      const rearX = this.pos.x - cs2 * hl, rearY = this.pos.y - sn2 * hl;
      if (!this._skidActive) {
        this.skidMarks.push({ left: [], right: [] });
        this._skidActive = true;
      }
      const run = this.skidMarks[this.skidMarks.length - 1];
      run.left.push(new Vec2(rearX  + sn2 * hw, rearY  - cs2 * hw));
      run.right.push(new Vec2(rearX - sn2 * hw, rearY  + cs2 * hw));
      // Cap total skid mark points to avoid unbounded growth
      let total = this.skidMarks.reduce((n, r) => n + r.left.length, 0);
      while (total > 600 && this.skidMarks.length > 0) {
        total -= this.skidMarks[0].left.length;
        this.skidMarks.shift();
      }
    } else {
      this._skidActive = false;
    }

    // Smoke particles for hard braking (forward only) or drifting
    if (this.particles.length < 60 && (isDrifting || (brakeHeld && fwdSpeed > 80))) {
      const rearX = this.pos.x - Math.cos(this.heading) * 15;
      const rearY = this.pos.y - Math.sin(this.heading) * 15;
      this.particles.push(new Particle(
        new Vec2(rearX, rearY),
        new Vec2(Math.random() * 60 - 30, Math.random() * 60 - 30)
      ));
    }
    this.updateParticles(dt);
  }

  resolveCollisions(walls: Vec2[][]) {
    // Test 8 points on the car body (edge midpoints + corners) so the full
    // rectangular shape is represented, not just a centre circle.
    // r=8 ≈ half the visual barrier line width (15 px), so each point fires
    // when the car body just touches the barrier's road-facing edge.
    const cs = Math.cos(this.heading), sn = Math.sin(this.heading);
    const hl = this.length / 2, hw = this.width / 2;
    const r = 8;
    const localPts: [number, number][] = [
      [ hl,  0  ], [-hl,  0  ],  // front / rear midpoints
      [  0,  hw ], [  0, -hw ],  // right / left midpoints
      [ hl,  hw ], [ hl, -hw ],  // front corners
      [-hl,  hw ], [-hl, -hw ],  // rear corners
    ];

    let bestOverlap = 0;
    let bestNX = 0, bestNY = 0;
    let bestArmX = 0, bestArmY = 0;

    for (const [lx, ly] of localPts) {
      const px = this.pos.x + cs * lx - sn * ly;
      const py = this.pos.y + sn * lx + cs * ly;

      for (const poly of walls) {
        for (let i = 0; i < poly.length - 1; i++) {
          const p1 = poly[i], p2 = poly[i + 1];
          const wallX = p2.x - p1.x, wallY = p2.y - p1.y;
          const wallLen2 = wallX * wallX + wallY * wallY;
          if (wallLen2 === 0) continue;

          let t = ((px - p1.x) * wallX + (py - p1.y) * wallY) / wallLen2;
          t = Math.max(0, Math.min(1, t));

          const cx = p1.x + t * wallX, cy = p1.y + t * wallY;
          const dx = px - cx, dy = py - cy;
          const dist = Math.hypot(dx, dy);

          if (dist < r && dist > 0.001) {
            const overlap = r - dist;
            if (overlap > bestOverlap) {
              bestOverlap = overlap;
              bestNX = dx / dist;
              bestNY = dy / dist;
              bestArmX = px - this.pos.x; // world-space arm from centre to contact
              bestArmY = py - this.pos.y;
            }
          }
        }
      }
    }

    if (bestOverlap > 0) {
      this.pos.x += bestNX * bestOverlap;
      this.pos.y += bestNY * bestOverlap;

      const velDot = this.vel.x * bestNX + this.vel.y * bestNY;
      if (velDot < 0) {
        this.vel.x -= velDot * bestNX;
        this.vel.y -= velDot * bestNY;
        this.vel.x *= 0.45;
        this.vel.y *= 0.45;

        const torque = (bestArmX * bestNY - bestArmY * bestNX) * Math.abs(velDot);
        this.angularVel += torque * 0.00004;
        this.angularVel = Math.max(-3, Math.min(3, this.angularVel));
      }
    }
  }
  updateParticles(dt: number) {
    this.particles.forEach(p => {
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.life -= dt * 2.0;
    });
    this.particles = this.particles.filter(p => p.life > 0);
  }

  getCorners(): Vec2[] {
    const sn = Math.sin(this.heading), cs = Math.cos(this.heading);
    const hw = this.width/2, hl = this.length/2;
    return [
      new Vec2(this.pos.x + cs*hl - sn*hw, this.pos.y + sn*hl + cs*hw),
      new Vec2(this.pos.x + cs*hl - sn*-hw, this.pos.y + sn*hl + cs*-hw),
      new Vec2(this.pos.x + cs*-hl - sn*-hw, this.pos.y + sn*-hl + cs*-hw),
      new Vec2(this.pos.x + cs*-hl - sn*hw, this.pos.y + sn*-hl + cs*hw)
    ];
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Draw skid marks (world-space, under car)
    ctx.save();
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(30, 20, 10, 0.30)';
    for (const run of this.skidMarks) {
      for (const track of [run.left, run.right]) {
        if (track.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(track[0].x, track[0].y);
        for (let i = 1; i < track.length; i++) ctx.lineTo(track[i].x, track[i].y);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Draw Particles
    ctx.save();
    this.particles.forEach(p => {
      ctx.fillStyle = `rgba(200, 200, 200, ${p.life * 0.5})`;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // Draw Car (top-down view; +x = front, +y = right side)
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.heading);

    const hl = this.length / 2, hw = this.width / 2;

    // Main body
    ctx.fillStyle = '#c62828';
    ctx.fillRect(-hl, -hw, this.length, this.width);

    // Hood (front ~38%, lighter red)
    ctx.fillStyle = '#e53935';
    ctx.fillRect(hl * 0.24, -hw + 2, hl * 0.76, hw * 2 - 4);

    // Windshield (front glass)
    ctx.fillStyle = 'rgba(140, 215, 255, 0.88)';
    ctx.fillRect(hl * 0.08, -hw + 4, hl * 0.36, hw * 2 - 8);

    // Cockpit roof (dark center)
    ctx.fillStyle = '#111';
    ctx.fillRect(-hl * 0.08, -hw + 5, hl * 0.40, hw * 2 - 10);

    // Rear window
    ctx.fillStyle = 'rgba(140, 215, 255, 0.60)';
    ctx.fillRect(-hl * 0.50, -hw + 4, hl * 0.36, hw * 2 - 8);

    // Front headlights
    ctx.fillStyle = '#fffde7';
    ctx.fillRect(hl - 3, -hw + 2, 6, 7);
    ctx.fillRect(hl - 3,  hw - 9, 6, 7);

    // Tail lights
    ctx.fillStyle = '#d50000';
    ctx.fillRect(-hl - 3, -hw + 2, 6, 7);
    ctx.fillRect(-hl - 3,  hw - 9, 6, 7);

    // Side mirrors
    ctx.fillStyle = '#555';
    ctx.fillRect(hl * 0.18, -hw - 5, hl * 0.28, 5);
    ctx.fillRect(hl * 0.18,  hw,     hl * 0.28, 5);

    ctx.restore();
  }
}