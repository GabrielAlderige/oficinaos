/**
 * Mensagens prontas para o WhatsApp. No V1 o envio é por link `wa.me`: quem
 * aperta "enviar" é a pessoa da oficina, e o texto vai revisável — nada é
 * disparado sozinho, e nenhuma biblioteca não oficial é usada.
 */

import { formatBRL } from './money';
import { formatPlate } from './br/plate';

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

const comPlaca = (vehicle: { make: string; model: string; plate: string | null }) =>
  `${vehicle.make} ${vehicle.model}${vehicle.plate ? ` (${formatPlate(vehicle.plate)})` : ''}`;

/**
 * "Veículo pronto" (E7). Curta de propósito, como a do orçamento: mensagem
 * grande no celular vira parede de texto e ninguém lê até o fim.
 *
 * O saldo em aberto entra só quando existe — é o que faz o cliente chegar com
 * o valor certo, em vez de descobrir no balcão.
 */
export function whatsappVehicleReadyMessage(input: {
  customerName: string;
  shopName: string;
  vehicle: { make: string; model: string; plate: string | null };
  balanceCents: number;
}): string {
  const linhas = [
    `Olá, ${primeiroNome(input.customerName)}! Aqui é da ${input.shopName}.`,
    `Seu ${comPlaca(input.vehicle)} está pronto para retirada.`,
  ];
  if (input.balanceCents > 0) {
    linhas.push(`Ficou ${formatBRL(input.balanceCents)} em aberto, que pode ser acertado na retirada.`);
  }
  linhas.push('Qualquer dúvida, é só responder por aqui.');
  return linhas.join('\n\n');
}

/**
 * Confirmação de agendamento (E8). Quem escreve a data é quem chama, já no
 * relógio da oficina (`calendar.ts`) — a mensagem não tem como adivinhar fuso,
 * e cliente lendo "às 09:00" quando a oficina marcou 08:00 perde a hora.
 */
export function whatsappAppointmentMessage(input: {
  customerName: string;
  shopName: string;
  /** "segunda-feira, 14/09, às 09:00" */
  when: string;
  title: string;
  vehicle: { make: string; model: string; plate: string | null } | null;
}): string {
  const carro = input.vehicle ? ` do seu ${comPlaca(input.vehicle)}` : '';
  return [
    `Olá, ${primeiroNome(input.customerName)}! Aqui é da ${input.shopName}.`,
    `Confirmando o agendamento${carro}: ${input.title}, ${input.when}.`,
    'Consegue vir nesse horário? Se precisar remarcar, é só responder por aqui.',
  ].join('\n\n');
}

/**
 * Pedido de cotação para o fornecedor (E11). Curto e direto, como a oficina
 * escreve no WhatsApp: quem pede, quantas peças, até quando e o link. Nada do
 * cliente da oficina vai na mensagem — nem nome, nem placa.
 */
export function whatsappSupplierQuoteMessage(input: {
  shopName: string;
  contactName: string | null;
  number: number;
  itemCount: number;
  /** "terça, 16/09, às 18:00", já no relógio da oficina */
  expiresAt: string;
  link: string;
}): string {
  const saudacao = input.contactName ? `Olá, ${primeiroNome(input.contactName)}!` : 'Olá!';
  const pecas = input.itemCount === 1 ? '1 peça' : `${input.itemCount} peças`;
  return [
    `${saudacao} Aqui é da ${input.shopName}.`,
    `Pode me passar preço e prazo de ${pecas}? É a cotação nº ${input.number}.`,
    `Responde por este link até ${input.expiresAt}:`,
    input.link,
  ].join('\n\n');
}
