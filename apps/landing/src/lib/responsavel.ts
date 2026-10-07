/**
 * Quem responde pelo OficinaOS nos termos e na política de privacidade.
 *
 * O documento (CPF hoje, CNPJ quando virar empresa) vem do ambiente na hora do
 * build, e não do código: o repositório é público, e o documento só precisa
 * aparecer no site. Sem ele, o build de produção para — termo sem
 * identificação do fornecedor não vale como termo.
 */
export const RESPONSAVEL = {
  nome: import.meta.env.PUBLIC_RESPONSAVEL_NOME || 'Gabriel Alderige',
  documento: import.meta.env.PUBLIC_RESPONSAVEL_DOC || '',
  cidade: import.meta.env.PUBLIC_RESPONSAVEL_CIDADE || 'Poços de Caldas/MG',
  email: import.meta.env.PUBLIC_CONTATO_EMAIL || 'contato@oficinaosbr.com',
  whatsapp: '(35) 99755-8675',
  whatsappLink: 'https://wa.me/5535997558675',
};

/** "CPF 000.000.000-00" ou "CNPJ 00.000.000/0000-00", pelo número de dígitos. */
export function documentoFormatado(doc: string): string {
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return `CPF ${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `CNPJ ${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (import.meta.env.PROD) {
    throw new Error('PUBLIC_RESPONSAVEL_DOC precisa ser um CPF ou CNPJ para publicar os termos');
  }
  return 'documento a configurar (PUBLIC_RESPONSAVEL_DOC)';
}

/** A data da versão em vigor. Mudou o texto, muda aqui. */
export const VIGENCIA = '7 de outubro de 2026';
