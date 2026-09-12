import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { FullPageSpinner } from '../components/brand';
import { LoginPage } from '../features/auth/LoginPage';
import { PublicOnly, RequireAuth } from './guards';
import { AppShell } from './layouts/AppShell';
import { AuthLayout } from './layouts/AuthLayout';
import { NotFoundPage } from './NotFoundPage';

// Code splitting por rota (ARCHITECTURE §15): só o login vai no pacote inicial;
// cada tela baixa na primeira visita.
const page = <T extends Record<string, ComponentType>>(load: () => Promise<T>, name: keyof T) => async () => ({
  Component: (await load())[name],
});

// URLs em português: é o que a equipe da oficina lê e compartilha (ARCHITECTURE §13.1).
export const router = createBrowserRouter([
  {
    element: <PublicOnly />,
    HydrateFallback: FullPageSpinner,
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: '/entrar', element: <LoginPage /> },
          { path: '/criar-conta', lazy: page(() => import('../features/auth/SignupPage'), 'SignupPage') },
          { path: '/esqueci-senha', lazy: page(() => import('../features/auth/ForgotPasswordPage'), 'ForgotPasswordPage') },
        ],
      },
    ],
  },
  {
    // abrem com ou sem sessão (o link chega por e-mail/WhatsApp)
    element: <AuthLayout />,
    HydrateFallback: FullPageSpinner,
    children: [
      { path: '/redefinir-senha/:token', lazy: page(() => import('../features/auth/ResetPasswordPage'), 'ResetPasswordPage') },
      { path: '/convite/:token', lazy: page(() => import('../features/auth/InvitePage'), 'InvitePage') },
    ],
  },
  {
    element: <RequireAuth />,
    HydrateFallback: FullPageSpinner,
    children: [
      {
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, lazy: page(() => import('../features/home/HomePage'), 'HomePage'), handle: { crumb: 'Início' } },
          {
            path: 'clientes',
            handle: { crumb: 'Clientes' },
            children: [
              { index: true, lazy: page(() => import('../features/customers/CustomersPage'), 'CustomersPage') },
              { path: ':id', lazy: page(() => import('../features/customers/CustomerPage'), 'CustomerPage'), handle: { crumb: 'Cliente' } },
            ],
          },
          {
            path: 'veiculos',
            handle: { crumb: 'Veículos' },
            children: [
              { index: true, lazy: page(() => import('../features/vehicles/VehiclesPage'), 'VehiclesPage') },
              { path: ':id', lazy: page(() => import('../features/vehicles/VehiclePage'), 'VehiclePage'), handle: { crumb: 'Veículo' } },
            ],
          },
          { path: 'servicos', lazy: page(() => import('../features/catalog/ServicesPage'), 'ServicesPage'), handle: { crumb: 'Serviços' } },
          {
            path: 'pecas',
            handle: { crumb: 'Peças' },
            children: [
              { index: true, lazy: page(() => import('../features/catalog/PartsPage'), 'PartsPage') },
              { path: ':id', lazy: page(() => import('../features/catalog/PartPage'), 'PartPage'), handle: { crumb: 'Peça' } },
            ],
          },
          {
            path: 'configuracoes',
            lazy: page(() => import('../features/settings/SettingsLayout'), 'SettingsLayout'),
            handle: { crumb: 'Configurações' },
            children: [
              { index: true, element: <Navigate to="oficina" replace /> },
              {
                path: 'oficina',
                lazy: page(() => import('../features/settings/OrganizationSettingsPage'), 'OrganizationSettingsPage'),
                handle: { crumb: 'Oficina' },
              },
              {
                path: 'precos',
                lazy: page(() => import('../features/settings/PricingSettingsPage'), 'PricingSettingsPage'),
                handle: { crumb: 'Preços e estoque' },
              },
              { path: 'equipe', lazy: page(() => import('../features/settings/TeamPage'), 'TeamPage'), handle: { crumb: 'Equipe' } },
              { path: 'sessoes', lazy: page(() => import('../features/settings/SessionsPage'), 'SessionsPage'), handle: { crumb: 'Sessões' } },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
