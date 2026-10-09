// Tudo em SEGUNDOS: os componentes convertem para quadros com o fps do vídeo.
export type Palavra = { texto: string; t: number; fim: number };
export type Bloco = { inicio: number; fim: number; palavras: Palavra[] };
export type Cena = { tipo: string; de: number; ate: number; params: Record<string, any> };
export type Fala = { arquivo: string; de: number; ate: number };
export type Marca = { de: number; tipo: "whoosh" | "pop" | "impacto" };
export type Reel = {
  numero: number;
  slug: string;
  duracao: number;
  musica: string;
  cenas: Cena[];
  falas: Fala[];
  legendas: Bloco[];
  marcas: Marca[];
  legenda?: boolean; // false: só motion e voz, conteúdo no meio da tela
};
