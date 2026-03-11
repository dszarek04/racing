import { AUDIO } from '../config';

export class AudioEngine {
  private ctx:         AudioContext      | null = null;
  private engOsc1:     OscillatorNode    | null = null;
  private engOsc2:     OscillatorNode    | null = null;
  private engFilter:   BiquadFilterNode  | null = null;
  private engGain:     GainNode          | null = null;
  private squealGain:  GainNode          | null = null;
  private squealFilter: BiquadFilterNode | null = null;

  init() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;

    // Engine: two detuned sawtooth oscillators through a lowpass filter
    this.engOsc1 = ctx.createOscillator();
    this.engOsc1.type = 'sawtooth';
    this.engOsc1.frequency.value = AUDIO.ENGINE_IDLE_FREQ;

    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'sawtooth';
    this.engOsc2.frequency.value = AUDIO.ENGINE_IDLE_FREQ * AUDIO.DETUNE_RATIO;

    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = AUDIO.ENGINE_IDLE_FILTER;
    this.engFilter.Q.value = AUDIO.ENGINE_FILTER_Q;

    this.engGain = ctx.createGain();
    this.engGain.gain.value = AUDIO.ENGINE_GAIN;

    this.engOsc1.connect(this.engFilter);
    this.engOsc2.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(ctx.destination);
    this.engOsc1.start();
    this.engOsc2.start();

    // Tire squeal: looped white noise through a bandpass filter
    const bufLen = ctx.sampleRate * 2;
    const buf  = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop   = true;

    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 1100;
    this.squealFilter.Q.value = 8;

    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;

    noise.connect(this.squealFilter);
    this.squealFilter.connect(this.squealGain);
    this.squealGain.connect(ctx.destination);
    noise.start();
  }

  update(speed: number, topSpeed: number, squealIntensity = 0) {
    if (!this.ctx) return;
    const t    = this.ctx.currentTime;
    const norm = Math.min(Math.abs(speed) / topSpeed, 1);
    const freq = AUDIO.ENGINE_IDLE_FREQ + norm * (AUDIO.ENGINE_TOP_FREQ - AUDIO.ENGINE_IDLE_FREQ);

    this.engGain!.gain.setTargetAtTime(AUDIO.ENGINE_GAIN, t, 0.4);
    this.engOsc1!.frequency.setTargetAtTime(freq, t, AUDIO.ENGINE_FREQ_SMOOTH);
    this.engOsc2!.frequency.setTargetAtTime(freq * AUDIO.DETUNE_RATIO, t, AUDIO.ENGINE_FREQ_SMOOTH);
    this.engFilter!.frequency.setTargetAtTime(
      AUDIO.ENGINE_IDLE_FILTER + norm * (AUDIO.ENGINE_TOP_FILTER - AUDIO.ENGINE_IDLE_FILTER),
      t, AUDIO.ENGINE_FREQ_SMOOTH
    );

    if (this.squealGain && this.squealFilter) {
      this.squealGain.gain.setTargetAtTime(Math.min(squealIntensity, 1) * 0.18, t, 0.05);
      this.squealFilter.frequency.setTargetAtTime(900 + squealIntensity * 400, t, 0.05);
    }
  }

  silence() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engGain!.gain.setTargetAtTime(0, t, 0.12);
    this.squealGain!.gain.setTargetAtTime(0, t, 0.05);
  }

  playHorn() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t   = ctx.currentTime;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.linearRampToValueAtTime(155, t + 0.55);
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.9);
  }

  resume() {
    this.ctx?.resume();
  }
}
