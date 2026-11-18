import { Component, computed, input, numberAttribute } from '@angular/core';

export type SvgIconName =
  'activity' | 'alert' | 'dashboard' | 'info' | 'pause' | 'play' | 'reset' | 'settings' | 'sliders';

@Component({
  selector: 'app-svg-icon',
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.stroke-width]="strokeWidth()"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <use [attr.href]="href()" />
    </svg>
  `,
  host: { class: 'inline-flex shrink-0' },
})
export class SvgIconComponent {
  readonly name = input.required<SvgIconName>();
  readonly size = input(17, { transform: numberAttribute });
  readonly strokeWidth = input(2, { transform: numberAttribute });

  protected readonly href = computed(() => `/icons/sprite.svg#${this.name()}`);
}
