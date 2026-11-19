import { InstrumentMetrics } from '../../instrument';
import { ProducerSettings, ProducerStatus } from '../model/producer.models';

export const MAX_INITIALIZATION_ATTEMPTS = 5;

export interface ProducerWorkerState {
  runId: number;
  settings: ProducerSettings;
  status: ProducerStatus;
  instruments: InstrumentMetrics[];
  error: string | null;
  initializationAttempt: number;
}

export type WorkerCommand =
  | { type: 'attach'; wasmBaseUrl: string }
  | { type: 'detach' }
  | { type: 'apply-settings'; settings: ProducerSettings }
  | { type: 'pause' | 'resume'; runId: number };

export interface WorkerEvent {
  type: 'state';
  state: ProducerWorkerState;
}
