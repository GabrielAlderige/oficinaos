/**
 * Formatação da página do cliente, escrita aqui de propósito.
 *
 * Importar `formatBRL`/`formatPlate` de `@oficinaos/shared` custava **104 kB
 * gzip**: o índice do pacote executa `z.object(...)` no topo de cada schema, o
 * Rollup não consegue descartar, e o Zod inteiro vinha junto. Duas funções de
 * dez linhas não justificam a biblioteca de validação no celular do cliente
 * numa conexão 3G (ARCHITECTURE §8.2, teto de 100 kB de JS).
 *
 * Os TIPOS continuam vindo do shared (`import type` some na compilação), então
 * o contrato com a API segue único.
 */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 124000 → "R$ 1.240,00" */
export const formatBRL = (cents: number): string => brl.format(cents / 100);

const OLD_PLATE = /^[A-Z]{3}\d{4}$/;

/** Placa antiga ganha hífen (ABC-1234); Mercosul vai como está (ABC1D23). */
export function formatPlate(plate: string): string {
  const clean = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return OLD_PLATE.test(clean) ? `${clean.slice(0, 3)}-${clean.slice(3)}` : clean;
}

const date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const formatDate = (iso: string): string => date.format(new Date(iso));

/**
 * "+5511987654321" → "(11) 98765-4321". O banco guarda o número cru; mostrar
 * assim para o cliente parece sistema mal-acabado — e é a página que ele lê
 * antes de decidir se confia na oficina.
 */
export function formatPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return phone;
}

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/** "16/09, 14:30" no horário de Brasília: o prazo que o fornecedor lê. */
export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));

/** 15000 → "150,00": o valor como a pessoa digitaria de novo. */
export const formatCentsInput = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * O que o balconista digita → centavos. "150", "150,5", "1.250,00", "R$ 89,90"
 * e "89.90" viram valor; o resto vira null (a tela pede de novo). Sem vírgula,
 * ponto seguido de 3 dígitos é milhar ("1.250"), com 1 ou 2 é decimal ("89.9").
 */
export function parseCents(texto: string): number | null {
  const limpo = texto.replace(/R\$|\s/g, '');
  const partes = /^([\d.]+?)(?:[,.](\d{1,2}))?$/.exec(limpo);
  if (!partes) return null;
  const [, inteiro = '', decimais = ''] = partes;
  // com vírgula o ponto só pode ser milhar; ponto no inteiro precisa ter cara de milhar
  if (limpo.includes(',') && limpo.indexOf(',') !== limpo.length - decimais.length - 1) return null;
  if (inteiro.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(inteiro)) return null;
  return Number(inteiro.replace(/\./g, '')) * 100 + Number(decimais.padEnd(2, '0'));
}
