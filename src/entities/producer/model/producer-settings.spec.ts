import { describe, expect, it } from 'vitest';
import { isProducerSettings, validateProducerSettings } from './producer-settings';
import { DEFAULT_PRODUCER_SETTINGS } from './producer.models';

describe('producer settings validation', () => {
  it('accepts defaults and all inclusive boundaries', () => {
    expect(validateProducerSettings({ ...DEFAULT_PRODUCER_SETTINGS })).toEqual({});
    expect(
      isProducerSettings({ instrumentCount: 1, updatesPerBatch: 1, batchIntervalMs: 50 }),
    ).toBe(true);
    expect(
      isProducerSettings({ instrumentCount: 50, updatesPerBatch: 1_000, batchIntervalMs: 2_000 }),
    ).toBe(true);
  });

  it.each([
    { instrumentCount: 0, updatesPerBatch: 100, batchIntervalMs: 500 },
    { instrumentCount: 51, updatesPerBatch: 100, batchIntervalMs: 500 },
    { instrumentCount: 5, updatesPerBatch: 0, batchIntervalMs: 500 },
    { instrumentCount: 5, updatesPerBatch: 1_001, batchIntervalMs: 500 },
    { instrumentCount: 5, updatesPerBatch: 100, batchIntervalMs: 49 },
    { instrumentCount: 5, updatesPerBatch: 100, batchIntervalMs: 2_001 },
  ])('rejects out-of-range settings: %o', (settings) => {
    expect(Object.keys(validateProducerSettings(settings))).not.toHaveLength(0);
  });

  it('rejects decimals, missing values, and nonnumeric values', () => {
    expect(
      validateProducerSettings({ ...DEFAULT_PRODUCER_SETTINGS, instrumentCount: 5.5 }),
    ).toEqual({
      instrumentCount: 'Use a whole number.',
    });
    expect(
      validateProducerSettings({ ...DEFAULT_PRODUCER_SETTINGS, updatesPerBatch: null }),
    ).toEqual({
      updatesPerBatch: 'This value is required.',
    });
    expect(
      validateProducerSettings({ ...DEFAULT_PRODUCER_SETTINGS, batchIntervalMs: 'fast' }),
    ).toEqual({ batchIntervalMs: 'Enter a valid number.' });
  });
});
