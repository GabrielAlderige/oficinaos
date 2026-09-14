import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
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
const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
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
