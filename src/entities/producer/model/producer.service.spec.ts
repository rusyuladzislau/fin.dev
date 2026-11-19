import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProducerService } from './producer.service';
import { DEFAULT_PRODUCER_SETTINGS } from './producer.models';
import { InstrumentMetrics } from '../../instrument';
import {
  ProducerWorkerState,
  WorkerCommand,
  WorkerEvent,
} from '../api/worker-protocol';

class MockMessagePort {
  onmessage: ((event: MessageEvent<WorkerEvent>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly messages: WorkerCommand[] = [];
  closed = false;

  postMessage(command: WorkerCommand): void {
    this.messages.push(command);
  }

  start(): void {
    this.closed = false;
  }

  close(): void {
    this.closed = true;
  }

  emit(event: WorkerEvent): void {
    this.onmessage?.({ data: event } as MessageEvent<WorkerEvent>);
  }
}

class MockSharedWorker {
  static instances: MockSharedWorker[] = [];
  readonly port = new MockMessagePort();
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor() {
    MockSharedWorker.instances.push(this);
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

function workerState(overrides: Partial<ProducerWorkerState> = {}): ProducerWorkerState {
  return {
    runId: 1,
    settings: { ...DEFAULT_PRODUCER_SETTINGS },
    status: 'running',
    instruments: [],
    error: null,
    initializationAttempt: 1,
    ...overrides,
  };
}

describe('ProducerService', () => {
  let service: ProducerService;

  beforeEach(() => {
    MockSharedWorker.instances = [];
    vi.stubGlobal('SharedWorker', MockSharedWorker);
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProducerService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  function emitState(overrides: Partial<ProducerWorkerState> = {}): void {
    MockSharedWorker.instances[0].port.emit({
      type: 'state',
      state: workerState(overrides),
    });
  }

  it('creates one shared connection and attaches to its producer', () => {
    const worker = MockSharedWorker.instances[0];
    expect(MockSharedWorker.instances).toHaveLength(1);
    expect(service.activeSettings()).toEqual(DEFAULT_PRODUCER_SETTINGS);
    expect(service.status()).toBe('initializing');
    expect(worker.port.messages[0]).toEqual({
      type: 'attach',
      wasmBaseUrl: new URL('wasm/', document.baseURI).toString(),
    });
  });

  it('applies state received from the shared producer', () => {
    const settings = { instrumentCount: 10, updatesPerBatch: 200, batchIntervalMs: 100 };
    emitState({
      runId: 3,
      settings,
      status: 'paused',
      instruments: [metrics(40)],
      initializationAttempt: 2,
    });

    expect(service.runId()).toBe(3);
    expect(service.activeSettings()).toEqual(settings);
    expect(service.status()).toBe('paused');
    expect(service.instruments()).toEqual([metrics(40)]);
    expect(service.initializationAttempt()).toBe(2);
  });

  it('sends pause and resume commands through the same port', () => {
    const worker = MockSharedWorker.instances[0];
    emitState({ status: 'running' });
    service.pause();
    expect(worker.port.messages.at(-1)).toEqual({ type: 'pause', runId: 1 });

    emitState({ status: 'paused', instruments: [metrics(40)] });
    service.resume();
    expect(worker.port.messages.at(-1)).toEqual({ type: 'resume', runId: 1 });
    expect(MockSharedWorker.instances).toHaveLength(1);
  });

  it('applies settings through the shared worker and rejects older runs', () => {
    const settings = { instrumentCount: 10, updatesPerBatch: 200, batchIntervalMs: 100 };
    emitState({ instruments: [metrics(40)] });
    service.applySettings(settings);

    expect(MockSharedWorker.instances[0].port.messages.at(-1)).toEqual({
      type: 'apply-settings',
      settings,
    });
    expect(MockSharedWorker.instances).toHaveLength(1);

    emitState({ runId: 2, settings, status: 'initializing' });
    emitState({
      runId: 1,
      status: 'error',
      instruments: [metrics(999)],
      error: 'Stale failure',
    });

    expect(service.runId()).toBe(2);
    expect(service.activeSettings()).toEqual(settings);
    expect(service.instruments()).toEqual([]);
    expect(service.error()).toBeNull();
    expect(service.status()).toBe('initializing');
  });

  it('rejects invalid settings without sending a command', () => {
    const messageCount = MockSharedWorker.instances[0].port.messages.length;
    expect(() =>
      service.applySettings({ instrumentCount: 0, updatesPerBatch: 100, batchIntervalMs: 500 }),
    ).toThrow('Enter a value from 1 to 50.');
    expect(MockSharedWorker.instances[0].port.messages).toHaveLength(messageCount);
  });

  it('keeps the shared connection open for retry after a producer error state', () => {
    const worker = MockSharedWorker.instances[0];
    emitState({ instruments: [metrics(40)] });
    emitState({ status: 'error', instruments: [metrics(40)], error: 'Generation failed' });

    expect(service.status()).toBe('error');
    expect(service.error()).toBe('Generation failed');
    expect(service.instruments()).toEqual([metrics(40)]);
    expect(worker.port.closed).toBe(false);

    service.applySettings({ ...service.activeSettings() });
    expect(worker.port.messages.at(-1)).toEqual({
      type: 'apply-settings',
      settings: DEFAULT_PRODUCER_SETTINGS,
    });
  });

  it('closes its port after a native shared worker error and preserves metrics', () => {
    const worker = MockSharedWorker.instances[0];
    const preventDefault = vi.fn();
    emitState({ instruments: [metrics(40)] });

    worker.onerror?.({
      message: 'Native shared worker failure',
      preventDefault,
    } as unknown as ErrorEvent);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(worker.port.closed).toBe(true);
    expect(service.status()).toBe('error');
    expect(service.error()).toBe('Native shared worker failure');
    expect(service.instruments()).toEqual([metrics(40)]);
  });

  it('detaches and closes only its own port when disposed', () => {
    const worker = MockSharedWorker.instances[0];
    emitState({ instruments: [metrics(40)] });
    service.dispose();

    expect(worker.port.messages.at(-1)).toEqual({ type: 'detach' });
    expect(worker.port.closed).toBe(true);
    expect(service.runId()).toBe(0);
    expect(service.instruments()).toEqual([]);
    expect(service.status()).toBe('initializing');
    expect(MockSharedWorker.instances).toHaveLength(1);
  });

  it('reports malformed worker events without losing the last metrics', () => {
    const worker = MockSharedWorker.instances[0];
    emitState({ instruments: [metrics(40)] });

    worker.port.onmessage?.({ data: null } as unknown as MessageEvent<WorkerEvent>);

    expect(service.status()).toBe('error');
    expect(service.error()).toBe('The market producer sent an invalid message.');
    expect(service.instruments()).toEqual([metrics(40)]);
    expect(worker.port.closed).toBe(true);
  });

  it('reports shared worker construction failures', () => {
    service.dispose();
    TestBed.resetTestingModule();
    vi.stubGlobal(
      'SharedWorker',
      class {
        constructor() {
          throw new Error('Worker creation failed');
        }
      },
    );
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProducerService);

    expect(service.status()).toBe('error');
    expect(service.error()).toBe('Worker creation failed');
    expect(service.instruments()).toEqual([]);
  });

  it('does not send pause repeatedly when the shared run is not running', () => {
    const worker = MockSharedWorker.instances[0];
    emitState({ status: 'paused' });
    const messageCount = worker.port.messages.length;

    service.pause();
    service.pause();

    expect(worker.port.messages).toHaveLength(messageCount);
    expect(MockSharedWorker.instances).toHaveLength(1);
  });
});
