import '@fontsource-variable/inter';
import '../styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PortalPage } from './PortalPage';

/**
 * Entrada do app do cliente (E50). Mesma receita das outras
 * públicas: sem sessão, sem router e sem o painel junto.
 */
const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado');

document.documentElement.classList.remove('dark');

const token = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() ?? '');

createRoot(root).render(
  <StrictMode>
    <PortalPage token={token} />
  </StrictMode>,
);
