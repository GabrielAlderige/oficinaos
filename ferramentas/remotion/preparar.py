"""Prepara um reel para o Remotion: voz, trilha, efeitos e o roteiro com os tempos.

A voz neural (com o tempo de cada palavra) e a trilha sintetizada vêm do motor
de ferramentas/motion; aqui só se monta o que o Remotion lê:
  public/<slug>/voz-N.mp3, public/<slug>/musica.wav, public/sfx/*.wav
  src/dados/<slug>.json  (cenas, falas, legendas e marcas, tudo em SEGUNDOS)
  src/dados/index.ts     (a lista de reels que o Root registra)

Rodar:  python preparar.py 1 2     ou     python preparar.py todos
"""
import asyncio, json, os, shutil, sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, "..", "motion"))
from motion import _tts, _blocos, trilha, efeito, _salvar_wav  # noqa: E402
from roteiros import ROTEIROS  # noqa: E402

PUBLIC = os.path.join(AQUI, "public")
DADOS = os.path.join(AQUI, "src", "dados")
INICIO = 0.1  # algo já se mexe no primeiro quadro


async def preparar(r: dict) -> dict:
    slug = r["slug"]
    pasta = os.path.join(PUBLIC, slug)
    os.makedirs(pasta, exist_ok=True)
    cursor, cenas, falas, legendas, marcas = INICIO, [], [], [], []
    for k, c in enumerate(r["cenas"]):
        dur = c.get("minimo", 0.0)
        if c.get("fala"):
            mp3, d, palavras = await _tts(c["fala"])
            inicio_fala = cursor + c.get("atraso", 0.2)
            arquivo = f"{slug}/voz-{k + 1}.mp3"
            shutil.copyfile(mp3, os.path.join(PUBLIC, arquivo))
            falas.append({"arquivo": arquivo, "de": inicio_fala, "ate": inicio_fala + d})
            legendas += _blocos(palavras, inicio_fala)
            dur = max(dur, c.get("atraso", 0.2) + d + c.get("folga", 0.4))
        cenas.append({"tipo": c["tipo"], "de": cursor, "ate": cursor + dur, "params": c.get("params", {})})
        marcas.append({"de": cursor, "tipo": "impacto" if k == 0 else ("pop" if c["tipo"] == "chamada" else "whoosh")})
        cursor += dur
    total = cursor + 0.4
    _salvar_wav(os.path.join(pasta, "musica.wav"), trilha(total, r.get("bpm", 104), r["numero"]))
    os.makedirs(os.path.join(PUBLIC, "sfx"), exist_ok=True)
    for tipo in ("whoosh", "pop", "impacto"):
        _salvar_wav(os.path.join(PUBLIC, "sfx", f"{tipo}.wav"), efeito(tipo, 7))
    dados = {"numero": r["numero"], "slug": slug, "duracao": total, "musica": f"{slug}/musica.wav",
             "cenas": cenas, "falas": falas, "legendas": legendas, "marcas": marcas}
    with open(os.path.join(DADOS, f"{slug}.json"), "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=1)
    print(f"ok {slug}: {total:.1f}s, {len(cenas)} cenas")
    return dados


def indice():
    """src/dados/index.ts com todos os roteiros já preparados."""
    prontos = sorted(f[:-5] for f in os.listdir(DADOS) if f.endswith(".json"))
    linhas = ['import type { Reel } from "../tipos";']
    for i, s in enumerate(prontos):
        linhas.append(f'import r{i} from "./{s}.json";')
    linhas.append(f"export const REELS = [{', '.join(f'r{i}' for i in range(len(prontos)))}] as Reel[];")
    open(os.path.join(DADOS, "index.ts"), "w", encoding="utf-8").write("\n".join(linhas) + "\n")


if __name__ == "__main__":
    os.makedirs(DADOS, exist_ok=True)
    pedidos = sorted(ROTEIROS) if sys.argv[1:] == ["todos"] else [int(x) for x in sys.argv[1:]]
    for n in pedidos:
        asyncio.run(preparar(ROTEIROS[n]))
    indice()
