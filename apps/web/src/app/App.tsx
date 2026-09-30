import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { toast } from 'sonner';
import { Toaster } from '../components/ui/toaster';
import { ApiError } from '../lib/api-client';
import { SessionProvider } from '../lib/session';
import { router } from './router';

/**
 * Quase toda gravação do sistema mexe em algum número do painel: cancelar uma
 * OS tira o carro do pátio, registrar um pagamento muda o recebido, marcar um
 * horário muda os agendamentos de hoje. Em vez de lembrar de invalidar o
 * dashboard em cada mutação — e esquecer na próxima —, **qualquer** mutação
 * bem-sucedida marca o painel como velho, e ele rebusca ao ser aberto.
 *
 * Era exatamente isso que faltava: com `staleTime` de 30 s e sem invalidação, o
 * Início mostrava o pátio de antes do cancelamento.
 */
/**
 * Esbarrou numa funcionalidade fora do plano (E40): a API responde 402 e o
 * painel oferece a saída, em vez de só dizer "não deu".
 *
 * Fica aqui, global, de propósito: assim vale para QUALQUER ação do sistema
 * sem cada tela ter de lembrar. A pessoa que esbarra normalmente é a dona da
 * oficina, então ela é exatamente quem pode resolver — e o caminho é um clique.
 */
function ofereceOPlano(error: unknown): void {
  if (!(error instanceof ApiError) || error.code !== 'PLAN_FEATURE_REQUIRED') return;
  toast.error(error.problem?.title ?? 'Não está no seu plano', {
    description: error.problem?.detail,
    duration: 10_000,
    action: {
      label: 'Ver planos',
      onClick: () => void router.navigate('/configuracoes/plano'),
    },
  });
}

const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: ofereceOPlano,
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // erro do cliente (4xx) não melhora tentando de novo; falha de rede/servidor, sim
      retry: (count, error) =>
        count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <RouterProvider router={router} />
        <Toaster />
      </SessionProvider>
    </QueryClientProvider>
  );
}
