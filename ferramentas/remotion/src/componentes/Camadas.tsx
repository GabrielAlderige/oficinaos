import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { theme } from "../theme";

/** Camada 1: fundo vivo, manchas de cor que passeiam devagar e uma grade sutil. */
export const Fundo: React.FC = () => {
  const frame = useCurrentFrame();
  const a = Math.sin(frame / 55) * 120, b = Math.cos(frame / 70) * 110, c = Math.sin(frame / 90 + 1) * 160;
  const mancha = (cor: string, tam: number, x: number, y: number, blur: number): React.CSSProperties => ({
    position: "absolute",
    width: tam,
    height: tam,
    left: x,
    top: y,
    borderRadius: "50%",
    filter: `blur(${blur}px)`,
    background: `radial-gradient(circle, ${cor}, transparent 64%)`,
  });
  return (
    <AbsoluteFill style={{ background: theme.colors.bg, overflow: "hidden" }}>
      <div style={mancha(`${theme.colors.primary}55`, 1300, -420 + a, -520 + b * 0.6, 60)} />
      <div style={mancha(`${theme.colors.roxo}66`, 1200, 260 - b, 1080 + a * 0.5, 80)} />
      <div style={mancha(`${theme.colors.accent}22`, 900, 340 + c, 560 - a * 0.4, 90)} />
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${theme.colors.cardBorder} 1px, transparent 1px), linear-gradient(90deg, ${theme.colors.cardBorder} 1px, transparent 1px)`,
          backgroundSize: "90px 90px",
          backgroundPosition: `0px ${(frame * 0.7) % 90}px`,
          opacity: 0.22,
          maskImage: "radial-gradient(ellipse at 50% 40%, black 20%, transparent 75%)",
        }}
      />
    </AbsoluteFill>
  );
};

/** Camada 4: correção de cor que une tudo num só visual. */
export const Grade: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill style={{ backgroundColor: theme.colors.primary, mixBlendMode: "soft-light", opacity: 0.14 }} />
    <AbsoluteFill
      style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.28), transparent 22%, transparent 70%, rgba(0,0,0,0.45))" }}
    />
  </AbsoluteFill>
);

/** Camada 5a: granulação de filme, procedural, tremendo a cada quadro. */
export const Grao: React.FC = () => {
  const frame = useCurrentFrame();
  const ruido = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        backgroundImage: ruido,
        backgroundSize: "220px",
        backgroundPosition: `${(frame * 7) % 220}px ${(frame * 13) % 220}px`,
        opacity: 0.09,
        mixBlendMode: "overlay",
      }}
    />
  );
};

/** Camada 5b: vinheta, a mais de cima. */
export const Vinheta: React.FC = () => (
  <AbsoluteFill
    style={{ pointerEvents: "none", background: "radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.5) 100%)" }}
  />
);
