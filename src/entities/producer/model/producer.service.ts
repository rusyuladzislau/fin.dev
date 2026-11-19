import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { InstrumentMetrics } from '../../instrument';
import { DEFAULT_PRODUCER_SETTINGS, ProducerSettings, ProducerStatus } from './producer.models';
import {
  isProducerSettings,
  ProducerSettingsInput,
  validateProducerSettings,
} from './producer-settings';
import {
  MAX_INITIALIZATION_ATTEMPTS,
  WorkerCommand,
  WorkerEvent,
} from '../api/worker-protocol';

@Injectable({ providedIn: 'root' })
export class ProducerService {
  private readonly destroyRef = inject(DestroyRef);
  private sharedWorker: SharedWorker | null = null;
  private port: MessagePort | null = null;

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
    this.connect();
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

    if (!this.port) this.connect();
    this.postCommand({ type: 'apply-settings', settings: input });
  }

  dispose(): void {
    this.disconnect(true);
    this.runIdState.set(0);
    this.instrumentsState.set([]);
    this.errorState.set(null);
    this.initializationAttemptState.set(1);
    this.statusState.set('initializing');
  }

  private connect(): void {
    if (this.port) return;

    if (typeof SharedWorker === 'undefined') {
      this.setConnectionError('SharedWorker is not supported by this browser.');
      return;
    }

    try {
      const worker = new SharedWorker(new URL('../api/market-producer.worker.ts', import.meta.url), {
        type: 'module',
        name: 'fin-dev-market-producer',
      });
      const port = worker.port;
      this.sharedWorker = worker;
      this.port = port;

      port.onmessage = (event: MessageEvent<WorkerEvent>) => {
        if (port !== this.port) return;
        this.handleWorkerEvent(event.data);
      };
      port.onmessageerror = () => {
        this.setConnectionError('The market producer sent an unreadable message.');
      };
      worker.onerror = (event: ErrorEvent) => {
        if (worker !== this.sharedWorker) return;
        event.preventDefault();
        this.setConnectionError(event.message || 'The shared market producer failed.');
      };

      port.start();
      port.postMessage({
        type: 'attach',
        wasmBaseUrl: new URL('wasm/', document.baseURI).toString(),
      } satisfies WorkerCommand);
    } catch (error) {
      this.setConnectionError(
        error instanceof Error ? error.message : 'Unable to connect to the shared market producer.',
      );
    }
  }

  private handleWorkerEvent(event: WorkerEvent): void {
    const state = event.state;
    if (state.runId < this.runIdState()) return;

    this.runIdState.set(state.runId);
    this.settingsState.set({ ...state.settings });
    this.statusState.set(state.status);
    this.instrumentsState.set(state.instruments);
    this.errorState.set(state.error);
    this.initializationAttemptState.set(state.initializationAttempt);
  }

  private postCommand(command: WorkerCommand): void {
    this.port?.postMessage(command);
  }

  private setConnectionError(message: string): void {
    this.disconnect(false);
    this.errorState.set(message);
    this.statusState.set('error');
  }

  private disconnect(notifyWorker: boolean): void {
    const port = this.port;
    if (port) {
      if (notifyWorker) {
        try {
          port.postMessage({ type: 'detach' } satisfies WorkerCommand);
        } catch {
          // The browser may already have closed the port during page teardown.
        }
      }
      port.onmessage = null;
      port.onmessageerror = null;
      port.close();
    }
    if (this.sharedWorker) this.sharedWorker.onerror = null;
    this.port = null;
    this.sharedWorker = null;
  }
}
