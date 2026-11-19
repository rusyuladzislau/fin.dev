import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketUpdate } from '../../instrument';
import { WorkerCommand, WorkerEvent } from './worker-protocol';

const wasmBaseUrl = 'https://unit.test/wasm/';
const wasmModuleUrl = new URL('market_generator.js', wasmBaseUrl).toString();

describe('market-producer.worker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock(wasmModuleUrl);
    vi.resetModules();
  });

  it('stops generating while paused and resumes totals without catching up', async () => {
    vi.useFakeTimers();
    vi.resetModules();

    const events: WorkerEvent[] = [];
    const workerContext = {
      onmessage: null as ((event: MessageEvent<WorkerCommand>) => void) | null,
      postMessage: (event: WorkerEvent) => events.push(event),
    };
    const generateBatch = vi.fn((): MarketUpdate[] => [
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

    class MockWasmGenerator {
      instrumentSymbols(): string[] {
        return ['ALFA'];
      }

      generateBatch = generateBatch;

      free = vi.fn();
    }

    vi.stubGlobal('self', workerContext);
    vi.doMock(wasmModuleUrl, () => ({
      default: vi.fn(() => Promise.resolve()),
      WasmMarketGenerator: MockWasmGenerator,
    }));

    await import('./market-producer.worker');

    const dispatch = (command: WorkerCommand): void => {
      workerContext.onmessage?.({ data: command } as MessageEvent<WorkerCommand>);
    };
    const latestVolume = (): number | undefined => {
      const snapshots = events.filter((event) => event.type === 'snapshot');
      return snapshots.at(-1)?.instruments[0].volume;
    };

    dispatch({
      type: 'initialize',
      runId: 1,
      settings: { instrumentCount: 1, updatesPerBatch: 1, batchIntervalMs: 500 },
      wasmBaseUrl,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(generateBatch).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: 'status', runId: 1, status: 'running' });

    dispatch({ type: 'pause', runId: 1 });
    const eventCountAfterPause = events.length;
    expect(events).toContainEqual({ type: 'status', runId: 1, status: 'paused' });
    expect(latestVolume()).toBe(10);

    vi.advanceTimersByTime(5_000);

    expect(generateBatch).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(eventCountAfterPause);
    expect(latestVolume()).toBe(10);

    dispatch({ type: 'resume', runId: 1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(generateBatch).toHaveBeenCalledTimes(2);
    expect(latestVolume()).toBe(20);

    vi.advanceTimersByTime(499);
    expect(generateBatch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);

    expect(generateBatch).toHaveBeenCalledTimes(3);
    expect(latestVolume()).toBe(30);

    dispatch({ type: 'pause', runId: 1 });
  });
});
