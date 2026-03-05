export class AudioEngine {
  private ctx: AudioContext | null = null;

  // Engine
  private engOsc1: OscillatorNode | null = null;
  private engOsc2: OscillatorNode | null = null;
  private engFilter: BiquadFilterNode | null = null;
  private engGain: GainNode | null = null;

  // Drift squeal
  private driftGain: GainNode | null = null;
  private driftFilter: BiquadFilterNode | null = null;

  init() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    const ctx = this.ctx;

    // ── Engine: two detuned sawtooth oscillators → lowpass → gain ──
    this.engOsc1 = ctx.createOscillator();
    this.engOsc1.type = 'sawtooth';
    this.engOsc1.frequency.value = 55;

    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'sawtooth';
    this.engOsc2.frequency.value = 58; // slight detune → beating / richness

    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 250;
    this.engFilter.Q.value = 1.5;

    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.06;

    this.engOsc1.connect(this.engFilter);
    this.engOsc2.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(ctx.destination);

    this.engOsc1.start();
    this.engOsc2.start();

    // ── Drift squeal: white noise → bandpass → gain ──
    const bufLen = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;

    this.driftFilter = ctx.createBiquadFilter();
    this.driftFilter.type = 'bandpass';
    this.driftFilter.frequency.value = 900;
    this.driftFilter.Q.value = 6;

    this.driftGain = ctx.createGain();
    this.driftGain.gain.value = 0;

    noise.connect(this.driftFilter);
    this.driftFilter.connect(this.driftGain);
    this.driftGain.connect(ctx.destination);

    noise.start();
  }

  update(speed: number, topSpeed: number, driftRatio: number) {
    if (!this.ctx || !this.engOsc1 || !this.engOsc2 || !this.engFilter || !this.engGain || !this.driftGain || !this.driftFilter) return;

    const t = this.ctx.currentTime;
    const norm = Math.min(Math.abs(speed) / topSpeed, 1);

    // Engine pitch: 55 Hz idle → 290 Hz at top speed
    const freq = 55 + norm * 235;
    this.engOsc1.frequency.setTargetAtTime(freq,        t, 0.06);
    this.engOsc2.frequency.setTargetAtTime(freq * 1.055, t, 0.06);

    // Filter opens with speed for a revving character
    this.engFilter.frequency.setTargetAtTime(200 + norm * 1200, t, 0.06);

    // Squeal pitch rises slightly with drift intensity
    this.driftFilter.frequency.setTargetAtTime(800 + driftRatio * 400, t, 0.05);

    // Drift gain: proportional, max ~0.18
    this.driftGain.gain.setTargetAtTime(Math.min(driftRatio, 1) * 0.18, t, 0.05);
  }

  resume() {
    this.ctx?.resume();
  }
}
