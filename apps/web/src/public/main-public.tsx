import '@fontsource-variable/inter';
import '../styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QuotePage } from './QuotePage';

/**
 * Entrada da página do cliente. De propósito NÃO tem SessionProvider, router
 * do painel nem TanStack Query: é uma tela só, aberta por quem não tem conta,
 * muitas vezes no 3G do celular (ARCHITECTURE §8.2).
 */
const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado');

// a página sempre abre clara: é do cliente, não do painel
document.documentElement.classList.remove('dark');

const token = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() ?? '');

createRoot(root).render(
  <StrictMode>
    <QuotePage token={token} />
  </StrictMode>,
);
