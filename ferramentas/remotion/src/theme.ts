// theme.ts: a única fonte de cores, curvas, molas e medidas dos reels.
// Nenhum componente escreve cor ou curva solta.
import { Easing } from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";

const { fontFamily } = loadFont("normal", {
  weights: ["500", "600", "700", "800", "900"],
  subsets: ["latin", "latin-ext"],
});

export const FPS = 30;
export const LARGURA = 1080;
export const ALTURA = 1920;

export const theme = {
  colors: {
    bg: "#0B0806",
    bgAlt: "#17110C",
    primary: "#FF6B1A", // laranja OficinaOS: o destaque, um por quadro
    accent: "#FFB020", // âmbar: palavra falada na legenda
    roxo: "#5B2A86",
    text: "#F7F3EE",
    textDim: "rgba(247, 243, 238, 0.62)",
    textFaint: "rgba(247, 243, 238, 0.32)",
    card: "rgba(255, 255, 255, 0.055)",
    cardBorder: "rgba(255, 255, 255, 0.10)",
    glow: "rgba(255, 107, 26, 0.45)",
    tint: "rgba(255, 107, 26, 0.16)",
    balaoOficina: "#0F5C4C",
    balaoCliente: "#202C33",
    lido: "#53BDEB",
    sombra: "rgba(0, 0, 0, 0.55)",
  },
  fonts: { display: fontFamily },
  ease: {
    out: Easing.bezier(0.16, 1, 0.3, 1), // easeOutExpo: entradas
    inOut: Easing.bezier(0.83, 0, 0.17, 1), // easeInOutQuint: deslocamentos
    in: Easing.bezier(0.7, 0, 0.84, 0), // só saídas
  },
  spring: {
    snappy: { damping: 14, stiffness: 160, mass: 0.6 },
    smooth: { damping: 20, stiffness: 90, mass: 1 },
    bouncy: { damping: 11, stiffness: 170, mass: 0.7 },
  },
  layout: {
    margem: 80, // respiro lateral
    util: 920, // largura útil (1080 - 2 x 80)
    legenda: 1390, // topo da legenda falada
    centro: 820, // centro vertical do conteúdo (acima da legenda)
  },
  tempo: {
    stagger: 3, // palavras
    staggerItem: 5, // cartões
    saida: 10, // saída de cena, mais rápida que a entrada
  },
} as const;
