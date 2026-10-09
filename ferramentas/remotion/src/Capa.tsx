import React from "react";
import { AbsoluteFill } from "remotion";
import { theme } from "./theme";
import { Fundo, Grade, Grao, Vinheta } from "./componentes/Camadas";
import { Marca } from "./componentes/Icones";

/**
 * Imagem de pré-visualização do link (og:image, 1200x630): é o que aparece
 * quando o endereço do OficinaOS é colado no WhatsApp. Renderizar no quadro 60,
 * com o fundo já assentado.
 */
export const Capa: React.FC = () => (
  <AbsoluteFill style={{ background: theme.colors.bg, fontFamily: theme.fonts.display }}>
    <Fundo />
    <AbsoluteFill style={{ padding: "78px 90px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 34 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <Marca tam={96} />
        <div style={{ fontSize: 58, fontWeight: 800, color: theme.colors.text, letterSpacing: "-0.02em" }}>
          Oficina<span style={{ color: theme.colors.textDim }}>OS</span>
        </div>
      </div>
      <div style={{ fontSize: 76, fontWeight: 900, lineHeight: 1.05, letterSpacing: "-0.03em", color: theme.colors.text }}>
        O cliente aprova o orçamento
        <br />
        <span style={{ color: theme.colors.primary }}>pelo celular.</span>
      </div>
      <div style={{ fontSize: 34, fontWeight: 600, color: theme.colors.textDim }}>
        Sistema para oficina mecânica · 14 dias grátis, sem cartão
      </div>
    </AbsoluteFill>
    <Grade />
    <Grao />
    <Vinheta />
  </AbsoluteFill>
);
