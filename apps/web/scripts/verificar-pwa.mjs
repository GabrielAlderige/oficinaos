import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

/**
 * Prova que o aplicativo instala: serve o build de produção, abre no Chromium
 * e confere manifesto, ícones e service worker registrado. Sem isto, "é um
 * PWA" seria só uma frase.
 */
// rodado de dentro de apps/web (npm run pwa:check)
const RAIZ = 'dist';
const TIPOS = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let caminho = join(RAIZ, decodeURIComponent(url.pathname));
  try {
    const dados = await readFile(caminho);
    res.writeHead(200, { 'content-type': TIPOS[extname(caminho)] ?? 'application/octet-stream' });
    res.end(dados);
  } catch {
    // SPA: rota desconhecida cai no index, como o Caddy faz em produção
    const index = await readFile(join(RAIZ, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(index);
  }
});
await new Promise((ok) => servidor.listen(4178, '127.0.0.1', ok));

const browser = await chromium.launch();
const page = await browser.newPage();
const problemas = [];

await page.goto('http://127.0.0.1:4178/entrar');

const manifesto = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return null;
  const resposta = await fetch(link.getAttribute('href'));
  return resposta.ok ? await resposta.json() : null;
});
if (!manifesto) problemas.push('o manifesto não carregou');
else {
  if (manifesto.display !== 'standalone') problemas.push(`display=${manifesto.display}, esperado standalone`);
  if (!manifesto.icons?.some((i) => i.purpose === 'maskable')) problemas.push('falta ícone maskable');
  for (const icone of manifesto.icons ?? []) {
    const resposta = await page.evaluate(async (src) => (await fetch(src)).status, icone.src);
    if (resposta !== 200) problemas.push(`ícone ${icone.src} respondeu ${resposta}`);
  }
  console.log('manifesto:', manifesto.name, '|', manifesto.display, '|', manifesto.icons.length, 'ícones');
}

const registrado = await page.evaluate(async () => {
  const registro = await navigator.serviceWorker.getRegistration();
  return Boolean(registro);
});
if (!registrado) problemas.push('o service worker não se registrou');

const appleIcon = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="apple-touch-icon"]');
  return link ? (await fetch(link.getAttribute('href'))).status : 0;
});
if (appleIcon !== 200) problemas.push(`apple-touch-icon respondeu ${appleIcon}`);

console.log('service worker registrado:', registrado);
console.log('apple-touch-icon:', appleIcon);
console.log(problemas.length ? `PROBLEMAS: ${problemas.join('; ')}` : 'PWA OK');

await browser.close();
servidor.close();
process.exit(problemas.length ? 1 : 0);
