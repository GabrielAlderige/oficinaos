import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { Toaster } from '../components/ui/toaster';
import { ApiError } from '../lib/api-client';
import { SessionProvider } from '../lib/session';
import { router } from './router';

const queryClient = new QueryClient({
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
