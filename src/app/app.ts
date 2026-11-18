import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ProducerService } from '../entities/producer';
import { StatusBadgeComponent, StatusTone } from '../shared/ui/status-badge';
import { SvgIconComponent } from '../shared/ui/svg-icon';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, StatusBadgeComponent, SvgIconComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly producer = inject(ProducerService);
  protected readonly status = this.producer.status;
  protected readonly statusTone = computed<StatusTone>(() => {
    switch (this.status()) {
      case 'running':
        return 'success';
      case 'paused':
      case 'initializing':
        return 'warning';
      case 'error':
        return 'danger';
    }
  });
}
