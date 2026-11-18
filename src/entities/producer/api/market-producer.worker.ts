/// <reference lib="webworker" />

import { MarketUpdate, MetricCalculator } from '../../instrument';
import { ProducerSettings } from '../model/producer.models';
import { WorkerCommand, WorkerEvent } from './worker-protocol';

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

const workerContext = self as unknown as DedicatedWorkerGlobalScope;
const calculator = new MetricCalculator();
const snapshotIntervalMs = 100;

let activeRunId: number | null = null;
let settings: ProducerSettings | null = null;
let generator: WasmGeneratorInstance | null = null;
let scheduleHandle: ReturnType<typeof setTimeout> | null = null;
let desiredState: 'running' | 'paused' = 'running';
let lastSnapshotAt = 0;
let wasmModulePromise: Promise<WasmModule> | null = null;

workerContext.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const command = event.data;
  switch (command.type) {
    case 'initialize':
      void initialize(command);
      break;
    case 'pause':
      pause(command.runId);
      break;
    case 'resume':
      resume(command.runId);
      break;
    case 'dispose':
      if (isCurrentRun(command.runId)) {
        cleanupProducer();
        activeRunId = null;
      }
      break;
  }
};

async function initialize(command: Extract<WorkerCommand, { type: 'initialize' }>): Promise<void> {
  cleanupProducer();
  activeRunId = command.runId;
  settings = { ...command.settings };
  desiredState = 'running';
  lastSnapshotAt = 0;

  try {
    const module = await loadWasm(command.wasmBaseUrl);
    if (!isCurrentRun(command.runId) || !settings) return;

    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    generator = new module.WasmMarketGenerator(settings.instrumentCount, seed);
    const instruments = generator.instrumentSymbols();
    calculator.reset(instruments);
    post({ type: 'ready', runId: command.runId, instruments });
    publishSnapshot(true);

    if (desiredState === 'running') {
      postStatus('running');
      scheduleNext(0);
    } else {
      postStatus('paused');
    }
  } catch (error) {
    if (isCurrentRun(command.runId)) {
      // Visual feedback only: keep the initializing state visible before showing the error.
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      if (isCurrentRun(command.runId)) {
        handleFailure(error);
      }
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
    postStatus('paused');
  }
}

function resume(runId: number): void {
  if (!isCurrentRun(runId)) return;
  desiredState = 'running';
  if (generator) {
    postStatus('running');
    scheduleNext(0);
  }
}

function scheduleNext(delayMs: number): void {
  if (!activeRunId || desiredState !== 'running' || !settings) return;
  clearSchedule();
  const runId = activeRunId;
  scheduleHandle = setTimeout(() => {
    scheduleHandle = null;
    generateBatch(runId);
  }, delayMs);
}

function generateBatch(runId: number): void {
  if (!isCurrentRun(runId) || desiredState !== 'running' || !generator || !settings) return;

  try {
    const updates = generator.generateBatch(settings.updatesPerBatch);
    for (const update of updates) {
      calculator.apply(update);
    }
    publishSnapshot();
    scheduleNext(settings.batchIntervalMs);
  } catch (error) {
    handleFailure(error);
  }
}

function publishSnapshot(force = false): void {
  if (!activeRunId) return;
  const now = Date.now();
  if (!force && now - lastSnapshotAt < snapshotIntervalMs) return;
  lastSnapshotAt = now;
  post({ type: 'snapshot', runId: activeRunId, instruments: calculator.getSnapshot() });
}

function postStatus(status: 'running' | 'paused'): void {
  if (activeRunId) post({ type: 'status', runId: activeRunId, status });
}

function handleFailure(error: unknown): void {
  clearSchedule();
  desiredState = 'paused';
  if (activeRunId) {
    post({ type: 'error', runId: activeRunId, message: errorMessage(error) });
  }
}

function cleanupProducer(): void {
  clearSchedule();
  if (generator) {
    generator.free();
    generator = null;
  }
  settings = null;
}

function clearSchedule(): void {
  if (scheduleHandle !== null) {
    clearTimeout(scheduleHandle);
    scheduleHandle = null;
  }
}

function isCurrentRun(runId: number): boolean {
  return activeRunId === runId;
}

function post(event: WorkerEvent): void {
  workerContext.postMessage(event);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'The market producer failed unexpectedly.';
}
