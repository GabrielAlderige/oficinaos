import '@fontsource-variable/inter';
import '../styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SupplierQuoteForm } from './SupplierQuoteForm';

/**
 * Entrada da página do fornecedor (E11). Mesma receita da página do cliente:
 * sem sessão, sem router, sem TanStack Query e sem o índice do shared — é aberta
 * no celular do balconista, entre um atendimento e outro.
 */
const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado');

document.documentElement.classList.remove('dark');

const token = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() ?? '');

createRoot(root).render(
  <StrictMode>
    <SupplierQuoteForm token={token} />
  </StrictMode>,
);
