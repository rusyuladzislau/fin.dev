import { Component, inject } from '@angular/core';
import { ProducerService } from '../../../entities/producer';
import { ButtonComponent } from '../../../shared/ui/button';
import { SvgIconComponent } from '../../../shared/ui/svg-icon';

@Component({
  selector: 'app-toggle-producer',
  imports: [ButtonComponent, SvgIconComponent],
  templateUrl: './toggle-producer.component.html',
})
export class ToggleProducerComponent {
  protected readonly producer = inject(ProducerService);

  protected toggleProducer(): void {
    if (this.producer.status() === 'running') {
      this.producer.pause();
    } else if (this.producer.status() === 'paused') {
      this.producer.resume();
    }
  }

  protected retry(): void {
    this.producer.applySettings({ ...this.producer.activeSettings() });
  }
}
