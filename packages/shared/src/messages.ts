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
