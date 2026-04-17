import { Injectable } from '@angular/core';

export interface SampleConfig {
  id: string;
  url?: string;
  urls?: string[];
  name: string;
}

interface ReverbPreset {
  delayTimes: number[];   // delay times in seconds for each tap
  feedbacks: number[];    // feedback gain per tap (0-0.95)
  lpFreq: number;         // low-pass filter frequency in feedback path
  wetMix: number;         // wet signal level
  dryMix: number;         // dry signal level
  preDelay: number;       // initial pre-delay in seconds
}

const REVERB_PRESETS: Record<string, ReverbPreset> = {
  studio: {
    delayTimes: [0.011, 0.017, 0.023, 0.031],
    feedbacks:  [0.55, 0.50, 0.45, 0.40],
    lpFreq: 6000,
    wetMix: 0.45,
    dryMix: 1.0,
    preDelay: 0.004,
  },
  gated: {
    delayTimes: [0.009, 0.013, 0.019, 0.029, 0.037, 0.043],
    feedbacks:  [0.70, 0.68, 0.65, 0.62, 0.58, 0.55],
    lpFreq: 8000,
    wetMix: 0.65,
    dryMix: 0.85,
    preDelay: 0.001,
  },
  hall: {
    delayTimes: [0.029, 0.043, 0.061, 0.079, 0.097, 0.113],
    feedbacks:  [0.82, 0.80, 0.78, 0.76, 0.74, 0.72],
    lpFreq: 3500,
    wetMix: 0.55,
    dryMix: 0.75,
    preDelay: 0.018,
  },
  chamber: {
    delayTimes: [0.017, 0.027, 0.037, 0.047, 0.059],
    feedbacks:  [0.72, 0.70, 0.67, 0.64, 0.60],
    lpFreq: 4500,
    wetMix: 0.50,
    dryMix: 0.85,
    preDelay: 0.008,
  },
  plate: {
    delayTimes: [0.013, 0.019, 0.031, 0.041, 0.053, 0.067],
    feedbacks:  [0.78, 0.76, 0.74, 0.72, 0.70, 0.68],
    lpFreq: 7000,
    wetMix: 0.55,
    dryMix: 0.80,
    preDelay: 0.002,
  },
  church: {
    delayTimes: [0.041, 0.059, 0.083, 0.107, 0.131, 0.157, 0.181, 0.199],
    feedbacks:  [0.88, 0.86, 0.85, 0.84, 0.83, 0.82, 0.80, 0.78],
    lpFreq: 2500,
    wetMix: 0.60,
    dryMix: 0.65,
    preDelay: 0.035,
  },
};

@Injectable({
  providedIn: 'root'
})
export class AudioService {
  private audioContext: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private masterGain: GainNode | null = null;

  // FX routing
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private fxInput: GainNode | null = null;         // taps feed from here
  private preDelayNode: DelayNode | null = null;

  // Current FDN tap nodes (cleaned up on preset change)
  private fxTapNodes: AudioNode[] = [];

  constructor() {}

  async init(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Master gain (all channel volumes go here)
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.8;

      // Dry path: masterGain -> dryGain -> destination
      this.dryGain = this.audioContext.createGain();
      this.dryGain.gain.value = 1.0;
      this.masterGain.connect(this.dryGain);
      this.dryGain.connect(this.audioContext.destination);

      // FX send path: masterGain -> preDelay -> fxInput -> [taps] -> wetGain -> destination
      this.preDelayNode = this.audioContext.createDelay(0.5);
      this.preDelayNode.delayTime.value = 0;

      this.fxInput = this.audioContext.createGain();
      this.fxInput.gain.value = 1.0;

      this.wetGain = this.audioContext.createGain();
      this.wetGain.gain.value = 0; // starts OFF

      this.masterGain.connect(this.preDelayNode);
      this.preDelayNode.connect(this.fxInput);
      this.wetGain.connect(this.audioContext.destination);
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  get context(): AudioContext {
    if (!this.audioContext) {
      throw new Error('AudioContext not initialized. Call init() first.');
    }
    return this.audioContext;
  }

  setMasterVolume(volume: number): void {
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(volume, this.context.currentTime, 0.01);
    }
  }

  /**
   * Build or tear down the FDN reverb network based on preset name.
   * Uses multiple parallel delay+filter+feedback taps — NO noise, clean sound.
   */
  setReverbEffect(type: string): void {
    if (!this.audioContext || !this.wetGain || !this.dryGain || !this.fxInput || !this.preDelayNode) return;

    const now = this.audioContext.currentTime;

    // Tear down existing taps
    this.destroyFxTaps();

    if (type === 'none') {
      this.wetGain.gain.setTargetAtTime(0, now, 0.05);
      this.dryGain.gain.setTargetAtTime(1.0, now, 0.05);
      return;
    }

    const preset = REVERB_PRESETS[type.toLowerCase()];
    if (!preset) return;

    const isGated = type.toLowerCase() === 'gated';

    // Build delay taps
    const tapCount = preset.delayTimes.length;
    const tapMixGain = 1.0 / Math.sqrt(tapCount); // normalize per-tap volume

    for (let i = 0; i < tapCount; i++) {
      // delay -> filter -> feedbackGain -> (back to delay + out to wetGain)
      const delay = this.audioContext.createDelay(1.0);
      delay.delayTime.value = preset.delayTimes[i];

      const filter = this.audioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = preset.lpFreq;
      filter.Q.value = 0.7;

      const feedback = this.audioContext.createGain();
      feedback.gain.value = preset.feedbacks[i];

      const tapGain = this.audioContext.createGain();
      tapGain.gain.value = tapMixGain;

      // fxInput -> delay -> filter -> feedback -> delay (loop)
      this.fxInput.connect(delay);
      delay.connect(filter);
      filter.connect(feedback);
      feedback.connect(delay); // feedback loop

      // Also send filtered output to wet bus
      filter.connect(tapGain);
      tapGain.connect(this.wetGain);

      // Track for cleanup
      this.fxTapNodes.push(delay, filter, feedback, tapGain);
    }

    // Set levels
    this.preDelayNode.delayTime.setTargetAtTime(preset.preDelay, now, 0.01);
    this.wetGain.gain.setTargetAtTime(preset.wetMix, now, 0.05);
    this.dryGain.gain.setTargetAtTime(preset.dryMix, now, 0.05);
  }

  private destroyFxTaps(): void {
    for (const node of this.fxTapNodes) {
      try { node.disconnect(); } catch (_) {}
    }
    this.fxTapNodes = [];
  }

  async loadSample(sample: SampleConfig, force: boolean = false): Promise<boolean> {
    if (!force && this.buffers.has(sample.id)) return true;

    const urlsToTry = sample.urls ? sample.urls : (sample.url ? [sample.url] : []);

    for (const url of urlsToTry) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
          this.buffers.set(sample.id, audioBuffer);
          return true;
        }
      } catch (error) {
        // Network error, try next URL
      }
    }

    console.warn(`Error loading sample ${sample.id} from any provided URLs`, urlsToTry);
    return false;
  }

  playSound(sampleId: string, time?: number, volume: number = 1, playbackRate: number = 1): void {
    if (!this.audioContext || !this.masterGain) return;

    const buffer = this.buffers.get(sampleId);
    if (!buffer) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;

    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = volume;

    source.connect(gainNode);
    gainNode.connect(this.masterGain);

    const playTime = time ?? this.audioContext.currentTime;
    source.start(playTime);
  }

  hasBuffer(sampleId: string): boolean {
    return this.buffers.has(sampleId);
  }

  playBeep(time?: number, frequency: number = 440): void {
    if (!this.audioContext || !this.masterGain) return;

    const osc = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    osc.type = 'triangle';
    osc.frequency.value = frequency;

    const playTime = time ?? this.audioContext.currentTime;
    gainNode.gain.setValueAtTime(0, playTime);
    gainNode.gain.linearRampToValueAtTime(0.5, playTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, playTime + 0.1);

    osc.connect(gainNode);
    gainNode.connect(this.masterGain);

    osc.start(playTime);
    osc.stop(playTime + 0.1);
  }
}
