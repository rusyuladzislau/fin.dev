import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProducerService } from '../../entities/producer';
import { ApplyProducerSettingsComponent } from '../../features/producer/apply-settings';
import { SvgIconComponent } from '../../shared/ui/svg-icon';

@Component({
  selector: 'app-settings-page',
  imports: [RouterLink, ApplyProducerSettingsComponent, SvgIconComponent],
  templateUrl: './settings-page.component.html',
})
export class SettingsPageComponent {
  protected readonly producer = inject(ProducerService);
}
