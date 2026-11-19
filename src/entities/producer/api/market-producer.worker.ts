/// <reference lib="webworker" />

import { InstrumentMetrics, MarketUpdate, MetricCalculator } from '../../instrument';
import { DEFAULT_PRODUCER_SETTINGS, ProducerSettings, ProducerStatus } from '../model/producer.models';
import { isProducerSettings } from '../model/producer-settings';
import {
  isWorkerCommand,
  MAX_INITIALIZATION_ATTEMPTS,
  ProducerWorkerState,
  WorkerEvent,
} from './worker-protocol';

interface WasmGeneratorInstance {
  instrumentSymbols(): string[];
  generateBatch(batchSize: number): MarketUpdate[];
  free(): void;
}

type WasmGeneratorConstructor = new (
  instrumentCount: number,
  seed: number,
) => WasmGeneratorInstance;

interface WasmModule {
  default(wasmUrl: string): Promise<unknown>;
  WasmMarketGenerator: WasmGeneratorConstructor;
}

const workerContext = self as unknown as SharedWorkerGlobalScope;
const calculator = new MetricCalculator();
const ports = new Set<MessagePort>();
const snapshotIntervalMs = 100;
const initializationRetryDelaysMs = [500, 1_000, 2_000, 4_000] as const;

let activeRunId: number | null = null;
let settingsState: ProducerSettings = { ...DEFAULT_PRODUCER_SETTINGS };
let statusState: ProducerStatus = 'initializing';
let instrumentsState: InstrumentMetrics[] = [];
let errorState: string | null = null;
let initializationAttempt = 1;
let wasmBaseUrl: string | null = null;
let generator: WasmGeneratorInstance | null = null;
let scheduleHandle: ReturnType<typeof setTimeout> | null = null;
let retryHandle: ReturnType<typeof setTimeout> | null = null;
let desiredState: 'running' | 'paused' = 'running';
let lastSnapshotAt = 0;
let wasmModulePromise: Promise<WasmModule> | null = null;

workerContext.onconnect = (event: MessageEvent): void => {
  const port = event.ports[0];
  if (!port) return;

  ports.add(port);
  port.onmessage = (message: MessageEvent<unknown>): void => {
    handleCommand(port, message.data);
  };
  port.start();
};

function handleCommand(port: MessagePort, command: unknown): void {
  if (!isWorkerCommand(command)) return;

  switch (command.type) {
    case 'attach':
      if (activeRunId === null) {
        startNewRun({ ...DEFAULT_PRODUCER_SETTINGS }, command.wasmBaseUrl);
      } else {
        postState(port);
      }
      break;
    case 'detach':
      ports.delete(port);
      port.onmessage = null;
      port.close();
      if (ports.size === 0) resetProducer();
      break;
    case 'apply-settings':
      if (isProducerSettings(command.settings) && wasmBaseUrl) {
        startNewRun(command.settings, wasmBaseUrl);
      }
      break;
    case 'pause':
      pause(command.runId);
      break;
    case 'resume':
      resume(command.runId);
      break;
  }
}

function startNewRun(settings: ProducerSettings, baseUrl: string): void {
  cleanupProducer();
  activeRunId = (activeRunId ?? 0) + 1;
  settingsState = { ...settings };
  wasmBaseUrl = baseUrl;
  statusState = 'initializing';
  instrumentsState = [];
  errorState = null;
  initializationAttempt = 1;
  desiredState = 'running';
  lastSnapshotAt = 0;
  calculator.reset([]);
  broadcastState();
  void initialize(activeRunId);
}

async function initialize(runId: number): Promise<void> {
  if (!wasmBaseUrl) return;

  try {
    const module = await loadWasm(wasmBaseUrl);
    if (!isCurrentRun(runId)) return;

    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    generator = new module.WasmMarketGenerator(settingsState.instrumentCount, seed);
    const instruments = generator.instrumentSymbols();
    calculator.reset(instruments);
    publishSnapshot(true);

    if (desiredState === 'running') {
      statusState = 'running';
      broadcastState();
      scheduleNext(0);
    } else {
      statusState = 'paused';
      broadcastState();
    }
  } catch (error) {
    if (isCurrentRun(runId)) {
      handleInitializationFailure(error);
    }
  }
}

async function loadWasm(baseUrl: string): Promise<WasmModule> {
  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      const moduleUrl = new URL('market_generator.js', baseUrl).toString();
      const wasmUrl = new URL('market_generator_bg.wasm', baseUrl).toString();
      const module = (await import(/* @vite-ignore */ moduleUrl)) as unknown as WasmModule;
      await module.default(wasmUrl);
      return module;
    })();
  }
  return wasmModulePromise;
}

function pause(runId: number): void {
  if (!isCurrentRun(runId)) return;
  desiredState = 'paused';
  clearSchedule();
  if (generator) {
    publishSnapshot(true);
    statusState = 'paused';
    broadcastState();
  }
}

function resume(runId: number): void {
  if (!isCurrentRun(runId)) return;
  desiredState = 'running';
  if (generator) {
    statusState = 'running';
    broadcastState();
    scheduleNext(0);
  }
}

function scheduleNext(delayMs: number): void {
  if (!activeRunId || desiredState !== 'running') return;
  clearSchedule();
  const runId = activeRunId;
  scheduleHandle = setTimeout(() => {
    scheduleHandle = null;
    generateBatch(runId);
  }, delayMs);
}

function generateBatch(runId: number): void {
  if (!isCurrentRun(runId) || desiredState !== 'running' || !generator) return;

  try {
    const updates = generator.generateBatch(settingsState.updatesPerBatch);
    for (const update of updates) {
      calculator.apply(update);
    }
    publishSnapshot();
    scheduleNext(settingsState.batchIntervalMs);
  } catch (error) {
    handleRuntimeFailure(error);
  }
}

function publishSnapshot(force = false): void {
  if (!activeRunId) return;
  const now = Date.now();
  if (!force && now - lastSnapshotAt < snapshotIntervalMs) return;
  lastSnapshotAt = now;
  instrumentsState = calculator.getSnapshot();
  broadcastState();
}

function handleInitializationFailure(error: unknown): void {
  const runId = activeRunId;
  if (!runId) return;

  cleanupProducer();
  wasmModulePromise = null;

  if (initializationAttempt >= MAX_INITIALIZATION_ATTEMPTS) {
    desiredState = 'paused';
    statusState = 'error';
    errorState = `Producer initialization failed after ${initializationAttempt} attempts: ${errorMessage(error)}`;
    broadcastState();
    return;
  }

  const delay = initializationRetryDelaysMs[initializationAttempt - 1];
  initializationAttempt += 1;
  statusState = 'initializing';
  instrumentsState = [];
  broadcastState();
  retryHandle = setTimeout(() => {
    retryHandle = null;
    if (isCurrentRun(runId)) void initialize(runId);
  }, delay);
}

function handleRuntimeFailure(error: unknown): void {
  cleanupProducer();
  desiredState = 'paused';
  statusState = 'error';
  errorState = errorMessage(error);
  broadcastState();
}

function cleanupProducer(): void {
  clearSchedule();
  cancelRetry();
  if (generator) {
    generator.free();
    generator = null;
  }
}

function resetProducer(): void {
  cleanupProducer();
  activeRunId = null;
  settingsState = { ...DEFAULT_PRODUCER_SETTINGS };
  statusState = 'initializing';
  instrumentsState = [];
  errorState = null;
  initializationAttempt = 1;
  wasmBaseUrl = null;
  desiredState = 'running';
  lastSnapshotAt = 0;
  calculator.reset([]);
}

function clearSchedule(): void {
  if (scheduleHandle !== null) {
    clearTimeout(scheduleHandle);
    scheduleHandle = null;
  }
}

function cancelRetry(): void {
  if (retryHandle !== null) {
    clearTimeout(retryHandle);
    retryHandle = null;
  }
}

function isCurrentRun(runId: number): boolean {
  return activeRunId === runId;
}

function currentState(): ProducerWorkerState {
  return {
    runId: activeRunId ?? 0,
    settings: { ...settingsState },
    status: statusState,
    instruments: instrumentsState,
    error: errorState,
    initializationAttempt,
  };
}

function postState(port: MessagePort): void {
  const event: WorkerEvent = { type: 'state', state: currentState() };
  port.postMessage(event);
}

function broadcastState(): void {
  for (const port of ports) {
    try {
      postState(port);
    } catch {
      ports.delete(port);
      port.close();
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'The market producer failed unexpectedly.';
}
