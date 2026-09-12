/**
 * Filtros de lista moram na URL (F5 e voltar mantêm a busca). Trocar qualquer
 * filtro volta para a primeira página; `null`/'' remove o parâmetro.
 */
export function withParam(params: URLSearchParams, key: string, value: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  if (key !== 'page') next.delete('page');
  return next;
}
