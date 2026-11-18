import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProducerService } from './producer.service';
import { InstrumentMetrics } from '../../instrument';
import { WorkerCommand, WorkerEvent } from '../api/worker-protocol';

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: WorkerCommand[] = [];
  terminated = false;

  constructor() {
    MockWorker.instances.push(this);
  }

  postMessage(command: WorkerCommand): void {
    this.messages.push(command);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(event: WorkerEvent): void {
    this.onmessage?.({ data: event } as MessageEvent<WorkerEvent>);
  }
}

function metrics(volume: number): InstrumentMetrics {
  return {
    instrument: 'ALFA',
    lastPriceCents: 10_200,
    spreadCents: 4,
    volume,
    vwapCents: 10_150,
    imbalance: 0.2,
  };
}

describe('ProducerService', () => {
  let service: ProducerService;

  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal('Worker', MockWorker);
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProducerService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('starts once with default settings', () => {
    expect(MockWorker.instances).toHaveLength(1);
    expect(service.activeSettings()).toEqual({
      instrumentCount: 5,
      updatesPerBatch: 100,
      batchIntervalMs: 500,
    });
    expect(service.status()).toBe('initializing');
    expect(MockWorker.instances[0].messages[0]).toMatchObject({
      type: 'initialize',
      runId: 1,
    });
  });

  it('pauses and resumes the same run', () => {
    const worker = MockWorker.instances[0];
    worker.emit({ type: 'status', runId: 1, status: 'running' });
    service.pause();
    expect(worker.messages.at(-1)).toEqual({ type: 'pause', runId: 1 });

    worker.emit({ type: 'status', runId: 1, status: 'paused' });
    service.resume();
    expect(worker.messages.at(-1)).toEqual({ type: 'resume', runId: 1 });
    expect(MockWorker.instances).toHaveLength(1);
  });

  it('applies settings by cleaning up and resetting to a new run', () => {
    const previousWorker = MockWorker.instances[0];
    previousWorker.emit({ type: 'snapshot', runId: 1, instruments: [metrics(40)] });
    previousWorker.emit({ type: 'status', runId: 1, status: 'paused' });

    service.applySettings({ instrumentCount: 10, updatesPerBatch: 200, batchIntervalMs: 100 });

    expect(previousWorker.terminated).toBe(true);
    expect(MockWorker.instances).toHaveLength(2);
    expect(service.runId()).toBe(2);
    expect(service.instruments()).toEqual([]);
    expect(service.status()).toBe('initializing');
    expect(service.activeSettings().instrumentCount).toBe(10);

    const currentWorker = MockWorker.instances[1];
    currentWorker.emit({ type: 'status', runId: 2, status: 'running' });
    expect(service.status()).toBe('running');
  });

  it('rejects snapshots and errors from previous runs', () => {
    const previousWorker = MockWorker.instances[0];
    service.applySettings({ instrumentCount: 5, updatesPerBatch: 50, batchIntervalMs: 250 });
    previousWorker.emit({ type: 'snapshot', runId: 1, instruments: [metrics(999)] });
    previousWorker.emit({ type: 'error', runId: 1, message: 'Stale failure' });

    expect(service.instruments()).toEqual([]);
    expect(service.error()).toBeNull();
    expect(service.status()).toBe('initializing');
  });

  it('does not create another producer when asked to pause repeatedly', () => {
    const worker = MockWorker.instances[0];
    worker.emit({ type: 'status', runId: 1, status: 'paused' });
    service.pause();
    service.pause();
    expect(worker.messages).toHaveLength(1);
    expect(MockWorker.instances).toHaveLength(1);
  });

  it('surfaces producer errors', () => {
    MockWorker.instances[0].emit({ type: 'error', runId: 1, message: 'Wasm unavailable' });
    expect(service.status()).toBe('error');
    expect(service.error()).toBe('Wasm unavailable');
  });
});
