import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import type { Bloco } from "../tipos";
import { ip } from "./Movimento";

/** Legenda falada: até 4 palavras por vez, a palavra dita agora acende em âmbar. */
export const Legenda: React.FC<{ blocos: Bloco[] }> = ({ blocos }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const bloco = blocos.find((b) => t >= b.inicio && t < b.fim + 0.25);
  if (!bloco) return null;
  const saida = ip(t, [bloco.fim + 0.12, bloco.fim + 0.25], [0, 1], theme.ease.in);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: theme.layout.legenda,
          left: theme.layout.margem,
          right: theme.layout.margem,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0px 22px",
          fontSize: 62,
          fontWeight: 800,
          lineHeight: 1.18,
          opacity: 1 - saida,
          transform: `translateY(${-saida * 20}px)`,
        }}
      >
        {bloco.palavras.map((w, k) => {
          const m = spring({ frame: frame - Math.round((w.t - 0.06) * fps), fps, config: theme.spring.snappy });
          const ativa = t >= w.t - 0.05 && t < w.fim + 0.08;
          return (
            <span
              key={k}
              style={{
                display: "inline-block",
                transformOrigin: "center bottom",
                color: ativa ? theme.colors.accent : theme.colors.text,
                opacity: ip(m, [0, 0.4], [0, 1]),
                transform: `translateY(${(1 - m) * 28}px) scale(${(0.9 + 0.1 * m) * (ativa ? 1.08 : 1)})`,
                textShadow: `0 6px 24px rgba(0,0,0,.85), 0 2px 4px rgba(0,0,0,.9)`,
              }}
            >
              {w.texto}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
