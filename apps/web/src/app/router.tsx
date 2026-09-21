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
      // fora do AppShell: menu lateral não vai para o papel
      {
        path: '/ordens/:number/imprimir',
        lazy: page(() => import('../features/work-orders/PrintPage'), 'PrintPage'),
      },
      {
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, lazy: page(() => import('../features/home/HomePage'), 'HomePage'), handle: { crumb: 'Início' } },
          {
            path: 'agenda',
            lazy: page(() => import('../features/appointments/AgendaPage'), 'AgendaPage'),
            handle: { crumb: 'Agenda' },
          },
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
          {
            path: 'ordens',
            handle: { crumb: 'Ordens de serviço' },
            children: [
              { index: true, lazy: page(() => import('../features/work-orders/WorkOrdersPage'), 'WorkOrdersPage') },
              { path: 'nova', lazy: page(() => import('../features/work-orders/NewWorkOrderPage'), 'NewWorkOrderPage'), handle: { crumb: 'Nova' } },
              {
                path: ':number',
                handle: { crumb: 'OS' },
                children: [
                  { index: true, lazy: page(() => import('../features/work-orders/WorkOrderPage'), 'WorkOrderPage') },
                  {
                    path: 'cotacoes/:id',
                    lazy: page(() => import('../features/supplier-quotes/SupplierQuotePage'), 'SupplierQuotePage'),
                    handle: { crumb: 'Cotação de peças' },
                  },
                ],
              },
            ],
          },
          { path: 'orcamentos', lazy: page(() => import('../features/quotes/QuotesPage'), 'QuotesPage'), handle: { crumb: 'Orçamentos' } },
          { path: 'servicos', lazy: page(() => import('../features/catalog/ServicesPage'), 'ServicesPage'), handle: { crumb: 'Serviços' } },
          {
            path: 'pecas',
            handle: { crumb: 'Peças' },
            children: [
              { index: true, lazy: page(() => import('../features/catalog/PartsPage'), 'PartsPage') },
              {
                path: 'pesquisa',
                lazy: page(() => import('../features/parts-search/PartsSearchPage'), 'PartsSearchPage'),
                handle: { crumb: 'Pesquisar peças' },
              },
              { path: ':id', lazy: page(() => import('../features/catalog/PartPage'), 'PartPage'), handle: { crumb: 'Peça' } },
            ],
          },
          {
            path: 'fornecedores',
            handle: { crumb: 'Fornecedores' },
            children: [
              { index: true, lazy: page(() => import('../features/suppliers/SuppliersPage'), 'SuppliersPage') },
              { path: ':id', lazy: page(() => import('../features/suppliers/SupplierPage'), 'SupplierPage'), handle: { crumb: 'Fornecedor' } },
            ],
          },
          {
            path: 'compras',
            handle: { crumb: 'Compras' },
            children: [
              { index: true, lazy: page(() => import('../features/purchases/PurchaseOrdersPage'), 'PurchaseOrdersPage') },
              { path: 'novo', lazy: page(() => import('../features/purchases/PurchaseOrderFormPage'), 'PurchaseOrderFormPage'), handle: { crumb: 'Novo pedido' } },
              {
                path: 'sugestao',
                lazy: page(() => import('../features/purchases/PurchaseSuggestionsPage'), 'PurchaseSuggestionsPage'),
                handle: { crumb: 'Sugestão de compra' },
              },
              {
                path: ':id',
                handle: { crumb: 'Pedido' },
                children: [
                  { index: true, lazy: page(() => import('../features/purchases/PurchaseOrderPage'), 'PurchaseOrderPage') },
                  { path: 'editar', lazy: page(() => import('../features/purchases/PurchaseOrderFormPage'), 'PurchaseOrderFormPage'), handle: { crumb: 'Editar' } },
                ],
              },
            ],
          },
          {
            path: 'pos-venda',
            lazy: page(() => import('../features/aftersales/FollowUpsPage'), 'FollowUpsPage'),
            handle: { crumb: 'Pós-venda' },
          },
          {
            path: 'avaliacoes',
            lazy: page(() => import('../features/aftersales/ReviewsPage'), 'ReviewsPage'),
            handle: { crumb: 'Avaliações' },
          },
          {
            path: 'funil',
            lazy: page(() => import('../features/aftersales/LeadsPage'), 'LeadsPage'),
            handle: { crumb: 'Funil' },
          },
          {
            path: 'notas',
            lazy: page(() => import('../features/invoices/InvoicesPage'), 'InvoicesPage'),
            handle: { crumb: 'Notas fiscais' },
          },
          {
            path: 'relatorios',
            lazy: page(() => import('../features/reports/ReportsPage'), 'ReportsPage'),
            handle: { crumb: 'Relatórios' },
          },
          {
            path: 'financeiro',
            handle: { crumb: 'Financeiro' },
            children: [
              { index: true, element: <Navigate to="receber" replace /> },
              {
                path: 'receber',
                lazy: page(() => import('../features/finance/FinancePage'), 'ReceivablesPage'),
                handle: { crumb: 'A receber' },
              },
              {
                path: 'pagar',
                lazy: page(() => import('../features/finance/FinancePage'), 'PayablesPage'),
                handle: { crumb: 'A pagar' },
              },
              {
                path: 'caixa',
                lazy: page(() => import('../features/finance/CashFlowPage'), 'CashFlowPage'),
                handle: { crumb: 'Fluxo de caixa' },
              },
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
              {
                path: 'fiscal',
                lazy: page(() => import('../features/settings/FiscalSettingsPage'), 'FiscalSettingsPage'),
                handle: { crumb: 'Fiscal' },
              },
              { path: 'equipe', lazy: page(() => import('../features/settings/TeamPage'), 'TeamPage'), handle: { crumb: 'Equipe' } },
              {
                path: 'plano',
                lazy: page(() => import('../features/settings/PlanSettingsPage'), 'PlanSettingsPage'),
                handle: { crumb: 'Plano' },
              },
              {
                path: 'automacoes',
                lazy: page(() => import('../features/settings/AutomationsPage'), 'AutomationsPage'),
                handle: { crumb: 'Automações' },
              },
              {
                path: 'importar',
                lazy: page(() => import('../features/settings/ImportPage'), 'ImportPage'),
                handle: { crumb: 'Importar' },
              },
              { path: 'sessoes', lazy: page(() => import('../features/settings/SessionsPage'), 'SessionsPage'), handle: { crumb: 'Sessões' } },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
