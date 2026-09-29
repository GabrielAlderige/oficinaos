import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router';
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
/** Redireciona a ficha do carro mantendo `?q=` (E36). */
function RedirecionaFichaDoCarro() {
  const { search } = useLocation();
  return <Navigate to={`/ficha-do-carro${search}`} replace />;
}

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
      {
        path: '/confirmar-email/:token',
        lazy: page(() => import('../features/auth/VerifyEmailPage'), 'VerifyEmailPage'),
      },
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
            // a tela de quem trabalha no celular (E24)
            path: 'minhas-os',
            lazy: page(() => import('../features/work-orders/MyDayPage'), 'MyDayPage'),
            handle: { crumb: 'Minhas OS' },
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
                ],
              },
            ],
          },
          { path: 'orcamentos', lazy: page(() => import('../features/quotes/QuotesPage'), 'QuotesPage'), handle: { crumb: 'Orçamentos' } },
          {
            path: 'servicos',
            handle: { crumb: 'Serviços' },
            children: [
              { index: true, lazy: page(() => import('../features/catalog/ServicesPage'), 'ServicesPage') },
              {
                path: 'pacotes',
                lazy: page(() => import('../features/catalog/PackagesPage'), 'PackagesPage'),
                handle: { crumb: 'Pacotes' },
              },
            ],
          },
          {
            // tela própria (E36): sai de dentro de "Peças e estoque"
            path: 'ficha-do-carro',
            lazy: page(() => import('../features/catalog/VehicleCatalogPage'), 'VehicleCatalogPage'),
            handle: { crumb: 'Ficha do carro' },
          },
          {
            // quem tiver o endereço antigo salvo continua chegando — e com o
            // que estava pesquisando: `Navigate` sozinho descarta a busca
            path: 'pecas/ficha-do-carro',
            element: <RedirecionaFichaDoCarro />,
          },
          {
            path: 'pecas',
            handle: { crumb: 'Peças e estoque' },
            children: [
              { index: true, lazy: page(() => import('../features/catalog/PartsPage'), 'PartsPage') },
              {
                path: 'recomendacoes',
                lazy: page(() => import('../features/catalog/ReorderPage'), 'ReorderPage'),
                handle: { crumb: 'Recomendações de pedido' },
              },
              { path: ':id', lazy: page(() => import('../features/catalog/PartPage'), 'PartPage'), handle: { crumb: 'Peça' } },
            ],
          },
          {
            // área da PLATAFORMA (E31): fora do menu da oficina de propósito.
            // Quem não é administrador é mandado embora pela própria tela.
            path: 'plataforma/catalogo',
            lazy: page(() => import('../features/platform/CatalogAdminPage'), 'CatalogAdminPage'),
            handle: { crumb: 'Catálogo de veículos' },
          },
          {
            path: 'plataforma/tutoriais',
            lazy: page(() => import('../features/platform/TutorialAdminPage'), 'TutorialAdminPage'),
            handle: { crumb: 'Tutoriais da plataforma' },
          },
          {
            // sem permissão de propósito: quem mais precisa de tutorial é
            // quem está começando, e normalmente não é o dono
            path: 'tutoriais',
            lazy: page(() => import('../features/tutorials/TutorialsPage'), 'TutorialsPage'),
            handle: { crumb: 'Tutoriais' },
          },
          {
            path: 'pos-venda',
            lazy: page(() => import('../features/aftersales/FollowUpsPage'), 'FollowUpsPage'),
            handle: { crumb: 'Pós-venda' },
          },
          {
            path: 'funil',
            lazy: page(() => import('../features/aftersales/LeadsPage'), 'LeadsPage'),
            handle: { crumb: 'Funil' },
          },
          {
            path: 'conversas',
            lazy: page(() => import('../features/messaging/ChatPage'), 'ChatPage'),
            // `wide`: a conversa ocupa a tela inteira, sem a largura de leitura
            handle: { crumb: 'Conversas', wide: true },
          },
          {
            path: 'notas',
            lazy: page(() => import('../features/invoices/InvoicesPage'), 'InvoicesPage'),
            handle: { crumb: 'Notas fiscais', desktop: 'A nota fiscal' },
          },
          {
            path: 'financeiro',
            handle: { crumb: 'Financeiro', desktop: 'O financeiro' },
            children: [
              { index: true, element: <Navigate to="receber" replace /> },
              {
                path: 'receber',
                lazy: page(() => import('../features/finance/FinancePage'), 'ReceivablesPage'),
                handle: { crumb: 'A receber' },
              },
              {
                path: 'caixa',
                lazy: page(() => import('../features/finance/CashFlowPage'), 'CashFlowPage'),
                handle: { crumb: 'Fluxo de caixa' },
              },
              {
                path: 'comissoes',
                lazy: page(() => import('../features/finance/CommissionsPage'), 'CommissionsPage'),
                handle: { crumb: 'Comissões' },
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
                handle: { crumb: 'Fiscal', desktop: 'A configuração fiscal' },
              },
              { path: 'equipe', lazy: page(() => import('../features/settings/TeamPage'), 'TeamPage'), handle: { crumb: 'Equipe' } },
              {
                path: 'plano',
                lazy: page(() => import('../features/settings/PlanSettingsPage'), 'PlanSettingsPage'),
                handle: { crumb: 'Plano' },
              },
              {
                path: 'whatsapp',
                lazy: page(() => import('../features/settings/WhatsAppSettingsPage'), 'WhatsAppSettingsPage'),
                handle: { crumb: 'WhatsApp', desktop: 'A conexão do WhatsApp' },
              },
              {
                path: 'automacoes',
                lazy: page(() => import('../features/settings/AutomationsPage'), 'AutomationsPage'),
                handle: { crumb: 'Automações' },
              },
              {
                path: 'importar',
                lazy: page(() => import('../features/settings/ImportPage'), 'ImportPage'),
                handle: { crumb: 'Importar', desktop: 'A importação de planilha' },
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
