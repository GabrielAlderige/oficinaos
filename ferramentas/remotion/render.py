"""Renderiza os reels no Remotion e monta o vídeo final.

Por que em duas partes: o ffmpeg que vem com o Remotion é barrado pelo Smart App
Control do Windows (as DLLs dele não são assinadas). Então o Remotion desenha só
os QUADROS (sem som), e o ffmpeg do imageio, que roda, junta os quadros e faz a
mixagem: trilha que abaixa sob a voz, narração, efeitos 3 quadros antes de cada
cena e volume final de -14 LUFS (o do Instagram).

Rodar:  python render.py 1 2     ou     python render.py todos
Antes:  python preparar.py <os mesmos números>
Sai em: videos/remotion-NN-slug.mp4
"""
import glob, json, os, re, shutil, subprocess, sys, time

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, "..", "motion"))
from motion import FF  # noqa: E402

SAIDA = os.path.join(AQUI, "videos")
DADOS = os.path.join(AQUI, "src", "dados")
PUBLIC = os.path.join(AQUI, "public")
NPX = "npx.cmd" if os.name == "nt" else "npx"
FPS = 30  # o mesmo de src/theme.ts
VOLUME = {"musica": 0.2, "voz": 1.0, "whoosh": 0.45, "pop": 0.6, "impacto": 0.7}


def quadros(comp: str) -> str:
    pasta = os.path.join(AQUI, "out", comp)
    shutil.rmtree(pasta, ignore_errors=True)
    # concorrência baixa: cada aba do Chrome come memória e a máquina não tem sobra
    subprocess.run([NPX, "remotion", "render", "src/index.ts", comp, pasta, "--sequence", "--image-format=jpeg",
                    "--jpeg-quality=94", '--props={"som":false}', "--concurrency=2", "--log=error"],
                   cwd=AQUI, check=True)
    nomes = sorted(os.listdir(pasta))
    largura = len(re.search(r"(\d+)\.jpeg$", nomes[0]).group(1))
    return os.path.join(pasta, f"element-%0{largura}d.jpeg")


def audio(d: dict, saida: str):
    entradas = ["-i", os.path.join(PUBLIC, d["musica"])]
    filtros, vozes, efeitos, k = [], [], [], 1
    for f in d["falas"]:
        entradas += ["-i", os.path.join(PUBLIC, f["arquivo"])]
        ms = round(f["de"] * 1000)
        filtros.append(f"[{k}:a]aresample=44100,adelay={ms}|{ms},volume={VOLUME['voz']}[v{k}]")
        vozes.append(f"[v{k}]")
        k += 1
    for m in d["marcas"]:
        entradas += ["-i", os.path.join(PUBLIC, "sfx", f"{m['tipo']}.wav")]
        ms = max(0, round((m["de"] - 3 / FPS) * 1000))  # o som chega um tiquinho antes da imagem
        filtros.append(f"[{k}:a]adelay={ms}|{ms},volume={VOLUME[m['tipo']]}[e{k}]")
        efeitos.append(f"[e{k}]")
        k += 1
    filtros.append(f"{''.join(vozes)}amix=inputs={len(vozes)}:normalize=0,asplit=2[voz][chave]")
    # a trilha abaixa sozinha enquanto a voz fala
    filtros.append(f"[0:a]volume={VOLUME['musica']}[mus];[mus][chave]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=350[musd]")
    filtros.append(f"{''.join(efeitos)}amix=inputs={len(efeitos)}:normalize=0[fx]")
    filtros.append("[voz][musd][fx]amix=inputs=3:normalize=0,loudnorm=I=-14:TP=-1.2:LRA=9[a]")
    subprocess.run([FF, "-y", "-loglevel", "error", *entradas, "-filter_complex", ";".join(filtros), "-map", "[a]",
                    "-t", f"{d['duracao']:.3f}", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", saida], check=True)


def render(slug: str):
    d = json.load(open(os.path.join(DADOS, f"{slug}.json"), encoding="utf-8"))
    comp = f"R{d['numero']:02d}"
    if "--pula-prontos" in sys.argv and os.path.exists(os.path.join(SAIDA, f"remotion-{d['numero']:02d}-{slug}.mp4")):
        print(f"já pronto: {slug}", flush=True)
        return
    t = time.time()
    padrao = quadros(comp)
    som = os.path.join(AQUI, "out", f"{comp}.m4a")
    audio(d, som)
    os.makedirs(SAIDA, exist_ok=True)
    final = os.path.join(SAIDA, f"remotion-{d['numero']:02d}-{slug}.mp4")
    subprocess.run([FF, "-y", "-loglevel", "error", "-framerate", str(FPS), "-start_number", "0", "-i", padrao,
                    "-i", som, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "16",
                    "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest", "-movflags", "+faststart", final], check=True)
    shutil.rmtree(os.path.dirname(padrao), ignore_errors=True)  # os quadros ocupam centenas de MB
    print(f"ok {final} ({d['duracao']:.1f}s) em {time.time() - t:.0f}s", flush=True)


if __name__ == "__main__":
    todos = [f for f in glob.glob(os.path.join(DADOS, "*.json"))]
    por_numero = {json.load(open(f, encoding="utf-8"))["numero"]: os.path.basename(f)[:-5] for f in todos}
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    pedidos = sorted(por_numero) if args == ["todos"] else [int(x) for x in args]
    for n in pedidos:
        render(por_numero[n])
