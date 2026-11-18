export interface ProducerSettings {
  instrumentCount: number;
  updatesPerBatch: number;
  batchIntervalMs: number;
}

export type ProducerStatus = 'initializing' | 'running' | 'paused' | 'error';

export const DEFAULT_PRODUCER_SETTINGS: Readonly<ProducerSettings> = {
  instrumentCount: 5,
  updatesPerBatch: 100,
  batchIntervalMs: 500,
};

export const PRODUCER_LIMITS = {
  instrumentCount: { min: 1, max: 50 },
  updatesPerBatch: { min: 1, max: 1_000 },
  batchIntervalMs: { min: 50, max: 2_000 },
} as const;
