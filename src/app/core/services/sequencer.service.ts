import { Injectable, signal, computed, effect } from '@angular/core';
import { AudioService } from './audio.service';

export interface Channel {
  id: string;
  name: string;
  steps: boolean[];
  volume: number;
  mute: boolean;
  solo: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class SequencerService {
  // Config
  private lookahead = 25.0; // ms
  private scheduleAheadTime = 0.1; // s
  private nextNoteTime = 0.0;
  private current16thNote = 0;
  private timerID: any;

  // Reactivity state
  bpm = signal<number>(96);
  swing = signal<number>(0); // 0 to 100%
  isPlaying = signal<boolean>(false);
  currentStep = signal<number>(0);

  timeSignature = signal<'4/4' | '3/4' | '12/8'>('4/4');
  stepsPerPage = computed(() => this.timeSignature() === '4/4' ? 16 : 12);
  stepsCount = computed(() => this.pagesCount() * this.stepsPerPage());

  pagesCount = signal<number>(1);
  viewPage = signal<number>(0);
  metronomeEnabled = signal<boolean>(false);
  currentKit = signal<string>('default');
  currentFx = signal<string>('none');
  masterVolume = signal<number>(0.8);

  channels = signal<Channel[]>([
    { id: 'kick', name: 'Kick', steps: Array(16).fill(false), volume: 1, mute: false, solo: false },
    { id: 'snare', name: 'Snare', steps: Array(16).fill(false), volume: 1, mute: false, solo: false },
    { id: 'hihat', name: 'Hihat', steps: Array(16).fill(false), volume: 1, mute: false, solo: false },
    { id: 'crash', name: 'Crash', steps: Array(16).fill(false), volume: 1, mute: false, solo: false },
    { id: 'ride', name: 'Ride', steps: Array(16).fill(false), volume: 1, mute: false, solo: false },
    { id: 'tom1', name: 'Tom 1', steps: Array(16).fill(false), volume: 1, mute: false, solo: false },
    { id: 'tom2', name: 'Tom 2', steps: Array(16).fill(false), volume: 1, mute: false, solo: false },
    { id: 'tom3', name: 'Tom 3', steps: Array(16).fill(false), volume: 1, mute: false, solo: false }
  ]);

  constructor(private audioService: AudioService) { }

  addPage() {
    this.pagesCount.update(p => p + 1);
    this.channels.update(chans => {
      chans.forEach(c => {
        c.steps.push(...Array(this.stepsPerPage()).fill(false));
      });
      return [...chans];
    });
  }

  removePage() {
    if (this.pagesCount() <= 1) return;
    this.pagesCount.update(p => p - 1);
    this.channels.update(chans => {
      chans.forEach(c => c.steps.splice(-this.stepsPerPage()));
      return [...chans];
    });
    if (this.viewPage() >= this.pagesCount()) {
      this.viewPage.set(this.pagesCount() - 1);
    }
  }

  nextViewPage() {
    if (this.viewPage() < this.pagesCount() - 1) {
      this.viewPage.update(v => v + 1);
    }
  }

  prevViewPage() {
    if (this.viewPage() > 0) {
      this.viewPage.update(v => v - 1);
    }
  }

  toggleStep(channelId: string, globalStepIndex: number) {
    let turnedOn = false;
    let volume = 1;
    this.channels.update(chans => {
      const channel = chans.find(c => c.id === channelId);
      if (channel && channel.name !== '-') {
        channel.steps[globalStepIndex] = !channel.steps[globalStepIndex];
        turnedOn = channel.steps[globalStepIndex];
        volume = channel.volume;
      }
      return [...chans];
    });

    // Play preview sound when activating the pad
    if (turnedOn) {
      this.audioService.playSound(channelId, undefined, volume);
    }
  }

  setChannelVolume(channelId: string, volume: number) {
    this.channels.update(chans => {
      const channel = chans.find(c => c.id === channelId);
      if (channel) channel.volume = volume;
      return [...chans];
    });
  }

  setMute(channelId: string, mute: boolean) {
    this.channels.update(chans => {
      const channel = chans.find(c => c.id === channelId);
      if (channel) channel.mute = mute;
      return [...chans];
    });
  }

  setSolo(channelId: string, solo: boolean) {
    this.channels.update(chans => {
      const channel = chans.find(c => c.id === channelId);
      if (channel) channel.solo = solo;
      return [...chans];
    });
  }

  togglePlay() {
    if (this.isPlaying()) {
      this.stop();
    } else {
      this.play();
    }
  }

  play() {
    this.audioService.init(); // ensure context is ready
    this.isPlaying.set(true);
    this.current16thNote = 0;
    this.nextNoteTime = this.audioService.context.currentTime + 0.05;
    this.scheduler();
  }

  stop() {
    this.isPlaying.set(false);
    clearTimeout(this.timerID);
  }

  reset() {
    this.currentStep.set(0);
    this.current16thNote = 0;
  }

  clearAll() {
    this.channels.update(chans => {
      chans.forEach(c => c.steps.fill(false));
      return [...chans];
    });
  }

  setChannelName(channelId: string, name: string) {
    this.channels.update(chans => {
      const channel = chans.find(c => c.id === channelId);
      if (channel) {
        channel.name = name;
      }
      return [...chans];
    });
  }

  private nextNote() {
    const minBpm = Math.max(1, this.bpm());
    const secondsPerBeat = 60.0 / minBpm;

    // Apply swing roughly to the 2nd and 4th 16th notes (even index 1, 3, etc)
    let stepDuration = 0.25 * secondsPerBeat;

    // If it's an even index (e.g., e and a), add swing delay
    if (this.current16thNote % 2 === 0) {
      // odd step (1, 3, ..) is longer
      stepDuration += (this.swing() / 100) * 0.1 * secondsPerBeat;
    } else {
      // even step is shorter
      stepDuration -= (this.swing() / 100) * 0.1 * secondsPerBeat;
    }

    this.nextNoteTime += stepDuration;
    this.current16thNote++;
    if (this.current16thNote >= this.stepsCount()) {
      this.current16thNote = 0;
    }
  }

  private scheduleNote(beatNumber: number, time: number) {
    // Schedule visual update. We use setTimeout to update currentStep closer to the actual auditory moment.
    // However, for perfect sync, a common pattern is pushing visual cues to a queue and checking them in rAF.
    // For simplicity, a timeout from the scheduler works reasonably well, or relying directly on the update.
    const timeUntilNote = (time - this.audioService.context.currentTime) * 1000;

    // Defer visual state update
    setTimeout(() => {
      if (this.isPlaying()) {
        this.currentStep.set(beatNumber);
        const currentPage = Math.floor(beatNumber / this.stepsPerPage());
        if (this.viewPage() !== currentPage) {
          this.viewPage.set(currentPage);
        }
      }
    }, Math.max(0, timeUntilNote));

    // Play sounds
    const anySolo = this.channels().some(c => c.solo);

    this.channels().forEach(channel => {
      if (channel.steps[beatNumber]) {
        // Evaluate Mute/Solo
        let shouldPlay = !channel.mute;
        if (anySolo) {
          shouldPlay = channel.solo;
        }

        if (shouldPlay) {
          this.audioService.playSound(channel.id, time, channel.volume);
        }
      }
    });

    // Metronome tick logic
    const ts = this.timeSignature();
    const metroModulo = ts === '12/8' ? 3 : 4;
    if (this.metronomeEnabled() && beatNumber % metroModulo === 0) {
      const isFirstBeat = beatNumber % this.stepsPerPage() === 0;
      if (this.audioService.hasBuffer('metro')) {
        this.audioService.playSound('metro', time, 1, isFirstBeat ? 1.5 : 1.0);
      } else {
        // Fallback to synthesized beep if metro.wav is broken/missing
        this.audioService.playBeep(time, isFirstBeat ? 880 : 440);
      }
    }
  }

  private scheduler() {
    if (!this.isPlaying()) return;

    while (this.nextNoteTime < this.audioService.context.currentTime + this.scheduleAheadTime) {
      this.scheduleNote(this.current16thNote, this.nextNoteTime);
      this.nextNote();
    }

    this.timerID = setTimeout(() => this.scheduler(), this.lookahead);
  }

  exportPattern(): string {
    const state = {
      bpm: this.bpm(),
      swing: this.swing(),
      timeSignature: this.timeSignature(),
      stepsCount: this.stepsCount(),
      pagesCount: this.pagesCount(),
      kit: this.currentKit(),
      fx: this.currentFx(),
      metronome: this.metronomeEnabled(),
      masterVolume: this.masterVolume(),
      channels: this.channels().map(ch => ({
        id: ch.id,
        name: ch.name,
        steps: ch.steps,
        volume: ch.volume,
        mute: ch.mute,
        solo: ch.solo,
      })),
    };
    return JSON.stringify(state, null, 2);
  }

  /**
   * Import pattern from JSON. Returns the parsed state so callers can
   * apply side-effects like loading a drum kit or setting FX.
   */
  importPattern(json: string): any | null {
    try {
      const state = JSON.parse(json);
      if (state.bpm) this.bpm.set(state.bpm);
      if (state.swing !== undefined) this.swing.set(state.swing);
      if (state.timeSignature) this.timeSignature.set(state.timeSignature);
      if (state.metronome !== undefined) this.metronomeEnabled.set(state.metronome);
      if (state.masterVolume !== undefined) this.masterVolume.set(state.masterVolume);
      if (state.kit) this.currentKit.set(state.kit);
      if (state.fx) this.currentFx.set(state.fx);

      if (state.pagesCount) {
        this.pagesCount.set(state.pagesCount);
        this.viewPage.set(0);
      } else if (state.stepsCount) {
        const cpp = state.timeSignature === '4/4' ? 16 : 12;
        this.pagesCount.set(Math.ceil(state.stepsCount / cpp));
        this.viewPage.set(0);
      }

      if (state.channels) this.channels.set(state.channels);
      return state;
    } catch (e) {
      console.error('Failed to import pattern', e);
      return null;
    }
  }
}
