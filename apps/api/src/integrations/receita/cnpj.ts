import type { TaxRegime } from '@oficinaos/shared';

/**
 * O regime tributário da oficina pela Receita (E51), via BrasilAPI (pública,
 * sem chave). O que ela devolve e o quanto dá para confiar:
 *
 * - `opcao_pelo_mei` e `opcao_pelo_simples`: atualizados (cadastro do Simples);
 * - `regime_tributario`: a forma de tributação declarada por ano (Lucro
 *   Presumido, Real...), que chega com ATRASO — em 2026 o último ano é 2024.
 *
 * Por isso o resultado é sugestão: a tela mostra de onde veio e a oficina
 * confirma ou troca.
 */
export interface RegimeNaReceita {
  regime: TaxRegime | null;
  /** o que a Receita disse, em português, para a tela */
  detail: string;
}

export type ConsultaCnpj = (cnpj: string) => Promise<RegimeNaReceita | null>;

interface RespostaBrasilApi {
  opcao_pelo_mei?: boolean | null;
  opcao_pelo_simples?: boolean | null;
  data_opcao_pelo_mei?: string | null;
  data_opcao_pelo_simples?: string | null;
  regime_tributario?: { ano?: number | null; forma_de_tributacao?: string | null }[] | null;
}

const dataBR = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : null);

/** Pura: a resposta da BrasilAPI vira regime + explicação. Testada sem rede. */
export function interpretarCnpj(dados: RespostaBrasilApi): RegimeNaReceita {
  if (dados.opcao_pelo_mei) {
    const desde = dataBR(dados.data_opcao_pelo_mei);
    return { regime: 'MEI', detail: `MEI${desde ? ` desde ${desde}` : ''}, segundo a Receita` };
  }
  if (dados.opcao_pelo_simples) {
    const desde = dataBR(dados.data_opcao_pelo_simples);
    return { regime: 'SIMPLES_NACIONAL', detail: `Optante pelo Simples Nacional${desde ? ` desde ${desde}` : ''}, segundo a Receita` };
  }
  const ultimo = [...(dados.regime_tributario ?? [])]
    .filter((r) => r.ano && r.forma_de_tributacao)
    .sort((a, b) => (b.ano ?? 0) - (a.ano ?? 0))[0];
  const forma = ultimo?.forma_de_tributacao?.toUpperCase() ?? '';
  const regime: TaxRegime | null = forma.includes('PRESUMIDO') ? 'LUCRO_PRESUMIDO' : forma.includes('REAL') ? 'LUCRO_REAL' : null;
  if (ultimo && regime) {
    const nome = regime === 'LUCRO_PRESUMIDO' ? 'Lucro Presumido' : 'Lucro Real';
    return { regime, detail: `${nome} em ${ultimo.ano}, último ano informado pela Receita` };
  }
  return {
    regime: null,
    detail: ultimo
      ? `A Receita informa "${ultimo.forma_de_tributacao}" em ${ultimo.ano}: escolha o regime com o seu contador`
      : 'A Receita não informa o regime desta empresa: escolha com o seu contador',
  };
}

/** A consulta de verdade. Falha de rede ou CNPJ desconhecido vira `null`, nunca erro na tela. */
export const consultaBrasilApi: ConsultaCnpj = async (cnpj) => {
  try {
    const resposta = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`, {
      signal: AbortSignal.timeout(8_000),
      headers: { accept: 'application/json' },
    });
    if (!resposta.ok) return null;
    return interpretarCnpj((await resposta.json()) as RespostaBrasilApi);
  } catch {
    return null;
  }
};
