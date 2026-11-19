import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { InstrumentMetrics } from '../../instrument';
import { DEFAULT_PRODUCER_SETTINGS, ProducerSettings, ProducerStatus } from './producer.models';
import {
  isProducerSettings,
  ProducerSettingsInput,
  validateProducerSettings,
} from './producer-settings';
import { WorkerEvent } from '../api/worker-protocol';

const MAX_INITIALIZATION_ATTEMPTS = 5;
const INITIALIZATION_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000] as const;

@Injectable({ providedIn: 'root' })
export class ProducerService {
  private readonly destroyRef = inject(DestroyRef);
  private worker: Worker | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly settingsState = signal<ProducerSettings>({ ...DEFAULT_PRODUCER_SETTINGS });
  private readonly runIdState = signal(0);
  private readonly statusState = signal<ProducerStatus>('initializing');
  private readonly instrumentsState = signal<InstrumentMetrics[]>([]);
  private readonly errorState = signal<string | null>(null);
  private readonly initializationAttemptState = signal(1);

  readonly activeSettings = this.settingsState.asReadonly();
  readonly runId = this.runIdState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly instruments = this.instrumentsState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly initializationAttempt = this.initializationAttemptState.asReadonly();
  readonly maxInitializationAttempts = MAX_INITIALIZATION_ATTEMPTS;
  readonly nominalUpdatesPerSecond = computed(
    () => (this.settingsState().updatesPerBatch * 1_000) / this.settingsState().batchIntervalMs,
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.dispose());
    this.startNewRun(this.settingsState());
  }

  pause(): void {
    if (this.statusState() !== 'running') return;
    this.postCommand({ type: 'pause', runId: this.runIdState() });
  }

  resume(): void {
    if (this.statusState() !== 'paused') return;
    this.postCommand({ type: 'resume', runId: this.runIdState() });
  }

  applySettings(input: ProducerSettingsInput): void {
    if (!isProducerSettings(input)) {
      const firstError = Object.values(validateProducerSettings(input))[0];
      throw new Error(firstError ?? 'Invalid producer settings.');
    }
    this.startNewRun(input);
  }

  dispose(): void {
    this.cancelScheduledRetry();
    this.stopWorker();
    this.instrumentsState.set([]);
    this.statusState.set('initializing');
  }

  private startNewRun(settings: ProducerSettings): void {
    this.cancelScheduledRetry();
    this.stopWorker();
    const runId = this.runIdState() + 1;
    this.runIdState.set(runId);
    this.settingsState.set({ ...settings });
    this.instrumentsState.set([]);
    this.errorState.set(null);
    this.initializationAttemptState.set(1);
    this.statusState.set('initializing');
    this.startWorker(settings);
  }

  private startWorker(settings: ProducerSettings): void {
    const runId = this.runIdState();

    try {
      const worker = new Worker(new URL('../api/market-producer.worker.ts', import.meta.url), {
        type: 'module',
        name: `market-producer-${runId}-attempt-${this.initializationAttemptState()}`,
      });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
        if (worker !== this.worker || event.data.runId !== this.runIdState()) return;
        this.handleWorkerEvent(event.data);
      };
      worker.onerror = (event: ErrorEvent) => {
        if (worker !== this.worker) return;
        event.preventDefault();
        this.handleProducerFailure(event.message || 'The market producer worker failed to start.');
      };
      worker.postMessage({
        type: 'initialize',
        runId,
        settings,
        wasmBaseUrl: new URL('wasm/', document.baseURI).toString(),
      });
    } catch (error) {
      this.handleProducerFailure(
        error instanceof Error ? error.message : 'Unable to create the market producer.',
      );
    }
  }

  private handleWorkerEvent(event: WorkerEvent): void {
    switch (event.type) {
      case 'ready':
        this.instrumentsState.set(
          event.instruments.map((instrument) => ({
            instrument,
            lastPriceCents: null,
            spreadCents: null,
            volume: 0,
            vwapCents: null,
            imbalance: null,
          })),
        );
        break;
      case 'snapshot':
        this.instrumentsState.set(event.instruments);
        break;
      case 'status':
        this.statusState.set(event.status);
        break;
      case 'error':
        this.handleProducerFailure(event.message);
        break;
    }
  }

  private handleProducerFailure(message: string): void {
    if (this.statusState() === 'initializing') {
      this.scheduleInitializationRetry(message);
      return;
    }
    this.setError(message);
  }

  private scheduleInitializationRetry(message: string): void {
    this.stopWorker();
    const attempt = this.initializationAttemptState();
    if (attempt >= MAX_INITIALIZATION_ATTEMPTS) {
      this.setError(`Producer initialization failed after ${attempt} attempts: ${message}`);
      return;
    }

    const delay = INITIALIZATION_RETRY_DELAYS_MS[attempt - 1];
    const runId = this.runIdState();
    this.initializationAttemptState.set(attempt + 1);
    this.instrumentsState.set([]);
    this.statusState.set('initializing');
    this.cancelScheduledRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (runId !== this.runIdState()) return;
      this.startWorker(this.settingsState());
    }, delay);
  }

  private cancelScheduledRetry(): void {
    if (this.retryTimer === null) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private postCommand(command: { type: 'pause' | 'resume'; runId: number }): void {
    this.worker?.postMessage(command);
  }

  private setError(message: string): void {
    this.cancelScheduledRetry();
    this.errorState.set(message);
    this.statusState.set('error');
  }

  private stopWorker(): void {
    if (!this.worker) return;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.worker = null;
  }
}
