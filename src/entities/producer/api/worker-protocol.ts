import { InstrumentMetrics } from '../../instrument';
import { ProducerSettings, ProducerStatus } from '../model/producer.models';
import { isProducerSettings } from '../model/producer-settings';

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

const producerStatuses = new Set<ProducerStatus>(['initializing', 'running', 'paused', 'error']);

export function isWorkerCommand(input: unknown): input is WorkerCommand {
  if (!isRecord(input) || typeof input['type'] !== 'string') return false;

  switch (input['type']) {
    case 'attach':
      return typeof input['wasmBaseUrl'] === 'string' && input['wasmBaseUrl'].length > 0;
    case 'detach':
      return true;
    case 'apply-settings':
      return isProducerSettings(input['settings']);
    case 'pause':
    case 'resume':
      return isPositiveInteger(input['runId']);
    default:
      return false;
  }
}

export function isWorkerEvent(input: unknown): input is WorkerEvent {
  if (!isRecord(input) || input['type'] !== 'state' || !isRecord(input['state'])) return false;

  const state = input['state'];
  return (
    isPositiveInteger(state['runId']) &&
    isProducerSettings(state['settings']) &&
    typeof state['status'] === 'string' &&
    producerStatuses.has(state['status'] as ProducerStatus) &&
    Array.isArray(state['instruments']) &&
    state['instruments'].every(isInstrumentMetrics) &&
    (state['error'] === null || typeof state['error'] === 'string') &&
    isPositiveInteger(state['initializationAttempt'])
  );
}

function isInstrumentMetrics(input: unknown): input is InstrumentMetrics {
  return (
    isRecord(input) &&
    typeof input['instrument'] === 'string' &&
    isNullableNumber(input['lastPriceCents']) &&
    isNullableNumber(input['spreadCents']) &&
    typeof input['volume'] === 'number' &&
    Number.isFinite(input['volume']) &&
    input['volume'] >= 0 &&
    isNullableNumber(input['vwapCents']) &&
    (input['imbalance'] === null ||
      (typeof input['imbalance'] === 'number' &&
        Number.isFinite(input['imbalance']) &&
        input['imbalance'] >= -1 &&
        input['imbalance'] <= 1))
  );
}

function isNullableNumber(input: unknown): input is number | null {
  return input === null || (typeof input === 'number' && Number.isFinite(input));
}

function isPositiveInteger(input: unknown): input is number {
  return typeof input === 'number' && Number.isInteger(input) && input > 0;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}
