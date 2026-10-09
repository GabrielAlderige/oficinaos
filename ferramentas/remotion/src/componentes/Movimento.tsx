import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

type Curva = (t: number) => number;

/** interpolate que SEMPRE trava nas pontas e sempre tem curva. */
export const ip = (x: number, de: [number, number], para: [number, number], easing: Curva = theme.ease.out) =>
  interpolate(x, de, para, { easing, extrapolateLeft: "clamp", extrapolateRight: "clamp" });

/** segundos -> quadros, com o fps do vídeo. */
export const useQ = () => {
  const { fps } = useVideoConfig();
  return (s: number) => Math.round(s * fps);
};

/** Entrada de 3 propriedades: aparece, sobe e cresce, numa mola. */
export const Entrada: React.FC<{
  atraso?: number;
  mola?: keyof typeof theme.spring;
  sobe?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ atraso = 0, mola = "smooth", sobe = 50, style, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - atraso, fps, config: theme.spring[mola] });
  return (
    <div
      style={{
        opacity: ip(p, [0, 0.6], [0, 1]),
        transform: `translateY(${(1 - p) * sobe}px) scale(${0.92 + 0.08 * p})`,
        filter: `blur(${ip(p, [0, 0.7], [10, 0])}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Micro movimento para o que fica parado mais de 2 s. */
export const Respira: React.FC<{ fase?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({
  fase = 0,
  style,
  children,
}) => {
  const frame = useCurrentFrame();
  const y = Math.sin(frame / 30 + fase) * 4;
  const s = 1 + Math.sin(frame / 22 + fase) * 0.008;
  return <div style={{ transform: `translateY(${y}px) scale(${s})`, ...style }}>{children}</div>;
};

/** "Seu cliente não *some.*" -> palavras com a marca de destaque. */
export const palavras = (linha: string) => {
  let dentro = false;
  return linha.split(/\s+/).filter(Boolean).map((bruto) => {
    let w = bruto;
    const abre = w.startsWith("*");
    if (abre) { dentro = true; w = w.slice(1); }
    const fecha = w.slice(abre ? 1 : 0).includes("*"); // "*primeiro*," fecha antes da vírgula
    w = w.replace(/\*/g, "");
    const dest = dentro;
    if (fecha) dentro = false;
    return { w, dest };
  });
};

/** Tamanho que faz a linha mais longa caber na largura útil (Poppins 900, ~0,66 em por letra, com folga). */
export const tamanhoQueCabe = (linhas: string[], maximo: number, largura: number = theme.layout.util) => {
  const maior = Math.max(...linhas.map((l) => l.replace(/\*/g, "").length));
  return Math.min(maximo, Math.floor(largura / (maior * 0.66)));
};

/**
 * Título cinético: palavra por palavra (mola rápida, defasagem de 3 quadros),
 * o destaque ganha a cor laranja e um sublinhado que corre depois que a palavra pousa.
 */
export const Titulo: React.FC<{
  linhas: string[];
  tamanho?: number;
  atraso?: number;
  alinhar?: "left" | "center";
}> = ({ linhas, tamanho = 150, atraso = 0, alinhar = "left" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fonte = tamanhoQueCabe(linhas, tamanho);
  let k = 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: alinhar === "center" ? "center" : "flex-start" }}>
      {linhas.map((linha, li) => (
        <div key={li} style={{ display: "flex", flexWrap: "nowrap", gap: Math.round(fonte * 0.24), fontSize: fonte, lineHeight: 1.04 }}>
          {palavras(linha).map((p, wi) => {
            const atrasoPalavra = atraso + k++ * theme.tempo.stagger;
            const m = spring({ frame: frame - atrasoPalavra, fps, config: theme.spring.snappy });
            const risco = ip(frame, [atrasoPalavra + 6, atrasoPalavra + 16], [0, 1], theme.ease.inOut);
            return (
              <span
                key={wi}
                style={{
                  position: "relative",
                  display: "inline-block",
                  fontWeight: 900,
                  letterSpacing: "-0.03em",
                  color: p.dest ? theme.colors.primary : theme.colors.text,
                  textShadow: p.dest ? `0 0 60px ${theme.colors.glow}` : `0 8px 30px ${theme.colors.sombra}`,
                  opacity: ip(m, [0, 0.5], [0, 1]),
                  transform: `translateY(${(1 - m) * 70}px) scale(${0.86 + 0.14 * m})`,
                  filter: `blur(${ip(m, [0, 0.8], [8, 0])}px)`,
                }}
              >
                {p.w}
                {p.dest && (
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: fonte * 0.02,
                      height: Math.max(6, fonte * 0.06),
                      borderRadius: 99,
                      background: theme.colors.primary,
                      transformOrigin: "left center",
                      transform: `scaleX(${risco})`,
                    }}
                  />
                )}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** Rótulo pequeno em caixa alta, acima do título. */
export const Sobre: React.FC<{ texto: string; atraso?: number }> = ({ texto, atraso = 0 }) => {
  const frame = useCurrentFrame();
  const p = ip(frame, [atraso, atraso + 18], [0, 1]);
  return (
    <div
      style={{
        fontSize: 40,
        fontWeight: 800,
        textTransform: "uppercase",
        color: theme.colors.accent,
        letterSpacing: `${ip(p, [0, 1], [0.45, 0.16])}em`,
        opacity: p,
        transform: `translateY(${(1 - p) * 24}px)`,
      }}
    >
      {texto}
    </div>
  );
};
