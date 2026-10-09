import React from "react";
import { Composition } from "remotion";
import { ALTURA, FPS, LARGURA } from "./theme";
import { ReelComp } from "./Reel";
import { REELS } from "./dados";
import { Capa } from "./Capa";

// Um reel por roteiro preparado (python preparar.py N): id R01, R02...
export const Root: React.FC = () => (
  <>
    {REELS.map((r) => (
      <Composition
        key={r.slug}
        id={`R${String(r.numero).padStart(2, "0")}`}
        component={ReelComp}
        durationInFrames={Math.ceil(r.duracao * FPS)}
        fps={FPS}
        width={LARGURA}
        height={ALTURA}
        defaultProps={{ reel: r }}
      />
    ))}
    <Composition id="Capa" component={Capa} durationInFrames={90} fps={FPS} width={1200} height={630} />
  </>
);
