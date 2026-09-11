/**
 * Dados de contato mascarados para quem não tem `customers:view_contact`
 * (o mecânico vê nome e carro, não telefone, CPF nem endereço: ARCHITECTURE §7).
 * Mostra o suficiente para reconhecer ("final 4321"), não para usar.
 */
const DOT = '•';

export function maskPhone(e164: string | null): string | null {
  if (!e164) return null;
  const digits = e164.replace(/\D/g, '').replace(/^55/, '');
  const rest = digits.slice(2);
  return `(${digits.slice(0, 2)}) ${DOT.repeat(Math.max(rest.length - 4, 0))}-${rest.slice(-4)}`;
}

export function maskDocument(document: string | null): string | null {
  if (!document) return null;
  if (document.length === 11) return `${DOT.repeat(3)}.${DOT.repeat(3)}.${DOT.repeat(3)}-${document.slice(-2)}`;
  return `${DOT.repeat(2)}.${DOT.repeat(3)}.${DOT.repeat(3)}/${DOT.repeat(4)}-${document.slice(-2)}`;
}

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}${DOT.repeat(3)}@${domain}`;
}
