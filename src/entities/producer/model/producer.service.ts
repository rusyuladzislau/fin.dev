import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { InstrumentMetrics } from '../../instrument';
import { DEFAULT_PRODUCER_SETTINGS, ProducerSettings, ProducerStatus } from './producer.models';
import {
  isProducerSettings,
  ProducerSettingsInput,
  validateProducerSettings,
} from './producer-settings';
import { WorkerEvent } from '../api/worker-protocol';

@Injectable({ providedIn: 'root' })
export class ProducerService {
  private readonly destroyRef = inject(DestroyRef);
  private worker: Worker | null = null;

  private readonly settingsState = signal<ProducerSettings>({ ...DEFAULT_PRODUCER_SETTINGS });
  private readonly runIdState = signal(0);
  private readonly statusState = signal<ProducerStatus>('initializing');
  private readonly instrumentsState = signal<InstrumentMetrics[]>([]);
  private readonly errorState = signal<string | null>(null);

  readonly activeSettings = this.settingsState.asReadonly();
  readonly runId = this.runIdState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly instruments = this.instrumentsState.asReadonly();
  readonly error = this.errorState.asReadonly();
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
    this.stopWorker();
    this.instrumentsState.set([]);
    this.statusState.set('initializing');
  }

  private startNewRun(settings: ProducerSettings): void {
    this.stopWorker();
    const runId = this.runIdState() + 1;
    this.runIdState.set(runId);
    this.settingsState.set({ ...settings });
    this.instrumentsState.set([]);
    this.errorState.set(null);
    this.statusState.set('initializing');

    try {
      const worker = new Worker(new URL('../api/market-producer.worker.ts', import.meta.url), {
        type: 'module',
        name: `market-producer-${runId}`,
      });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
        if (worker !== this.worker || event.data.runId !== this.runIdState()) return;
        this.handleWorkerEvent(event.data);
      };
      worker.onerror = (event: ErrorEvent) => {
        if (worker !== this.worker) return;
        event.preventDefault();
        this.setError(event.message || 'The market producer worker failed to start.');
      };
      worker.postMessage({
        type: 'initialize',
        runId,
        settings,
        wasmBaseUrl: new URL('wasm/', document.baseURI).toString(),
      });
    } catch (error) {
      this.setError(
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
        this.setError(event.message);
        break;
    }
  }

  private postCommand(command: { type: 'pause' | 'resume'; runId: number }): void {
    this.worker?.postMessage(command);
  }

  private setError(message: string): void {
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
