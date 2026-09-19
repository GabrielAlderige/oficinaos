/**
 * Autopreenchimento de endereço pelo CEP (ROADMAP: integração de Fase 1).
 *
 * Duas fontes públicas e gratuitas, nessa ordem: **BrasilAPI** e, se ela não
 * responder, **ViaCEP**. São dados públicos dos Correios; nenhuma chave, nada
 * do cliente sai daqui — vai só o CEP.
 *
 * A consulta é do NAVEGADOR de propósito: a API não precisa virar
 * intermediária de um dado público, e assim um CEP fora do ar nunca derruba o
 * salvamento do cadastro. **Preencher é sugestão**: todo campo continua
 * editável, porque endereço de oficina em bairro novo muitas vezes não está
 * na base.
 */

export interface EnderecoDoCep {
  street: string;
  district: string;
  city: string;
  state: string;
}

export const somenteDigitos = (valor: string): string => valor.replace(/\D/g, '');

/** "01310100" → "01310-100". O que a pessoa vê enquanto digita. */
export function formatCep(valor: string): string {
  const digitos = somenteDigitos(valor).slice(0, 8);
  return digitos.length > 5 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : digitos;
}

export const cepCompleto = (valor: string): boolean => somenteDigitos(valor).length === 8;

const TIMEOUT_MS = 4_000;

async function comTempoLimite(url: string): Promise<Response> {
  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controlador.signal });
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Busca o endereço. Devolve `null` quando o CEP não existe ou as duas fontes
 * estão fora do ar — quem chama trata isso como "digite à mão", nunca como
 * erro de formulário.
 */
export async function buscarCep(valor: string): Promise<EnderecoDoCep | null> {
  const cep = somenteDigitos(valor);
  if (cep.length !== 8) return null;

  try {
    const resposta = await comTempoLimite(`https://brasilapi.com.br/api/cep/v1/${cep}`);
    if (resposta.ok) {
      const dados = (await resposta.json()) as { street?: string; neighborhood?: string; city?: string; state?: string };
      return {
        street: dados.street ?? '',
        district: dados.neighborhood ?? '',
        city: dados.city ?? '',
        state: dados.state ?? '',
      };
    }
    // 404 é CEP inexistente: não adianta tentar a segunda fonte
    if (resposta.status === 404) return null;
  } catch {
    // rede fora ou tempo esgotado: cai para a segunda fonte
  }

  try {
    const resposta = await comTempoLimite(`https://viacep.com.br/ws/${cep}/json/`);
    if (!resposta.ok) return null;
    const dados = (await resposta.json()) as {
      erro?: boolean | string;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
    };
    if (dados.erro) return null;
    return {
      street: dados.logradouro ?? '',
      district: dados.bairro ?? '',
      city: dados.localidade ?? '',
      state: dados.uf ?? '',
    };
  } catch {
    return null;
  }
}
