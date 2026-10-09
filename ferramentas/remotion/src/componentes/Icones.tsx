import React from "react";
import { theme } from "../theme";

// Ícones desenhados em SVG, na paleta (nada de emoji).
type P = { tam?: number; cor?: string; progresso?: number };

export const Check: React.FC<P> = ({ tam = 40, cor = theme.colors.text, progresso = 1 }) => (
  <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none">
    <path d="M5 12.5l4.5 4.5L19 7.5" stroke={cor} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
      pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progresso} />
  </svg>
);

export const Xis: React.FC<P> = ({ tam = 40, cor = theme.colors.text, progresso = 1 }) => (
  <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none">
    <path d="M6 6l12 12M18 6L6 18" stroke={cor} strokeWidth={3} strokeLinecap="round"
      pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progresso} />
  </svg>
);

export const VistoDuplo: React.FC<P> = ({ tam = 34, cor = theme.colors.lido }) => (
  <svg width={tam} height={tam * 0.7} viewBox="0 0 24 16" fill="none">
    <path d="M1 8.5l4 4L13 3.5M9 12.5l1 0.5L21 3.5" stroke={cor} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const caminhos: Record<string, string> = {
  relogio: "M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z",
  calendario: "M4 7h16v13H4zM4 11h16M8 3v4M16 3v4",
  chave: "M14.5 4.5a4 4 0 00-5 5L4 15v4h4l5.5-5.5a4 4 0 005-5l-2.5 2.5-2-2 2.5-2.5z",
  pessoa: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  sino: "M6 16V11a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0",
  dinheiro: "M3 6h18v12H3zM12 9a3 3 0 100 6 3 3 0 000-6z",
  celular: "M7 2h10v20H7zM11 18h2",
  seta: "M12 4v16M5 13l7 7 7-7",
};

export const Icone: React.FC<P & { nome: string }> = ({ nome, tam = 44, cor = theme.colors.text }) => (
  <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none">
    <path d={caminhos[nome] ?? caminhos.sino} stroke={cor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** A marca (igual ao ícone do app): anel laranja num quadrado escuro. */
export const Marca: React.FC<{ tam?: number; anel?: number }> = ({ tam = 120, anel = 1 }) => (
  <div
    style={{
      width: tam,
      height: tam,
      borderRadius: tam * 0.24,
      background: theme.colors.bgAlt,
      border: `2px solid ${theme.colors.cardBorder}`,
      display: "grid",
      placeItems: "center",
      boxShadow: `0 0 ${tam * 0.7}px ${theme.colors.glow}`,
    }}
  >
    <svg width={tam * 0.56} height={tam * 0.56} viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)" }}>
      <circle cx={50} cy={50} r={37} fill="none" stroke={theme.colors.primary} strokeWidth={24}
        pathLength={1} strokeDasharray={1} strokeDashoffset={1 - anel} />
    </svg>
  </div>
);
