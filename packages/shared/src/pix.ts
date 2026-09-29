/**
 * Pix na hora (E32): o BR Code da própria oficina.
 *
 * Isto NÃO é cobrança em gateway. É o "copia e cola" do Pix, montado a partir
 * da chave da oficina e do valor da OS — o mesmo código que qualquer app de
 * banco lê. O dinheiro cai direto na conta dela, e por isso **o banco não
 * avisa o sistema**: a baixa é manual, e quem usa precisa ser avisado disso na
 * tela (D66).
 *
 * O formato é o EMV QRCPS-MPM do Banco Central: campos `IDTAMANHOVALOR`
 * encadeados, fechando com o CRC16 do que veio antes.
 */

/** Um campo EMV: id de 2 dígitos, tamanho de 2 dígitos, valor. */
const campo = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, '0')}${valor}`;

/**
 * CRC16/CCITT-FALSE (polinômio 0x1021, inicial 0xFFFF) — é o que o padrão do
 * BCB exige. Quatro dígitos hexadecimais em maiúsculas, no fim do código.
 */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Nome e cidade viajam em ASCII no BR Code: acento vira caractere estranho no
 * extrato de alguns bancos. Tira acento, corta o que não é letra/número e
 * limita ao tamanho do campo.
 */
export function textoDoBrCode(valor: string, maximo: number): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maximo)
    .trim();
}

/**
 * O identificador da transação. Só letras e números (o padrão recusa o resto),
 * no máximo 25. Sem identificador, o padrão manda `***`.
 */
export function txidDoBrCode(valor: string): string {
  const limpo = valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 25);
  return limpo || '***';
}

export interface BrCodeInput {
  /** a chave Pix da oficina: CPF/CNPJ, telefone, e-mail ou aleatória */
  key: string;
  /** quem recebe, como aparece no app do cliente */
  merchantName: string;
  merchantCity: string;
  /** em centavos; 0 ou null deixa o cliente digitar o valor */
  amountCents?: number | null;
  /** "OS 12", por exemplo — vira referência no extrato */
  txid?: string;
}

/**
 * Monta o BR Code estático. Estático porque não há gateway: o código vale
 * sozinho, sem nada do outro lado para consultar. Por isso também não leva o
 * indicador de uso único — banco nenhum teria onde conferir se já foi pago.
 */
export function brCode(input: BrCodeInput): string {
  const chave = input.key.trim();
  if (!chave) throw new Error('brCode: chave Pix vazia');

  // o identificador vai em MINÚSCULAS, como no manual do BCB: o padrão trata
  // como indiferente, mas é assim que o exemplo oficial fecha o CRC — e é
  // contra ele que o teste compara
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave);
  const centavos = input.amountCents ?? 0;

  const corpo =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') +
    // valor é opcional: sem ele o cliente digita, que é o certo para doação,
    // não para uma OS fechada
    (centavos > 0 ? campo('54', (centavos / 100).toFixed(2)) : '') +
    campo('58', 'BR') +
    campo('59', textoDoBrCode(input.merchantName, 25) || 'OFICINA') +
    campo('60', textoDoBrCode(input.merchantCity, 15) || 'BRASIL') +
    campo('62', campo('05', txidDoBrCode(input.txid ?? '')));

  const comCrc = `${corpo}6304`;
  return `${comCrc}${crc16(comCrc)}`;
}

/** Mostra a chave sem expor o CPF inteiro numa tela que qualquer um vê. */
export function mascararChavePix(chave: string): string {
  const limpa = chave.trim();
  if (limpa.includes('@')) {
    const [nome, dominio] = limpa.split('@');
    return `${(nome ?? '').slice(0, 2)}***@${dominio ?? ''}`;
  }
  if (limpa.length <= 6) return limpa;
  return `${limpa.slice(0, 3)}***${limpa.slice(-2)}`;
}
