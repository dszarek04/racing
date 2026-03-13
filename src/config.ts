// 1 metre = 20 pixels throughout the codebase.
export const SCALE = 20;

export const CAR = {
  WIDTH:  1.8 * SCALE,
  LENGTH: 4.0 * SCALE,

  ACCELERATION:              520,    // px/s^2 -> ~120 km/h top speed
  FRICTION:                  0.987,  // velocity multiplier applied each frame
  TURN_SPEED:                0.035,  // rad per frame (base)
  STEER_SMOOTH:              0.8,    // steering smoothing (raised to dt*60 per frame)
  TURN_BUILD_SPEED:          80,     // px/s at which turn factor reaches its peak
  TURN_HIGH_SPEED_DIVISOR:   350,    // higher = less turn reduction at speed
  REVERSE_ACCEL_MULTIPLIER:  2.0,    // extra force when counter-accelerating in reverse
  BRAKE_ACCEL_MULTIPLIER:    0.75,   // how hard the brakes bite relative to throttle
  MAX_REVERSE_SPEED:         300,    // px/s cap on reverse velocity

  LATERAL_GRIP:              0.90,   // per-frame lateral velocity retention (lower = more grip)
  LATERAL_BODY_ROTATION:     0.00035,

  COLLISION_POINT_RADIUS:    8,
  COLLISION_RESTITUTION:     0.45,
  COLLISION_ANGULAR_FACTOR:  0.00004,
  COLLISION_MAX_ANGULAR_VEL: 3,
  COLLISION_ANGULAR_DECAY:   0.9,
};

export const TIRE_MARKS = {
  BRAKE_SPEED_THRESHOLD: 80,    // px/s  -- below this no marks are laid
  BRAKE_INPUT_THRESHOLD: 0.35,  // 0-1 analogue brake floor
  FADE_DURATION:         8.0,   // seconds before marks disappear
  MAX_POINTS:            800,   // total points kept across all active runs
  LINE_WIDTH:            6,
  OPACITY:               0.35,
  SMOKE_MAX:             60,
  SMOKE_SPEED_THRESHOLD: 80,
};

export const CAMERA = {
  DEFAULT_ZOOM:     1.5,
  MIN_ZOOM:         0.5,
  MAX_ZOOM:         2.0,
  ZOOM_STEP_IN:     1.05,
  ZOOM_STEP_OUT:    0.95,
  SPEED_ZOOM_SCALE: 0.001, // zoom reduction per px/s of smoothed speed
  SPEED_SMOOTH:     0.08,  // lerp factor toward current speed each frame
};

export const AUDIO = {
  ENGINE_IDLE_FREQ:   55,    // Hz at standstill
  ENGINE_TOP_FREQ:    290,   // Hz at full speed
  ENGINE_FREQ_SMOOTH: 0.06,  // Web Audio setTargetAtTime time constant
  ENGINE_IDLE_FILTER: 200,   // lowpass cutoff Hz at idle
  ENGINE_TOP_FILTER:  1400,  // lowpass cutoff Hz at top speed
  ENGINE_GAIN:        0.06,
  ENGINE_FILTER_Q:    1.5,
  DETUNE_RATIO:       1.055, // frequency multiplier for the second oscillator
};

export const COUNTDOWN = {
  LIGHT_INTERVAL:  0.5,  // seconds per red light
  HOLD_MIN:        0.5,  // minimum hold time after all 5 lights are lit
  HOLD_MAX:        3.0,  // maximum total hold; actual is random between min and max
  GO_DISPLAY_TIME: 0.7,  // how long green lights stay visible after go
  FALSE_PENALTY:   5,    // penalty seconds added to the race timer
  BANNER_DURATION: 6,    // seconds the false-start penalty banner is shown
};

export const RACE = {
  DEFAULT_LAPS: 3,
  MIN_LAPS:     1,
  MAX_LAPS:     20,
};

export const RENDER = {
  /**
   * Fraction of the window resolution to render at.
   * 1.0 = full resolution (best quality).
   * 0.75 = 75% resolution (good balance for mid-range / mobile devices).
   * 0.5  = half resolution (best performance on low-end / mobile).
   */
  RESOLUTION_SCALE: 1.0,
};
