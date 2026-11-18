import { DecimalPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { ProducerService } from '../../entities/producer';
import { InstrumentMetricsTableComponent } from './components/instrument-metrics-table/instrument-metrics-table.component';
import { ToggleProducerComponent } from '../../features/producer/toggle-producer';
import { StatusBadgeComponent, StatusTone } from '../../shared/ui/status-badge';
import { SvgIconComponent } from '../../shared/ui/svg-icon';

@Component({
  selector: 'app-dashboard-page',
  imports: [
    DecimalPipe,
    InstrumentMetricsTableComponent,
    ToggleProducerComponent,
    StatusBadgeComponent,
    SvgIconComponent,
  ],
  templateUrl: './dashboard-page.component.html',
})
export class DashboardPageComponent {
  protected readonly producer = inject(ProducerService);
  protected readonly statusTone = computed<StatusTone>(() => {
    switch (this.producer.status()) {
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
