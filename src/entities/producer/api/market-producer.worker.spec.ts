import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MarketUpdate } from '../../instrument';
import { DEFAULT_PRODUCER_SETTINGS } from '../model/producer.models';
import { ProducerWorkerState, WorkerCommand, WorkerEvent } from './worker-protocol';

const wasmBaseUrl = 'https://unit.test/wasm/';
const wasmModuleUrl = new URL('market_generator.js', wasmBaseUrl).toString();

interface TestPort {
  onmessage: ((event: MessageEvent<WorkerCommand>) => void) | null;
  readonly events: WorkerEvent[];
  closed: boolean;
  postMessage(event: WorkerEvent): void;
  start(): void;
  close(): void;
}

let generateBatch: Mock<(batchSize: number) => MarketUpdate[]>;
let freeGenerator: Mock<() => void>;
let initializeWasm: Mock<() => Promise<void>>;
let generatorCount: number;

class MockWasmGenerator {
  constructor() {
    generatorCount += 1;
  }

  instrumentSymbols(): string[] {
    return ['ALFA'];
  }

  generateBatch(batchSize: number): MarketUpdate[] {
    return generateBatch(batchSize);
  }

  free(): void {
    freeGenerator();
  }
}

describe('market-producer shared worker', () => {
  const workerContext = {
    onconnect: null as ((event: MessageEvent) => void) | null,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    generatorCount = 0;
    freeGenerator = vi.fn();
    initializeWasm = vi.fn(() => Promise.resolve());
    generateBatch = vi.fn((): MarketUpdate[] => [
      {
        instrument: 'ALFA',
        priceCents: 10_200,
        tradeQuantity: 10,
        bidCents: 10_196,
        askCents: 10_200,
        bidQuantity: 600,
        askQuantity: 400,
      },
    ]);

    workerContext.onconnect = null;
    vi.stubGlobal('self', workerContext);
    vi.doMock(wasmModuleUrl, () => ({
      default: initializeWasm,
      WasmMarketGenerator: MockWasmGenerator,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock(wasmModuleUrl);
    vi.resetModules();
  });

  function createPort(): TestPort {
    return {
      onmessage: null,
      events: [],
      closed: false,
      postMessage(event: WorkerEvent): void {
        this.events.push(event);
      },
      start(): void {
        this.closed = false;
      },
      close(): void {
        this.closed = true;
      },
    };
  }

  function connect(port: TestPort): void {
    workerContext.onconnect?.({ ports: [port] } as unknown as MessageEvent);
  }

  function dispatch(port: TestPort, command: WorkerCommand): void {
    port.onmessage?.({ data: command } as MessageEvent<WorkerCommand>);
  }

  function attach(port: TestPort): void {
    connect(port);
    dispatch(port, { type: 'attach', wasmBaseUrl });
  }

  function latestState(port: TestPort): ProducerWorkerState {
    const event = port.events.at(-1);
    if (!event) throw new Error('Expected a worker state event.');
    return event.state;
  }

  it('stops generating while paused and resumes totals without catching up', async () => {
    await import('./market-producer.worker');
    const port = createPort();
    attach(port);
    await vi.advanceTimersByTimeAsync(0);

    expect(generateBatch).toHaveBeenCalledTimes(1);
    expect(latestState(port)).toMatchObject({ runId: 1, status: 'running' });

    dispatch(port, { type: 'pause', runId: 1 });
    const eventCountAfterPause = port.events.length;
    expect(latestState(port)).toMatchObject({ status: 'paused' });
    expect(latestState(port).instruments[0].volume).toBe(10);

    vi.advanceTimersByTime(5_000);

    expect(generateBatch).toHaveBeenCalledTimes(1);
    expect(port.events).toHaveLength(eventCountAfterPause);
    expect(latestState(port).instruments[0].volume).toBe(10);

    dispatch(port, { type: 'resume', runId: 1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(generateBatch).toHaveBeenCalledTimes(2);
    expect(latestState(port).instruments[0].volume).toBe(20);

    vi.advanceTimersByTime(499);
    expect(generateBatch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);

    expect(generateBatch).toHaveBeenCalledTimes(3);
    expect(latestState(port).instruments[0].volume).toBe(30);

    dispatch(port, { type: 'pause', runId: 1 });
  });

  it('shares one run, broadcasts commands, and cleans up after the last tab detaches', async () => {
    await import('./market-producer.worker');
    const firstTab = createPort();
    const secondTab = createPort();
    attach(firstTab);
    await vi.advanceTimersByTimeAsync(0);

    attach(secondTab);

    expect(generatorCount).toBe(1);
    expect(generateBatch).toHaveBeenCalledTimes(1);
    expect(latestState(secondTab)).toMatchObject({ runId: 1, status: 'running' });

    dispatch(secondTab, { type: 'pause', runId: 1 });

    expect(latestState(firstTab).status).toBe('paused');
    expect(latestState(secondTab).status).toBe('paused');
    expect(latestState(firstTab).instruments).toEqual(latestState(secondTab).instruments);

    vi.advanceTimersByTime(1_000);
    expect(generateBatch).toHaveBeenCalledTimes(1);

    dispatch(firstTab, { type: 'resume', runId: 1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(latestState(firstTab).instruments[0].volume).toBe(20);
    expect(latestState(secondTab).instruments[0].volume).toBe(20);

    const nextSettings = { instrumentCount: 1, updatesPerBatch: 1, batchIntervalMs: 100 };
    dispatch(secondTab, { type: 'apply-settings', settings: nextSettings });
    await vi.advanceTimersByTimeAsync(0);

    expect(generatorCount).toBe(2);
    expect(latestState(firstTab)).toMatchObject({ runId: 2, settings: nextSettings });
    expect(latestState(secondTab)).toMatchObject({ runId: 2, settings: nextSettings });

    const freeCountBeforeDetach = freeGenerator.mock.calls.length;
    dispatch(firstTab, { type: 'detach' });
    expect(freeGenerator).toHaveBeenCalledTimes(freeCountBeforeDetach);

    const batchCountBeforeDetach = generateBatch.mock.calls.length;
    dispatch(secondTab, { type: 'detach' });
    vi.advanceTimersByTime(10_000);

    expect(freeGenerator).toHaveBeenCalledTimes(freeCountBeforeDetach + 1);
    expect(generateBatch).toHaveBeenCalledTimes(batchCountBeforeDetach);
    expect(firstTab.closed).toBe(true);
    expect(secondTab.closed).toBe(true);
  });

  it('applies settings from paused with cleanup and starts a clean running run', async () => {
    await import('./market-producer.worker');
    const port = createPort();
    attach(port);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);

    expect(latestState(port).instruments[0].volume).toBe(20);
    dispatch(port, { type: 'pause', runId: 1 });

    const nextSettings = { instrumentCount: 1, updatesPerBatch: 1, batchIntervalMs: 100 };
    dispatch(port, { type: 'apply-settings', settings: nextSettings });

    expect(freeGenerator).toHaveBeenCalledTimes(1);
    expect(generatorCount).toBe(1);
    expect(latestState(port)).toMatchObject({
      runId: 2,
      settings: nextSettings,
      status: 'initializing',
      instruments: [],
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(generatorCount).toBe(2);
    expect(generateBatch).toHaveBeenLastCalledWith(1);
    expect(latestState(port)).toMatchObject({ runId: 2, status: 'running' });
    expect(latestState(port).instruments[0].volume).toBe(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(latestState(port).instruments[0].volume).toBe(20);

    dispatch(port, { type: 'pause', runId: 2 });
  });

  it('ignores a late initialization result after applying settings', async () => {
    let finishWasmInitialization!: () => void;
    initializeWasm.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishWasmInitialization = resolve;
        }),
    );

    await import('./market-producer.worker');
    const port = createPort();
    attach(port);
    await vi.advanceTimersByTimeAsync(0);

    const nextSettings = { instrumentCount: 1, updatesPerBatch: 25, batchIntervalMs: 100 };
    dispatch(port, { type: 'apply-settings', settings: nextSettings });
    const eventCountAfterApply = port.events.length;

    expect(latestState(port)).toMatchObject({
      runId: 2,
      settings: nextSettings,
      status: 'initializing',
      instruments: [],
    });

    finishWasmInitialization();
    await vi.advanceTimersByTimeAsync(0);

    expect(generatorCount).toBe(1);
    expect(generateBatch).toHaveBeenCalledTimes(1);
    expect(generateBatch).toHaveBeenCalledWith(25);
    expect(latestState(port)).toMatchObject({ runId: 2, status: 'running' });
    expect(port.events.slice(eventCountAfterApply).every((event) => event.state.runId === 2)).toBe(
      true,
    );

    dispatch(port, { type: 'pause', runId: 2 });
  });

  it('reports runtime generation errors and stops the schedule', async () => {
    await import('./market-producer.worker');
    const port = createPort();
    attach(port);
    await vi.advanceTimersByTimeAsync(0);

    dispatch(port, { type: 'pause', runId: 1 });
    expect(latestState(port).instruments[0].volume).toBe(10);

    generateBatch.mockImplementation(() => {
      throw new Error('Generation failed unexpectedly');
    });
    dispatch(port, { type: 'resume', runId: 1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(latestState(port)).toMatchObject({
      runId: 1,
      status: 'error',
      error: 'Generation failed unexpectedly',
    });
    expect(latestState(port).instruments[0].volume).toBe(10);
    expect(freeGenerator).toHaveBeenCalledTimes(1);

    const batchCountAfterError = generateBatch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(generateBatch).toHaveBeenCalledTimes(batchCountAfterError);
  });

  it('ignores malformed commands without stopping the shared run', async () => {
    await import('./market-producer.worker');
    const port = createPort();
    attach(port);
    await vi.advanceTimersByTimeAsync(0);

    const eventCount = port.events.length;
    const batchCount = generateBatch.mock.calls.length;
    const dispatchUnknown = (command: unknown): void => {
      const handler = port.onmessage as unknown as (event: MessageEvent<unknown>) => void;
      handler({ data: command } as MessageEvent<unknown>);
    };

    dispatchUnknown(null);
    dispatchUnknown({ type: 'unknown' });
    dispatchUnknown({ type: 'apply-settings' });
    dispatchUnknown({ type: 'pause', runId: '1' });

    expect(port.events).toHaveLength(eventCount);
    expect(generateBatch).toHaveBeenCalledTimes(batchCount);
    expect(latestState(port)).toMatchObject({ runId: 1, status: 'running' });

    dispatch(port, { type: 'pause', runId: 1 });
    expect(latestState(port).status).toBe('paused');
  });

  it('retries initialization five times and recovers through a shared manual retry', async () => {
    initializeWasm.mockRejectedValue(new Error('Wasm unavailable'));
    await import('./market-producer.worker');
    const port = createPort();
    attach(port);
    await vi.advanceTimersByTimeAsync(0);

    expect(latestState(port)).toMatchObject({ status: 'initializing', initializationAttempt: 2 });

    await vi.advanceTimersByTimeAsync(500);
    expect(latestState(port).initializationAttempt).toBe(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(latestState(port).initializationAttempt).toBe(4);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(latestState(port).initializationAttempt).toBe(5);
    await vi.advanceTimersByTimeAsync(4_000);

    expect(latestState(port)).toMatchObject({
      runId: 1,
      status: 'error',
      initializationAttempt: 5,
      error: 'Producer initialization failed after 5 attempts: Wasm unavailable',
    });
    expect(generateBatch).not.toHaveBeenCalled();

    initializeWasm.mockResolvedValue(undefined);
    dispatch(port, { type: 'apply-settings', settings: DEFAULT_PRODUCER_SETTINGS });
    await vi.advanceTimersByTimeAsync(0);

    expect(latestState(port)).toMatchObject({ runId: 2, status: 'running' });
    expect(generateBatch).toHaveBeenCalledTimes(1);
  });
});
