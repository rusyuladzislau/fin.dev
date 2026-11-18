import { Component, computed, input } from '@angular/core';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-slate-500',
  success: 'bg-mint-400',
  warning: 'bg-amber-400',
  danger: 'bg-rose-400',
};

@Component({
  selector: 'app-status-badge',
  template: `
    <span
      class="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-400"
      role="status"
      aria-live="polite"
    >
      <span
        class="size-1.5 rounded-full"
        [class]="dotClass()"
        [class.animate-pulse]="pulse()"
        aria-hidden="true"
      ></span>
      {{ label() }}
    </span>
  `,
})
export class StatusBadgeComponent {
  readonly label = input.required<string>();
  readonly tone = input<StatusTone>('neutral');
  readonly pulse = input(false);

  protected readonly dotClass = computed(() => TONE_CLASSES[this.tone()]);
}
