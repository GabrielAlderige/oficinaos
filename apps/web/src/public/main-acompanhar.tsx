import '@fontsource-variable/inter';
import '../styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackingPage } from './TrackingPage';

/**
 * Entrada da página "acompanhe seu veículo" (E17). Mesma receita das outras
 * públicas: sem sessão, sem router e sem o painel junto.
 */
const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado');

document.documentElement.classList.remove('dark');

const token = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() ?? '');

createRoot(root).render(
  <StrictMode>
    <TrackingPage token={token} />
  </StrictMode>,
);
