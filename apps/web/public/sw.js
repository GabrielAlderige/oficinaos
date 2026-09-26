/**
 * O que faz o OficinaOS abrir como aplicativo no celular.
 *
 * Duas regras, e só duas — é de propósito:
 *
 * 1. **Os arquivos do aplicativo ficam guardados** (o HTML, o JS e o CSS, que
 *    têm hash no nome). É isso que faz o ícone abrir na hora, mesmo com o 3G
 *    ruim do fundo da oficina.
 * 2. **Dado da oficina NUNCA é guardado.** Nenhuma resposta de `/api` passa
 *    por aqui. Mostrar saldo, estoque ou OS de ontem como se fosse de agora é
 *    pior do que dizer "sem conexão" — ninguém confere o que parece certo.
 *
 * Sem conexão, o aplicativo abre e avisa. Com conexão, tudo vem do servidor.
 */

const VERSAO = 'oficinaos-v1';
const ESSENCIAIS = ['/', '/index.html', '/manifest.webmanifest', '/icone-192.png', '/icone-512.png'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(VERSAO)
      .then((cache) => cache.addAll(ESSENCIAIS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  // versão nova entra e leva a antiga junto: aplicativo velho em cache é bug
  // que ninguém consegue reproduzir
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((chave) => chave !== VERSAO).map((chave) => caches.delete(chave))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== 'GET') return;

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin) return;
  // a API fica fora do cache, sempre (regra 2)
  if (url.pathname.startsWith('/api/')) return;

  // navegação: tenta a rede e cai no aplicativo guardado quando não há sinal
  if (requisicao.mode === 'navigate') {
    evento.respondWith(
      fetch(requisicao).catch(async () => (await caches.match('/index.html')) ?? Response.error()),
    );
    return;
  }

  // arquivo com hash no nome nunca muda: serve do cache e busca uma vez só
  evento.respondWith(
    caches.match(requisicao).then((guardado) => {
      if (guardado) return guardado;
      return fetch(requisicao).then((resposta) => {
        if (resposta.ok && (url.pathname.startsWith('/assets/') || ESSENCIAIS.includes(url.pathname))) {
          const copia = resposta.clone();
          void caches.open(VERSAO).then((cache) => cache.put(requisicao, copia));
        }
        return resposta;
      });
    }),
  );
});
