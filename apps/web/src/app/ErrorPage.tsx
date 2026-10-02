import { useEffect } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { NotFoundPage } from './NotFoundPage';

/** Quando esta aba recarregou por causa de versão nova (ms desde 1970). */
const RECARREGOU = 'oficinaos:recarregou-versao';
/** Recarga mais recente que isto quer dizer que recarregar não resolveu. */
const JANELA_MS = 60_000;

/**
 * A tela baixou um pedaço do sistema que não existe mais: publicamos versão
 * nova e o navegador ainda estava na antiga. O nome do arquivo muda a cada
 * build, então o pedido dá 404 e o import falha.
 */
function ehVersaoNova(erro: unknown): boolean {
  const texto = erro instanceof Error ? erro.message : String(erro);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    texto,
  );
}

function recarregouAgora(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(RECARREGOU) ?? 0) < JANELA_MS;
  } catch {
    return true; // sem como lembrar, melhor não arriscar o laço
  }
}

function gravarMarca(valor: boolean): void {
  try {
    if (valor) sessionStorage.setItem(RECARREGOU, String(Date.now()));
    else sessionStorage.removeItem(RECARREGOU);
  } catch {
    // sem sessionStorage (aba anônima restrita): no pior caso a pessoa clica em recarregar
  }
}

/**
 * Quando uma tela quebra, a oficina vê isto — e não a página crua do React
 * Router, em inglês, com a pilha do erro.
 *
 * Versão nova publicada recarrega sozinha. Se já recarregou no último minuto,
 * não tenta de novo: o problema é outro (sem internet, por exemplo) e insistir
 * viraria um laço. Qualquer outro erro mostra o que fazer e o botão de recarregar.
 *
 * `dentroDoPainel` mantém o menu em volta: a pessoa troca de tela pelo menu
 * em vez de perder o lugar.
 */
export function ErrorPage({ dentroDoPainel = false }: { dentroDoPainel?: boolean }) {
  const erro = useRouteError();
  const versaoNova = ehVersaoNova(erro);
  const vaiRecarregar = versaoNova && !recarregouAgora();

  useEffect(() => {
    if (vaiRecarregar) {
      gravarMarca(true);
      window.location.reload();
    }
  }, [vaiRecarregar]);

  if (isRouteErrorResponse(erro) && erro.status === 404) return <NotFoundPage />;
  if (vaiRecarregar) return null;
  if (import.meta.env.DEV) console.error(erro);

  const conteudo = (
    <div className="mx-auto max-w-md text-center">
      <p className="text-sm font-semibold text-accent dark:text-accent-bright">
        {versaoNova ? 'Versão nova' : 'Algo deu errado'}
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {versaoNova ? 'O OficinaOS foi atualizado' : 'Esta tela não abriu'}
      </h1>
      <p className="mt-2 text-muted">
        {versaoNova
          ? 'Não foi possível baixar a versão nova. Confira a internet e recarregue a página.'
          : 'Nada do que você já salvou se perdeu. Recarregue a página; se continuar, volte ao início e tente de novo.'}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => {
            gravarMarca(false);
            window.location.reload();
          }}
          className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground hover:bg-accent-hover"
        >
          Recarregar a página
        </button>
        <Link
          to="/"
          reloadDocument
          className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted"
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );

  return dentroDoPainel ? (
    <div role="alert" className="py-16">
      {conteudo}
    </div>
  ) : (
    <main role="alert" className="grid min-h-dvh place-items-center px-4">
      {conteudo}
    </main>
  );
}
