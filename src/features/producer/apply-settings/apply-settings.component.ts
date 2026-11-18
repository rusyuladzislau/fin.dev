import { Component, inject } from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import {
  DEFAULT_PRODUCER_SETTINGS,
  PRODUCER_LIMITS,
  ProducerService,
} from '../../../entities/producer';
import { ButtonComponent } from '../../../shared/ui/button';
import { NumberFieldComponent } from '../../../shared/ui/number-field';
import { SvgIconComponent } from '../../../shared/ui/svg-icon';

function wholeNumberValidator(control: AbstractControl): ValidationErrors | null {
  const value = control.value as unknown;
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'number' && Number.isInteger(value) ? null : { wholeNumber: true };
}

@Component({
  selector: 'app-apply-producer-settings',
  imports: [ReactiveFormsModule, ButtonComponent, NumberFieldComponent, SvgIconComponent],
  templateUrl: './apply-settings.component.html',
})
export class ApplyProducerSettingsComponent {
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly producer = inject(ProducerService);
  protected readonly limits = PRODUCER_LIMITS;

  protected readonly form = this.formBuilder.group({
    instrumentCount: [
      this.producer.activeSettings().instrumentCount,
      [
        Validators.required,
        Validators.min(PRODUCER_LIMITS.instrumentCount.min),
        Validators.max(PRODUCER_LIMITS.instrumentCount.max),
        wholeNumberValidator,
      ],
    ],
    updatesPerBatch: [
      this.producer.activeSettings().updatesPerBatch,
      [
        Validators.required,
        Validators.min(PRODUCER_LIMITS.updatesPerBatch.min),
        Validators.max(PRODUCER_LIMITS.updatesPerBatch.max),
        wholeNumberValidator,
      ],
    ],
    batchIntervalMs: [
      this.producer.activeSettings().batchIntervalMs,
      [
        Validators.required,
        Validators.min(PRODUCER_LIMITS.batchIntervalMs.min),
        Validators.max(PRODUCER_LIMITS.batchIntervalMs.max),
        wholeNumberValidator,
      ],
    ],
  });

  protected apply(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.producer.applySettings(this.form.getRawValue());
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  protected resetDraft(): void {
    this.form.reset({ ...DEFAULT_PRODUCER_SETTINGS });
    this.form.markAsDirty();
    this.form.markAsUntouched();
  }
}
