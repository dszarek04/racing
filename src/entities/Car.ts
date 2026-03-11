import { Vec2 } from '../engine/Physics';
import { Input } from '../utils/Input';
import { CAR, TIRE_MARKS } from '../config';

interface TireMarkRun {
  left:      Vec2[];
  right:     Vec2[];
  createdAt: number;
}

interface SmokeParticle {
  pos:  Vec2;
  vel:  Vec2;
  life: number;
}

export class Car {
  pos:        Vec2 = new Vec2();
  vel:        Vec2 = new Vec2();
  heading:    number = 0;
  angularVel: number = 0;

  readonly width  = CAR.WIDTH;
  readonly length = CAR.LENGTH;

  currentSteer = 0;
  squealIntensity = 0;

  tireMarks: TireMarkRun[] = [];
  particles: SmokeParticle[] = [];

  private elapsedTime    = 0;
  private tireMarkActive = false;

  constructor(x: number, y: number, heading: number) {
    this.pos     = new Vec2(x, y);
    this.heading = heading;
  }

  update(dt: number, input: Input, track?: import('./Track').Track) {
    this.elapsedTime += dt;

    const cos = Math.cos(this.heading);
    const sin = Math.sin(this.heading);

    let fwdSpeed = this.vel.x * cos  + this.vel.y * sin;
    let latSpeed = this.vel.x * -sin + this.vel.y * cos;

    // Steering
    const rawSteer   = input.right - input.left;
    const steerInput = fwdSpeed < -5 ? -rawSteer : rawSteer;
    this.currentSteer += (steerInput - this.currentSteer) * (1 - Math.pow(CAR.STEER_SMOOTH, dt * 60));
    if (Math.abs(fwdSpeed) > 5) {
      const turnFactor =
        Math.min(Math.abs(fwdSpeed) / CAR.TURN_BUILD_SPEED, 1) /
        (1 + Math.abs(fwdSpeed) / CAR.TURN_HIGH_SPEED_DIVISOR);
      this.heading += this.currentSteer * CAR.TURN_SPEED * turnFactor * dt * 60;
    }

    // Collision angular velocity
    this.heading    += this.angularVel * dt;
    this.angularVel *= Math.pow(CAR.COLLISION_ANGULAR_DECAY, dt * 60);

    // Pedals: W + S together = coast
    const throttleHeld = !!(input.keys[input.bindings.throttle] || input.keys['arrowup']);
    const brakeHeld    = !!(input.keys[input.bindings.brake]    || input.keys['arrowdown']);
    const coasting     = throttleHeld && brakeHeld;

    let accel = 0;
    if (!coasting) {
      if (throttleHeld) {
        accel = fwdSpeed < 0
          ? CAR.ACCELERATION * input.throttle * CAR.REVERSE_ACCEL_MULTIPLIER
          : CAR.ACCELERATION * input.throttle;
      } else if (brakeHeld) {
        accel = fwdSpeed > 10
          ? -CAR.ACCELERATION * CAR.BRAKE_ACCEL_MULTIPLIER * input.brake
          : -CAR.ACCELERATION * input.brake;
      }
    }

    fwdSpeed += accel * dt;
    fwdSpeed  = Math.max(-CAR.MAX_REVERSE_SPEED, fwdSpeed);
    fwdSpeed *= Math.pow(CAR.FRICTION, dt * 60);

    if (track) {
      fwdSpeed *= Math.pow(track.getFrictionMultiplier(this.pos), dt * 60);
      // Per-track top speed cap: clamp forward speed to base equilibrium * multiplier.
      // Base top speed ≈ ACCELERATION / (1 - FRICTION) ≈ 520 / 0.013 ≈ 667 px/s.
      const BASE_TOP_SPEED = CAR.ACCELERATION / (1 - CAR.FRICTION);
      const topCap = BASE_TOP_SPEED * track.topSpeedMultiplier;
      if (fwdSpeed > topCap) fwdSpeed = topCap;
    }

    latSpeed *= Math.pow(CAR.LATERAL_GRIP, dt * 60);

    if (fwdSpeed > 0) {
      this.heading += latSpeed * CAR.LATERAL_BODY_ROTATION * dt * 60;
    }

    const nc = Math.cos(this.heading), ns = Math.sin(this.heading);
    this.vel.x = nc * fwdSpeed + -ns * latSpeed;
    this.vel.y = ns * fwdSpeed +  nc * latSpeed;

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    this.updateTireEffects(dt, fwdSpeed, input, brakeHeld);
  }

  private updateTireEffects(
    dt: number,
    fwdSpeed: number,
    input: Input,
    brakeHeld: boolean,
  ) {
    const hardBraking =
      brakeHeld &&
      fwdSpeed > TIRE_MARKS.BRAKE_SPEED_THRESHOLD &&
      input.brake > TIRE_MARKS.BRAKE_INPUT_THRESHOLD;

    this.squealIntensity = hardBraking
      ? Math.min(1, (fwdSpeed - TIRE_MARKS.BRAKE_SPEED_THRESHOLD) / 200)
      : 0;

    if (hardBraking) {
      const cs = Math.cos(this.heading), sn = Math.sin(this.heading);
      const hl = this.length / 2, hw = this.width / 2 - 4;
      const rearX = this.pos.x - cs * hl;
      const rearY = this.pos.y - sn * hl;

      if (!this.tireMarkActive) {
        this.tireMarks.push({ left: [], right: [], createdAt: this.elapsedTime });
        this.tireMarkActive = true;
      }
      const run = this.tireMarks[this.tireMarks.length - 1];
      run.left.push( new Vec2(rearX + sn * hw, rearY - cs * hw));
      run.right.push(new Vec2(rearX - sn * hw, rearY + cs * hw));

      // Trim oldest runs when the total point budget is exceeded
      let total = this.tireMarks.reduce((n, r) => n + r.left.length, 0);
      while (total > TIRE_MARKS.MAX_POINTS && this.tireMarks.length > 0) {
        total -= this.tireMarks[0].left.length;
        this.tireMarks.shift();
      }

      if (this.particles.length < TIRE_MARKS.SMOKE_MAX && fwdSpeed > TIRE_MARKS.SMOKE_SPEED_THRESHOLD) {
        this.particles.push({
          pos:  new Vec2(rearX, rearY),
          vel:  new Vec2(Math.random() * 50 - 25, Math.random() * 50 - 25),
          life: 1.0,
        });
      }
    } else {
      this.tireMarkActive = false;
    }

    for (const p of this.particles) {
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.life  -= dt * 1.8;
    }
    this.particles = this.particles.filter(p => p.life > 0);
    this.tireMarks = this.tireMarks.filter(
      r => this.elapsedTime - r.createdAt < TIRE_MARKS.FADE_DURATION
    );
  }

  resolveCollisions(walls: Vec2[][]) {
    const cos = Math.cos(this.heading), sin = Math.sin(this.heading);
    const hl = this.length / 2, hw = this.width / 2;
    const r  = CAR.COLLISION_POINT_RADIUS;

    const localPoints: [number, number][] = [
      [ hl,  0], [-hl,  0],
      [  0, hw], [  0, -hw],
      [ hl, hw], [ hl, -hw],
      [-hl, hw], [-hl, -hw],
    ];

    let bestOverlap = 0;
    let bestNX = 0, bestNY = 0;
    let bestArmX = 0, bestArmY = 0;

    for (const [lx, ly] of localPoints) {
      const px = this.pos.x + cos * lx - sin * ly;
      const py = this.pos.y + sin * lx + cos * ly;

      for (const poly of walls) {
        for (let i = 0; i < poly.length - 1; i++) {
          const p1 = poly[i], p2 = poly[i + 1];
          const wx = p2.x - p1.x, wy = p2.y - p1.y;
          const len2 = wx * wx + wy * wy;
          if (len2 === 0) continue;

          const t = Math.max(0, Math.min(1, ((px - p1.x) * wx + (py - p1.y) * wy) / len2));
          const cx = p1.x + t * wx, cy = p1.y + t * wy;
          const dx = px - cx, dy = py - cy;
          const dist = Math.hypot(dx, dy);

          if (dist < r && dist > 0.001) {
            const overlap = r - dist;
            if (overlap > bestOverlap) {
              bestOverlap = overlap;
              bestNX = dx / dist;
              bestNY = dy / dist;
              bestArmX = px - this.pos.x;
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
        this.vel.x *= CAR.COLLISION_RESTITUTION;
        this.vel.y *= CAR.COLLISION_RESTITUTION;

        const torque = (bestArmX * bestNY - bestArmY * bestNX) * Math.abs(velDot);
        this.angularVel = Math.max(
          -CAR.COLLISION_MAX_ANGULAR_VEL,
          Math.min(CAR.COLLISION_MAX_ANGULAR_VEL, this.angularVel + torque * CAR.COLLISION_ANGULAR_FACTOR)
        );
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    this.drawTireMarks(ctx);
    this.drawSmoke(ctx);
    this.drawBody(ctx);
  }

  private drawTireMarks(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.lineWidth = TIRE_MARKS.LINE_WIDTH;
    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';
    for (const run of this.tireMarks) {
      const age     = this.elapsedTime - run.createdAt;
      const opacity = Math.max(0, TIRE_MARKS.OPACITY * (1 - age / TIRE_MARKS.FADE_DURATION));
      ctx.strokeStyle = `rgba(30,20,10,${opacity.toFixed(3)})`;
      for (const side of [run.left, run.right]) {
        if (side.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(side[0].x, side[0].y);
        for (let i = 1; i < side.length; i++) ctx.lineTo(side[i].x, side[i].y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawSmoke(ctx: CanvasRenderingContext2D) {
    ctx.save();
    for (const p of this.particles) {
      const r = 3 + (1 - p.life) * 5;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,220,220,${(p.life * 0.45).toFixed(3)})`;
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBody(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.heading);

    const hl = this.length / 2;
    const hw = this.width  / 2;

    // Base body
    ctx.fillStyle = '#c62828';
    ctx.fillRect(-hl, -hw, this.length, this.width);

    // Hood
    ctx.fillStyle = '#e53935';
    ctx.fillRect(hl * 0.24, -hw + 2, hl * 0.76, hw * 2 - 4);

    // Windscreen
    ctx.fillStyle = 'rgba(140,215,255,0.88)';
    ctx.fillRect(hl * 0.08, -hw + 4, hl * 0.36, hw * 2 - 8);

    // Cockpit / roll bar
    ctx.fillStyle = '#111';
    ctx.fillRect(-hl * 0.08, -hw + 5, hl * 0.40, hw * 2 - 10);

    // Rear screen
    ctx.fillStyle = 'rgba(140,215,255,0.60)';
    ctx.fillRect(-hl * 0.50, -hw + 4, hl * 0.36, hw * 2 - 8);

    // Front headlights
    ctx.fillStyle = '#fffde7';
    ctx.fillRect(hl - 3, -hw + 2, 6, 7);
    ctx.fillRect(hl - 3,  hw - 9, 6, 7);

    // Rear lights
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
