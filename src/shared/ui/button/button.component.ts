import { Component, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary';
export type ButtonType = 'button' | 'submit';

const BASE_CLASSES =
  'inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-5 text-sm transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-mint-400 font-semibold text-ink-950 hover:bg-mint-500 focus-visible:outline-mint-400',
  secondary:
    'px-4 font-medium text-slate-400 hover:bg-ink-800 hover:text-slate-100 focus-visible:outline-slate-400',
};

@Component({
  selector: 'app-button',
  template: `
    <button [type]="type()" [disabled]="disabled()" [class]="buttonClass()">
      <ng-content />
    </button>
  `,
  host: { class: 'inline-flex' },
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly type = input<ButtonType>('button');
  readonly disabled = input(false);

  protected readonly buttonClass = computed(
    () => `${BASE_CLASSES} ${VARIANT_CLASSES[this.variant()]}`,
  );
}
