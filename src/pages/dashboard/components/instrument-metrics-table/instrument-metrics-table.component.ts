import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { InstrumentMetrics } from '../../../../entities/instrument';

@Component({
  selector: 'app-instrument-metrics-table',
  imports: [CurrencyPipe, DecimalPipe],
  templateUrl: './instrument-metrics-table.component.html',
  host: { class: 'block' },
})
export class InstrumentMetricsTableComponent {
  readonly instruments = input.required<InstrumentMetrics[]>();
  readonly hasError = input(false);
}
