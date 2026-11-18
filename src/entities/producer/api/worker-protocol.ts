import { InstrumentMetrics } from '../../instrument';
import { ProducerSettings, ProducerStatus } from '../model/producer.models';

interface WorkerMessage {
  runId: number;
}

export type WorkerCommand =
  | (WorkerMessage & {
      type: 'initialize';
      settings: ProducerSettings;
      wasmBaseUrl: string;
    })
  | (WorkerMessage & { type: 'pause' })
  | (WorkerMessage & { type: 'resume' })
  | (WorkerMessage & { type: 'dispose' });

export type WorkerEvent =
  | (WorkerMessage & {
      type: 'ready';
      instruments: string[];
    })
  | (WorkerMessage & {
      type: 'snapshot';
      instruments: InstrumentMetrics[];
    })
  | (WorkerMessage & {
      type: 'status';
      status: Exclude<ProducerStatus, 'initializing' | 'error'>;
    })
  | (WorkerMessage & {
      type: 'error';
      message: string;
    });
