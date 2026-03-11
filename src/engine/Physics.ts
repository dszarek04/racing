export class Vec2 {
  constructor(public x: number = 0, public y: number = 0) {}
  add(v: Vec2)    { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v: Vec2)    { return new Vec2(this.x - v.x, this.y - v.y); }
  mult(s: number) { return new Vec2(this.x * s, this.y * s); }
  dot(v: Vec2)    { return this.x * v.x + this.y * v.y; }
  mag()           { return Math.hypot(this.x, this.y); }
  normalize()     { const m = this.mag(); return m === 0 ? new Vec2() : new Vec2(this.x / m, this.y / m); }
}
