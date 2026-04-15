import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SequencerService } from '../../core/services/sequencer.service';
import { AudioService } from '../../core/services/audio.service';

@Component({
  selector: 'app-transport-controls',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './transport-controls.component.html'
})
export class TransportControlsComponent {
  sequencer = inject(SequencerService);
  audioService = inject(AudioService);
  
  changeBpm(event: Event) {
    const input = event.target as HTMLInputElement;
    this.sequencer.bpm.set(input.valueAsNumber);
  }

  changeSwing(event: Event) {
    const input = event.target as HTMLInputElement;
    this.sequencer.swing.set(input.valueAsNumber);
  }

  exportJson() {
    const json = this.sequencer.exportPattern();
    const blob = new Blob([json], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'drum-pattern.json';
    a.click();
    window.URL.revokeObjectURL(url);
  }

  async importJson(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const state = this.sequencer.importPattern(text);
        if (!state) return;

        // Apply master volume
        if (state.masterVolume !== undefined) {
          this.audioService.setMasterVolume(state.masterVolume);
        }

        // Apply FX
        if (state.fx) {
          this.audioService.setReverbEffect(state.fx);
        }

        // Load drum kit samples
        if (state.kit) {
          await this.loadKit(state.kit);
        }
      } catch (err) {
        alert('Invalid JSON file.');
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  private async loadKit(kitName: string) {
    const sampleIds = ['kick', 'snare', 'hihat', 'crash', 'ride', 'tom1', 'tom2', 'tom3'];
    const samples = sampleIds.map(id => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      urls: [
        `/assets/samples/${kitName}/${id}.mp3`,
        `/assets/samples/${kitName}/${id}.wav`
      ]
    }));

    const results = await Promise.all(samples.map(s => this.audioService.loadSample(s, true)));
    samples.forEach((s, idx) => {
      this.sequencer.setChannelName(s.id, results[idx] ? s.name.toUpperCase() : '-');
    });
  }
}
