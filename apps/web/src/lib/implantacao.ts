import { SUPPORT_WHATSAPP } from '@oficinaos/shared';

/**
 * O WhatsApp da equipe já com o pedido da implantação grátis (D92). A mensagem
 * leva o nome da oficina: quem atende sabe na hora qual conta abrir no painel
 * da plataforma.
 */
export function linkDaImplantacao(oficina: string): string {
  const texto = `Olá! Criei a conta da ${oficina} no OficinaOS e quero a implantação grátis.`;
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(texto)}`;
}
