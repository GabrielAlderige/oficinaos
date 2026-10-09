import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { theme } from "./theme";
import type { Reel } from "./tipos";
import { Fundo, Grade, Grao, Vinheta } from "./componentes/Camadas";
import { CentroCtx, Clarao, Palco } from "./componentes/Palco";
import { Legenda } from "./componentes/Legenda";
import { CENAS } from "./cenas/Cenas";

const VOLUME = { musica: 0.2, musicaSobVoz: 0.07, voz: 1, efeito: { whoosh: 0.45, pop: 0.6, impacto: 0.7 } } as const;

/**
 * Camadas, de baixo para cima: fundo vivo -> cenas -> legenda -> correção de cor
 * -> granulação -> vinheta. O som: trilha (abaixa sozinha quando a voz fala),
 * a narração e um efeito 3 quadros ANTES de cada cena pousar.
 */
// som=false na renderização: o ffmpeg do Remotion é barrado pelo Smart App Control do Windows,
// então render.py mixa o áudio por fora. No Studio o som toca normalmente.
export const ReelComp: React.FC<{ reel: Reel; som?: boolean }> = ({ reel, som = true }) => {
  const { fps } = useVideoConfig();
  const q = (s: number) => Math.round(s * fps);
  const cortes = reel.cenas.slice(1).map((c) => q(c.de));

  // quanto de "voz" há em volta do quadro f (média de ±5 quadros: a música desce e sobe sem degrau)
  const falando = (f: number) => {
    let soma = 0;
    for (let d = -5; d <= 5; d++) {
      const t = (f + d) / fps;
      soma += reel.falas.some((x) => t >= x.de - 0.08 && t <= x.ate + 0.12) ? 1 : 0;
    }
    return soma / 11;
  };
  const volMusica = (f: number) => {
    const v = falando(f);
    const fim = Math.min(1, Math.max(0, (q(reel.duracao) - f) / q(1)));
    return (VOLUME.musica * (1 - v) + VOLUME.musicaSobVoz * v) * fim;
  };

  const comLegenda = reel.legenda !== false;
  return (
    <CentroCtx.Provider value={comLegenda ? theme.layout.centro : theme.layout.centroSemLegenda}>
    <AbsoluteFill style={{ background: theme.colors.bg, fontFamily: theme.fonts.display }}>
      <Fundo />
      {reel.cenas.map((c, i) => {
        const Cena = CENAS[c.tipo];
        const de = q(c.de);
        const dur = q(c.ate) - de;
        const ultima = i === reel.cenas.length - 1;
        return (
          <Sequence key={i} from={de} durationInFrames={ultima ? q(reel.duracao) - de : dur + theme.tempo.saida}>
            <Palco dur={dur} ultima={ultima}>
              <Cena p={c.params} dur={dur} />
            </Palco>
          </Sequence>
        );
      })}
      <Clarao cortes={cortes} />
      {comLegenda && <Legenda blocos={reel.legendas} />}
      <Grade />
      <Grao />
      <Vinheta />

      {som && <Audio src={staticFile(reel.musica)} volume={volMusica} />}
      {som && reel.falas.map((x, i) => (
        <Sequence key={`v${i}`} from={q(x.de)} layout="none">
          <Audio src={staticFile(x.arquivo)} volume={VOLUME.voz} />
        </Sequence>
      ))}
      {som && reel.marcas.map((m, i) => (
        <Sequence key={`e${i}`} from={Math.max(0, q(m.de) - 3)} layout="none">
          <Audio src={staticFile(`sfx/${m.tipo}.wav`)} volume={VOLUME.efeito[m.tipo]} />
        </Sequence>
      ))}
    </AbsoluteFill>
    </CentroCtx.Provider>
  );
};
