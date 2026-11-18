import { PRODUCER_LIMITS, ProducerSettings } from './producer.models';

export type ProducerSettingsInput = Record<keyof ProducerSettings, unknown>;
export type ProducerSettingsErrors = Partial<Record<keyof ProducerSettings, string>>;

export function validateProducerSettings(input: ProducerSettingsInput): ProducerSettingsErrors {
  return {
    ...validateIntegerField(
      'instrumentCount',
      input.instrumentCount,
      PRODUCER_LIMITS.instrumentCount.min,
      PRODUCER_LIMITS.instrumentCount.max,
    ),
    ...validateIntegerField(
      'updatesPerBatch',
      input.updatesPerBatch,
      PRODUCER_LIMITS.updatesPerBatch.min,
      PRODUCER_LIMITS.updatesPerBatch.max,
    ),
    ...validateIntegerField(
      'batchIntervalMs',
      input.batchIntervalMs,
      PRODUCER_LIMITS.batchIntervalMs.min,
      PRODUCER_LIMITS.batchIntervalMs.max,
    ),
  };
}

export function isProducerSettings(input: ProducerSettingsInput): input is ProducerSettings {
  return Object.keys(validateProducerSettings(input)).length === 0;
}

function validateIntegerField(
  field: keyof ProducerSettings,
  value: unknown,
  min: number,
  max: number,
): ProducerSettingsErrors {
  if (value === null || value === undefined || value === '') {
    return { [field]: 'This value is required.' };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { [field]: 'Enter a valid number.' };
  }
  if (!Number.isInteger(value)) {
    return { [field]: 'Use a whole number.' };
  }
  if (value < min || value > max) {
    return { [field]: `Enter a value from ${min} to ${max}.` };
  }
  return {};
}
