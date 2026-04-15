import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { AudioService } from './core/services/audio.service';
import { SequencerService } from './core/services/sequencer.service';
import { StepGridComponent } from './components/step-grid/step-grid.component';
import { TransportControlsComponent } from './components/transport-controls/transport-controls.component';
import { ToastrService } from 'ngx-toastr';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, StepGridComponent, TransportControlsComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  private http = inject(HttpClient);
  audioService = inject(AudioService);
  sequencer = inject(SequencerService);
  toastr = inject(ToastrService);
  isReady = false;
  selectedPattern = '';

  private samplesToLoad = [
    { id: 'kick', url: '/assets/samples/kick.mp3', name: 'Kick' },
    { id: 'snare', url: '/assets/samples/snare.mp3', name: 'Snare' },
    { id: 'hihat', url: '/assets/samples/hihat.mp3', name: 'HiHat' },
    { id: 'crash', url: '/assets/samples/crash.mp3', name: 'Crash' },
    { id: 'ride', url: '/assets/samples/ride.mp3', name: 'Ride' },
    { id: 'tom1', url: '/assets/samples/tom1.mp3', name: 'Tom 1' },
    { id: 'tom2', url: '/assets/samples/tom2.mp3', name: 'Tom 2' },
    { id: 'tom3', url: '/assets/samples/tom3.mp3', name: 'Tom 3' },
  ];

  async initializeAudio() {
    await this.audioService.init();
    
    // Init default urls
    this.samplesToLoad = this.samplesToLoad.map(s => {
      return { 
        ...s, 
        urls: [
          `/assets/samples/default/${s.id}.mp3`,
          `/assets/samples/default/${s.id}.wav`
        ] 
      };
    });

    // Load initial defaults
    const loadPromises = this.samplesToLoad.map(s => this.audioService.loadSample(s));
    const results = await Promise.all(loadPromises);

    // Hardcode generic metronome sample loading
    await this.audioService.loadSample({
      id: 'metro',
      url: '/assets/samples/metro.wav',
      name: 'Metro'
    });
    
    this.samplesToLoad.forEach((s, idx) => {
      this.sequencer.setChannelName(s.id, results[idx] ? s.name.toUpperCase() : '-');
    });

    this.isReady = true;
    this.toastr.success('Sistema de Áudio Pronto!', 'Drum Machine');
  }

  async changeDrumKit(event: Event) {
    const kitName = (event.target as HTMLSelectElement).value;
    this.sequencer.currentKit.set(kitName);
    
    // Update URLs
    this.samplesToLoad = this.samplesToLoad.map(s => {
      return { 
        ...s, 
        urls: [
          `/assets/samples/${kitName}/${s.id}.mp3`,
          `/assets/samples/${kitName}/${s.id}.wav`
        ] 
      };
    });

    // Reload with force
    const loadPromises = this.samplesToLoad.map(s => this.audioService.loadSample(s, true));
    const results = await Promise.all(loadPromises);
    
    this.samplesToLoad.forEach((s, idx) => {
      this.sequencer.setChannelName(s.id, results[idx] ? s.name.toUpperCase() : '-');
    });

    if (results.some(r => !r)) {
      this.toastr.warning(`O kit ${kitName.toUpperCase()} tem samples faltando.`, 'Atenção');
    } else {
      this.toastr.success(`Kit ${kitName.toUpperCase()} carregado compelto!`, 'Concluído');
    }
  }

  changeEffect(event: Event) {
    const effectType = (event.target as HTMLSelectElement).value;
    this.sequencer.currentFx.set(effectType);
    this.audioService.setReverbEffect(effectType);
  }

  loadPresetPattern(event: Event) {
    const patternName = (event.target as HTMLSelectElement).value;
    if (!patternName) return;

    this.selectedPattern = patternName;

    this.http.get(`/assets/patterns/${patternName}.json`, { responseType: 'text' }).subscribe({
      next: async (json) => {
        const state = this.sequencer.importPattern(json);
        if (!state) {
          this.toastr.error('Falha ao carregar pattern.', 'Erro');
          return;
        }

        // Apply FX if preset defines one
        if (state.fx) {
          this.audioService.setReverbEffect(state.fx);
        }

        // Apply master volume if defined
        if (state.masterVolume !== undefined) {
          this.audioService.setMasterVolume(state.masterVolume);
        }

        // Load drum kit if defined
        if (state.kit) {
          await this.changeDrumKitByName(state.kit);
        }

        this.toastr.success(`Pattern ${patternName.toUpperCase()} carregado!`, 'Preset');
      },
      error: () => {
        this.toastr.error(`Não foi possível carregar o pattern "${patternName}".`, 'Erro');
        this.selectedPattern = '';
      }
    });
  }

  private async changeDrumKitByName(kitName: string) {
    this.sequencer.currentKit.set(kitName);
    this.samplesToLoad = this.samplesToLoad.map(s => ({
      ...s,
      urls: [
        `/assets/samples/${kitName}/${s.id}.mp3`,
        `/assets/samples/${kitName}/${s.id}.wav`
      ]
    }));
    const loadPromises = this.samplesToLoad.map(s => this.audioService.loadSample(s, true));
    const results = await Promise.all(loadPromises);
    this.samplesToLoad.forEach((s, idx) => {
      this.sequencer.setChannelName(s.id, results[idx] ? s.name.toUpperCase() : '-');
    });
  }
}
