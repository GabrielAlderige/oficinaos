import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { Area, useCentro } from "../componentes/Palco";
import { Entrada, ip, Respira, Sobre, Titulo, palavras, useQ } from "../componentes/Movimento";
import { Check, Icone, Marca, VistoDuplo, Xis } from "../componentes/Icones";

type Props = { p: Record<string, any>; dur: number };

const cartao: React.CSSProperties = {
  background: theme.colors.card,
  border: `2px solid ${theme.colors.cardBorder}`,
  borderRadius: 34,
  boxShadow: `0 40px 80px -30px ${theme.colors.sombra}`,
};

/** Texto pequeno com *destaque* (sem animação por palavra). */
const Rico: React.FC<{ texto: string }> = ({ texto }) => (
  <>
    {palavras(texto).map((x, i) => (
      <span key={i} style={{ color: x.dest ? theme.colors.primary : undefined }}>
        {x.w}{" "}
      </span>
    ))}
  </>
);

// ------------------------------------------------------------------ gancho
/** Frase grande, palavra por palavra. */
export const Gancho: React.FC<Props> = ({ p }) => (
  <Area gap={34}>
    {p.sobre && <Sobre texto={p.sobre} />}
    <Respira>
      <Titulo linhas={p.linhas} tamanho={p.tamanho ?? 150} atraso={p.sobre ? 4 : 0} />
    </Respira>
  </Area>
);

// ------------------------------------------------------------------ numero
/** Número que sobe girando num anel. */
export const Numero: React.FC<Props> = ({ p, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const q = useQ();
  const conta = spring({ frame: frame - 6, fps, config: { damping: 30, stiffness: 50 }, durationInFrames: Math.min(q(1.8), dur) });
  const valor = Math.round((p.de ?? 0) + (p.ate - (p.de ?? 0)) * conta);
  const anel = ip(frame, [4, 4 + q(1.6)], [0, p.anel ?? 1], theme.ease.inOut);
  const tam = 720;
  const texto = `${p.prefixo ?? ""}${valor.toLocaleString("pt-BR")}${p.sufixo ?? ""}`;
  return (
    <Area centro={useCentro() - 40} alinhar="center" gap={26}>
      {p.sobre && <Sobre texto={p.sobre} />}
      <Respira>
        <div style={{ position: "relative", width: tam, height: tam, display: "grid", placeItems: "center" }}>
          <svg width={tam} height={tam} viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
            <circle cx={50} cy={50} r={45} fill="none" stroke={theme.colors.cardBorder} strokeWidth={3} />
            <circle cx={50} cy={50} r={45} fill="none" stroke={theme.colors.primary} strokeWidth={3} strokeLinecap="round"
              pathLength={1} strokeDasharray={1} strokeDashoffset={1 - anel}
              style={{ filter: `drop-shadow(0 0 3px ${theme.colors.glow})` }} />
          </svg>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: Math.min(220, Math.floor(560 / (texto.length * 0.62))), fontWeight: 900, letterSpacing: "-0.04em",
              color: theme.colors.text, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{texto}</div>
            {p.unidade && <div style={{ fontSize: 54, fontWeight: 700, color: theme.colors.textDim, marginTop: 10 }}>{p.unidade}</div>}
          </div>
        </div>
      </Respira>
      {p.rotulo && (
        <Entrada atraso={q(0.9)}>
          <div style={{ fontSize: 46, fontWeight: 700, color: theme.colors.textDim, textAlign: "center" }}>{p.rotulo}</div>
        </Entrada>
      )}
    </Area>
  );
};

// ------------------------------------------------------------------ calendario
/** Meses que vão passando e o número de meses no fim. */
export const Calendario: React.FC<Props> = ({ p }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const q = useQ();
  const meses: string[] = p.meses;
  const passo = q(0.32);
  const inicioCorrida = q(0.5);
  const atual = Math.floor(ip(frame, [inicioCorrida, inicioCorrida + passo * (meses.length - 1)], [0, meses.length - 1], theme.ease.inOut));
  const fimCorrida = inicioCorrida + passo * (meses.length - 1);
  const n = spring({ frame: frame - fimCorrida, fps, config: theme.spring.bouncy });
  return (
    <Area alinhar="center" gap={70}>
      <div style={{ display: "flex", gap: 18 }}>
        {meses.map((m, i) => {
          const e = spring({ frame: frame - i * theme.tempo.staggerItem, fps, config: theme.spring.snappy });
          const passou = i <= atual;
          const agora = i === atual;
          return (
            <div key={m} style={{
              ...cartao, width: 132, height: 160, borderRadius: 26, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 6,
              background: passou ? "rgba(255,255,255,0.12)" : theme.colors.card,
              opacity: ip(e, [0, 0.5], [0, 1]) * (passou ? 1 : 0.55),
              transform: `translateY(${(1 - e) * 60 - (agora ? 14 : 0)}px) scale(${(0.9 + 0.1 * e) * (agora ? 1.08 : 1)})`,
            }}>
              <Icone nome="calendario" tam={38} cor={passou ? theme.colors.text : theme.colors.textFaint} />
              <div style={{ fontSize: 34, fontWeight: 800, color: passou ? theme.colors.text : theme.colors.textFaint }}>{m}</div>
            </div>
          );
        })}
      </div>
      <div style={{ textAlign: "center", opacity: ip(n, [0, 0.4], [0, 1]), transform: `scale(${0.6 + 0.4 * n})` }}>
        <Respira>
          <div style={{ fontSize: 330, fontWeight: 900, lineHeight: 0.9, color: theme.colors.primary,
            textShadow: `0 0 90px ${theme.colors.glow}`, letterSpacing: "-0.05em" }}>{p.numero}</div>
          <div style={{ fontSize: 64, fontWeight: 800, color: theme.colors.text, marginTop: 10 }}>{p.rotulo}</div>
        </Respira>
      </div>
    </Area>
  );
};

// ------------------------------------------------------------------ conversa
const Digitando: React.FC<{ de: number }> = ({ de }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", gap: 10, padding: "6px 4px" }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ width: 16, height: 16, borderRadius: 99, background: theme.colors.textDim,
          transform: `translateY(${Math.sin((frame - de) / 3 - i * 0.9) * 6}px)` }} />
      ))}
    </div>
  );
};

/** Duas mensagens no estilo de conversa de celular: digitando..., depois o balão. */
export const Conversa: React.FC<Props> = ({ p }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const q = useQ();
  const msgs: { de: "oficina" | "cliente"; texto: string; hora?: string }[] = p.mensagens;
  const inicio = q(0.7);
  const espaco = q(1.25);
  const digita = q(0.55);
  return (
    <Area gap={60}>
      <Titulo linhas={([] as string[]).concat(p.titulo)} tamanho={110} />
      <div style={{ display: "flex", flexDirection: "column", gap: 26, width: "100%" }}>
        {msgs.map((m, i) => {
          const t0 = inicio + i * espaco;
          const mine = m.de === "oficina";
          const bal = spring({ frame: frame - t0 - digita, fps, config: theme.spring.bouncy });
          const dig = ip(frame, [t0, t0 + 6], [0, 1]) * (frame < t0 + digita ? 1 : 0);
          return (
            <div key={i} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", position: "relative", minHeight: 80 }}>
              {dig > 0 && (
                <div style={{ position: "absolute", [mine ? "right" : "left"]: 0, ...cartao, borderRadius: 30, padding: "18px 26px",
                  background: mine ? theme.colors.balaoOficina : theme.colors.balaoCliente, opacity: dig }}>
                  <Digitando de={t0} />
                </div>
              )}
              <div style={{
                maxWidth: 820, padding: "26px 32px 18px", borderRadius: 34,
                borderBottomRightRadius: mine ? 8 : 34, borderBottomLeftRadius: mine ? 34 : 8,
                background: mine ? theme.colors.balaoOficina : theme.colors.balaoCliente,
                boxShadow: `0 30px 60px -24px ${theme.colors.sombra}`,
                opacity: ip(bal, [0, 0.4], [0, 1]),
                transformOrigin: mine ? "right bottom" : "left bottom",
                transform: `translateY(${(1 - bal) * 40}px) scale(${0.7 + 0.3 * bal})`,
              }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: mine ? theme.colors.accent : theme.colors.lido, marginBottom: 6 }}>
                  {mine ? "Sua oficina" : "Cliente"}
                </div>
                <div style={{ fontSize: 50, fontWeight: 600, color: theme.colors.text, lineHeight: 1.26 }}>{m.texto}</div>
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 6,
                  fontSize: 24, color: theme.colors.textDim }}>
                  {m.hora ?? (mine ? "08:02" : "08:05")}
                  {mine && <VistoDuplo tam={32} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Area>
  );
};

// ------------------------------------------------------------------ lista
/** Cartões que entram um a um, com o ícone se desenhando. */
export const Lista: React.FC<Props> = ({ p }) => {
  const frame = useCurrentFrame();
  const q = useQ();
  const itens: { titulo: string; detalhe?: string; tipo?: "ok" | "nao"; icone?: string }[] = p.itens;
  const passo = q(p.intervalo ?? 0.9);
  const inicio = p.titulo ? q(0.55) : q(0.2);
  return (
    <Area gap={44}>
      {p.titulo && <Titulo linhas={([] as string[]).concat(p.titulo)} tamanho={p.tamanhoTitulo ?? 100} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 24, width: "100%" }}>
        {itens.map((it, i) => {
          const t0 = inicio + i * passo;
          const nao = it.tipo === "nao";
          const risco = ip(frame, [t0 + 6, t0 + 18], [0, 1], theme.ease.inOut);
          return (
            <Entrada key={i} atraso={t0} mola="snappy" sobe={70}>
              <Respira fase={i * 1.7}>
                <div style={{ ...cartao, display: "flex", alignItems: "center", gap: 30, padding: "28px 34px" }}>
                  <div style={{ width: 92, height: 92, borderRadius: 26, flexShrink: 0, display: "grid", placeItems: "center",
                    background: nao ? "rgba(255,77,77,0.16)" : theme.colors.tint }}>
                    {it.icone ? <Icone nome={it.icone} tam={50} /> : nao ? <Xis tam={50} progresso={risco} /> : <Check tam={52} progresso={risco} />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 48, fontWeight: 800, color: theme.colors.text, lineHeight: 1.15 }}>{it.titulo}</div>
                    {it.detalhe && <div style={{ fontSize: 36, fontWeight: 600, color: theme.colors.textDim, marginTop: 6 }}>{it.detalhe}</div>}
                  </div>
                </div>
              </Respira>
            </Entrada>
          );
        })}
      </div>
    </Area>
  );
};

// ------------------------------------------------------------------ contraste
/** Antes (riscado) e depois (aceso), um sobre o outro, com a seta entre eles. */
export const Contraste: React.FC<Props> = ({ p, dur }) => {
  const frame = useCurrentFrame();
  const q = useQ();
  const virada = Math.round(dur * 0.42);
  const risco = ip(frame, [virada - q(0.3), virada], [0, 1], theme.ease.inOut);
  const bloco = (rotulo: string, texto: string, ativo: boolean, riscado: number): React.ReactNode => (
    <div style={{ ...cartao, width: "100%", padding: "38px 40px",
      background: ativo ? theme.colors.tint : theme.colors.card,
      border: `2px solid ${ativo ? theme.colors.primary : theme.colors.cardBorder}`,
      boxShadow: ativo ? `0 0 70px ${theme.colors.glow}` : cartao.boxShadow }}>
      <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "0.14em", color: ativo ? theme.colors.accent : theme.colors.textFaint }}>
        {rotulo}
      </div>
      <div style={{ position: "relative", display: "inline-block", marginTop: 12, fontSize: 68, fontWeight: 900, lineHeight: 1.08,
        color: ativo ? theme.colors.text : riscado > 0 ? theme.colors.textFaint : theme.colors.text }}>
        {texto}
        {!ativo && (
          <div style={{ position: "absolute", left: -6, right: -6, top: "52%", height: 8, borderRadius: 9,
            background: theme.colors.text, opacity: 0.7, transformOrigin: "left", transform: `scaleX(${riscado})` }} />
        )}
      </div>
    </div>
  );
  return (
    <Area alinhar="center" gap={30}>
      {p.titulo && <div style={{ alignSelf: "flex-start" }}><Titulo linhas={([] as string[]).concat(p.titulo)} tamanho={96} /></div>}
      <Entrada atraso={2} style={{ width: "100%" }}>{bloco(p.antesTag ?? "ANTES", p.antes, false, risco)}</Entrada>
      <Entrada atraso={virada - 4} style={{ display: "grid", placeItems: "center" }}>
        <Icone nome="seta" tam={80} cor={theme.colors.textDim} />
      </Entrada>
      <Entrada atraso={virada} mola="bouncy" style={{ width: "100%" }}>
        <Respira>{bloco(p.depoisTag ?? "COM O OFICINAOS", p.depois, true, 0)}</Respira>
      </Entrada>
    </Area>
  );
};

// ------------------------------------------------------------------ chamada
/** Fecho: a marca, a frase, o botão pulsando e o endereço. */
export const Chamada: React.FC<Props> = ({ p }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const q = useQ();
  const marca = spring({ frame, fps, config: theme.spring.bouncy });
  const giro = spring({ frame, fps, config: theme.spring.smooth });
  const anel = ip(frame, [2, q(0.8)], [0, 1], theme.ease.inOut);
  const pulso = 1 + Math.sin(frame / 7) * 0.025;
  return (
    <Area gap={48}>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <div style={{ transform: `scale(${marca}) rotate(${(1 - giro) * -120}deg)` }}>
          <Marca tam={130} anel={anel} />
        </div>
        <Entrada atraso={q(0.25)}>
          <div style={{ fontSize: 76, fontWeight: 800, color: theme.colors.text, letterSpacing: "-0.02em" }}>
            Oficina<span style={{ color: theme.colors.textDim }}>OS</span>
          </div>
        </Entrada>
      </div>
      <Titulo linhas={p.titulo ? ([] as string[]).concat(p.titulo) : ["Sua oficina", "no *controle.*"]} tamanho={p.tamanho ?? 128} atraso={q(0.45)} />
      <Entrada atraso={q(1.0)} mola="bouncy">
        <div style={{ transform: `scale(${pulso})`, transformOrigin: "left center", display: "inline-flex", alignItems: "center", gap: 20,
          padding: "34px 54px", borderRadius: 999, background: theme.colors.primary,
          boxShadow: `0 0 60px ${theme.colors.glow}, 0 0 120px ${theme.colors.glow}`,
          fontSize: 56, fontWeight: 900, color: theme.colors.bg }}>
          {p.botao ?? "Teste grátis por 14 dias"}
        </div>
      </Entrada>
      <Entrada atraso={q(1.35)}>
        <div style={{ fontSize: 40, fontWeight: 700, color: theme.colors.textDim }}>
          <Rico texto={p.rodape ?? "Sem cartão · link na bio · oficinaosbr.cloud"} />
        </div>
      </Entrada>
    </Area>
  );
};

export const CENAS: Record<string, React.FC<Props>> = {
  gancho: Gancho,
  numero: Numero,
  calendario: Calendario,
  conversa: Conversa,
  lista: Lista,
  contraste: Contraste,
  chamada: Chamada,
};
