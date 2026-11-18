import { Component, computed, ElementRef, input, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-number-field',
  imports: [ReactiveFormsModule],
  templateUrl: './number-field.component.html',
  host: { class: 'block' },
})
export class NumberFieldComponent {
  readonly fieldId = input.required<string>();
  readonly label = input.required<string>();
  readonly hint = input.required<string>();
  readonly control = input.required<FormControl<number>>();
  readonly min = input.required<number>();
  readonly max = input.required<number>();
  readonly unit = input('');

  private readonly numberInput = viewChild.required<ElementRef<HTMLInputElement>>('numberInput');

  protected readonly hintId = computed(() => `${this.fieldId()}Hint`);
  protected readonly errorId = computed(() => `${this.fieldId()}Error`);
  protected readonly rangeLabel = computed(() => {
    const range = `${this.min().toLocaleString('en-US')}–${this.max().toLocaleString('en-US')}`;
    return this.unit() ? `${range} ${this.unit()}` : range;
  });

  protected showError(): boolean {
    const control = this.control();
    return (this.hasBadInput() || control.invalid) && (control.touched || control.dirty);
  }

  protected errorMessage(): string {
    if (this.hasBadInput()) return 'Enter a valid number.';

    const errors = this.control().errors;
    if (!errors) return '';
    if (errors['required']) return 'This value is required.';
    if (errors['wholeNumber']) return 'Use a whole number.';
    if (errors['min']) return `Minimum value: ${this.min()}.`;
    if (errors['max']) return `Maximum value: ${this.max().toLocaleString('en-US')}.`;
    return 'Enter a valid number.';
  }

  private hasBadInput(): boolean {
    return this.numberInput().nativeElement.validity.badInput;
  }
}
