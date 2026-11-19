import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstrumentMetrics } from '../entities/instrument';
import {
  DEFAULT_PRODUCER_SETTINGS,
  ProducerService,
  ProducerSettings,
  ProducerStatus,
} from '../entities/producer';
import { App } from './app';
import { routes } from './app.routes';

interface TestWorkerState {
  runId: number;
  settings: ProducerSettings;
  status: ProducerStatus;
  instruments: InstrumentMetrics[];
  error: string | null;
  initializationAttempt: number;
}

class MockMessagePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly messages: unknown[] = [];
  closed = false;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  start(): void {
    this.closed = false;
  }

  close(): void {
    this.closed = true;
  }

  emit(state: TestWorkerState): void {
    this.onmessage?.({ data: { type: 'state', state } } as MessageEvent);
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

describe('application navigation', () => {
  beforeEach(() => {
    MockSharedWorker.instances = [];
    vi.stubGlobal('SharedWorker', MockSharedWorker);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('preserves one producer and its state across dashboard/settings navigation', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    const producer = TestBed.inject(ProducerService);
    const initialWorker = MockSharedWorker.instances[0];

    async function navigate(path: string): Promise<void> {
      await router.navigateByUrl(path);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    await navigate('/dashboard');

    const metrics: InstrumentMetrics = {
      instrument: 'ALFA',
      lastPriceCents: 10_200,
      spreadCents: 4,
      volume: 40,
      vwapCents: 10_150,
      imbalance: 0.2,
    };
    initialWorker.port.emit({
      runId: 4,
      settings: { ...DEFAULT_PRODUCER_SETTINGS },
      status: 'paused',
      instruments: [metrics],
      error: null,
      initializationAttempt: 1,
    });

    await navigate('/settings');
    await navigate('/dashboard');

    expect(TestBed.inject(ProducerService)).toBe(producer);
    expect(MockSharedWorker.instances).toHaveLength(1);
    expect(
      initialWorker.port.messages.filter(
        (message) => (message as { type?: string }).type === 'attach',
      ),
    ).toHaveLength(1);
    expect(producer.runId()).toBe(4);
    expect(producer.status()).toBe('paused');
    expect(producer.instruments()).toEqual([metrics]);
  });
});
