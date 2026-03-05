export class Vec2 {
  constructor(public x: number = 0, public y: number = 0) {}
  add(v: Vec2) { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v: Vec2) { return new Vec2(this.x - v.x, this.y - v.y); }
  mult(s: number) { return new Vec2(this.x * s, this.y * s); }
  dot(v: Vec2) { return this.x * v.x + this.y * v.y; }
  mag() { return Math.hypot(this.x, this.y); }
  normalize() { const m = this.mag(); return m === 0 ? new Vec2() : new Vec2(this.x/m, this.y/m); }
}

export class Physics {
  // Line segment intersection for boundaries
  static getIntersection(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): Vec2 | null {
    const s1_x = p1.x - p0.x, s1_y = p1.y - p0.y;
    const s2_x = p3.x - p2.x, s2_y = p3.y - p2.y;
    const s = (-s1_y * (p0.x - p2.x) + s1_x * (p0.y - p2.y)) / (-s2_x * s1_y + s1_x * s2_y);
    const t = ( s2_x * (p0.y - p2.y) - s2_y * (p0.x - p2.x)) / (-s2_x * s1_y + s1_x * s2_y);

    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
      return new Vec2(p0.x + (t * s1_x), p0.y + (t * s1_y));
    }
    return null;
  }
}