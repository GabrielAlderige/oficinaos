import { canonicalPlatePrefix, canonicalPlateSuffix } from '@oficinaos/shared';
import { or, sql, type SQL } from 'drizzle-orm';

/**
 * "Isto é um pedaço de placa?" — a mesma regra em toda busca do sistema.
 *
 * Bate pelo COMEÇO ("DEM1", "abc-12") ou pelo FINAL ("1A05", "05": no balcão
 * se fala "o carro final 05"), sempre contra a placa canônica (Mercosul).
 * Por isso a placa antiga também acha o carro convertido: "DEM-1005" e "1005"
 * viram "DEM1A05" e "1A05" antes de comparar. Antes, cada tela tinha a sua
 * regra, e a lista de OS não achava pela placa antiga o que a de veículos achava.
 *
 * `coluna` é a placa canônica já qualificada (`vehicles.plate_canonical`,
 * `v.plate_canonical`): em subconsulta o Drizzle não qualifica sozinho.
 */
export function plateMatches(coluna: SQL, q: string): SQL | undefined {
  const condicoes: SQL[] = [];
  const comeco = canonicalPlatePrefix(q);
  if (comeco) condicoes.push(sql`${coluna} like ${`${comeco}%`}`);
  const fim = canonicalPlateSuffix(q);
  if (fim) condicoes.push(sql`${coluna} like ${`%${fim}`}`);
  return condicoes.length ? or(...condicoes) : undefined;
}
