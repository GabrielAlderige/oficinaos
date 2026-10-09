import React, { createContext, useContext } from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { ip } from "./Movimento";

/**
 * Embrulho de cada cena: entra com zoom de fora e desfoque (mola suave) e sai
 * mais rápido do que entrou, empurrada para cima e desfocada.
 * `dur` é a duração da cena em quadros; a saída acontece depois dela.
 */
export const Palco: React.FC<{ dur: number; ultima: boolean; children: React.ReactNode }> = ({ dur, ultima, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // a nova cena espera 3 quadros: a anterior já está quase apagada quando ela chega
  const e = spring({ frame: frame - 3, fps, config: theme.spring.smooth });
  const s = ultima ? 0 : ip(frame, [dur, dur + theme.tempo.saida], [0, 1], theme.ease.in);
  return (
    <AbsoluteFill
      style={{
        opacity: Math.min(ip(e, [0, 0.5], [0, 1]), 1 - ip(s, [0, 0.6], [0, 1])),
        transform: `translateY(${-s * 140}px) scale(${(1.07 - 0.07 * e) * (1 - 0.05 * s)})`,
        filter: `blur(${ip(e, [0, 0.6], [14, 0]) + s * 18}px)`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** Centro vertical do conteúdo: acima da legenda, ou no meio da tela quando o reel não tem legenda. */
export const CentroCtx = createContext<number>(theme.layout.centro);
export const useCentro = () => useContext(CentroCtx);

/** Área do conteúdo: centrada acima da legenda, com as margens laterais. */
export const Area: React.FC<{ centro?: number; gap?: number; alinhar?: "flex-start" | "center"; children: React.ReactNode }> = ({ centro, gap = 40, alinhar = "flex-start", children }) => {
  const padrao = useCentro();
  return (
  <div
    style={{
      position: "absolute",
      left: theme.layout.margem,
      right: theme.layout.margem,
      top: centro ?? padrao,
      transform: "translateY(-50%)",
      display: "flex",
      flexDirection: "column",
      alignItems: alinhar,
      gap,
    }}
  >
    {children}
  </div>
  );
};

/** Clarão curto no corte entre cenas. */
export const Clarao: React.FC<{ cortes: number[] }> = ({ cortes }) => {
  const frame = useCurrentFrame();
  const v = Math.max(0, ...cortes.map((c) => (frame >= c && frame < c + 6 ? ip(frame, [c, c + 6], [0.2, 0], theme.ease.out) : 0)));
  return <AbsoluteFill style={{ background: theme.colors.text, opacity: v, pointerEvents: "none" }} />;
};
