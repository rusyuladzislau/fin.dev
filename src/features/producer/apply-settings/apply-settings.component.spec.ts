import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRODUCER_SETTINGS,
  ProducerService,
  ProducerSettings,
} from '../../../entities/producer';
import { ApplyProducerSettingsComponent } from './apply-settings.component';

describe('ApplyProducerSettingsComponent', () => {
  let fixture: ComponentFixture<ApplyProducerSettingsComponent>;
  let activeSettingsState: WritableSignal<ProducerSettings>;
  let applySettings: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    activeSettingsState = signal({ ...DEFAULT_PRODUCER_SETTINGS });
    applySettings = vi.fn();

    await TestBed.configureTestingModule({
      imports: [ApplyProducerSettingsComponent],
      providers: [
        {
          provide: ProducerService,
          useValue: {
            activeSettings: activeSettingsState.asReadonly(),
            applySettings,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ApplyProducerSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function setInput(fieldId: string, value: string): void {
    const input = fixture.nativeElement.querySelector(`#${fieldId}`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  }

  function submit(): void {
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  it('keeps the active producer unchanged while editing the draft', () => {
    setInput('instrumentCount', '6');
    setInput('updatesPerBatch', '250');
    setInput('batchIntervalMs', '100');

    expect(applySettings).not.toHaveBeenCalled();
    expect(activeSettingsState()).toEqual(DEFAULT_PRODUCER_SETTINGS);
  });

  it('shows validation and prevents Apply for a decimal value', () => {
    setInput('instrumentCount', '5.5');
    const submitButton = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;

    expect(submitButton.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Use a whole number.');

    submit();
    expect(applySettings).not.toHaveBeenCalled();
  });

  it('submits all valid draft settings together', () => {
    setInput('instrumentCount', '6');
    setInput('updatesPerBatch', '250');
    setInput('batchIntervalMs', '100');

    submit();

    expect(applySettings).toHaveBeenCalledOnce();
    expect(applySettings).toHaveBeenCalledWith({
      instrumentCount: 6,
      updatesPerBatch: 250,
      batchIntervalMs: 100,
    });
  });
});
