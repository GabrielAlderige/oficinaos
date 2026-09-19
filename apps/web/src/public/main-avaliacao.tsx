import '@fontsource-variable/inter';
import '../styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReviewPage } from './ReviewPage';

/**
 * Entrada da página de avaliação (E16). Mesma receita das outras públicas: sem
 * sessão, sem router e sem o painel junto — ela abre no celular do cliente.
 */
const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado');

document.documentElement.classList.remove('dark');

const token = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() ?? '');

createRoot(root).render(
  <StrictMode>
    <ReviewPage token={token} />
  </StrictMode>,
);
