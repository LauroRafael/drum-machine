import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SequencerService } from '../../core/services/sequencer.service';

@Component({
  selector: 'app-step-grid',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './step-grid.component.html'
})
export class StepGridComponent {
  sequencer = inject(SequencerService);
}
