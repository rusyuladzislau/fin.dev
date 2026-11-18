import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('../pages/dashboard').then((module) => module.DashboardPageComponent),
  },
  {
    path: 'settings',
    loadComponent: () => import('../pages/settings').then((module) => module.SettingsPageComponent),
  },
  { path: '**', redirectTo: 'dashboard' },
];
