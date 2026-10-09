"""Reels em motion graphics do OficinaOS.

Diferente dos reels de tela (ferramentas/reels): aqui nada é gravado. Cada
quadro é DESENHADO pelo palco.html no instante exato (60 por segundo), então o
movimento sai liso e igual toda vez. A narração vem de uma voz neural com o
tempo de cada palavra (para a legenda acompanhar a fala), e a trilha e os
efeitos são sintetizados aqui mesmo: nada de música de terceiros.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import subprocess
import sys
import wave
from dataclasses import dataclass, field

import edge_tts
import imageio_ffmpeg
import numpy as np
from mutagen.mp3 import MP3
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, "videos")
TMP = os.path.join(AQUI, "tmp")
CACHE = os.path.join(AQUI, "cache-voz")
FF = imageio_ffmpeg.get_ffmpeg_exe()
VOZ = "pt-BR-ThalitaMultilingualNeural"
RITMO = "+6%"
FPS = 60
SR = 44100


@dataclass
class Cena:
    tipo: str  # impacto | lista | numero | celular | contraste | chamada
    fala: str = ""  # narração desta cena (pode ser vazia)
    minimo: float = 0.0  # duração mínima, mesmo sem fala
    folga: float = 0.45  # respiro depois da fala
    params: dict = field(default_factory=dict)


@dataclass
class ReelMotion:
    numero: int
    slug: str
    cenas: list[Cena]
    bpm: int = 104


# ------------------------------------------------------------------ voz

async def _tts(texto: str) -> tuple[str, float, list[dict]]:
    """MP3 da fala, duração e o tempo de cada palavra (em segundos)."""
    os.makedirs(CACHE, exist_ok=True)
    chave = hashlib.sha1(f"{VOZ}|{RITMO}|{texto}".encode()).hexdigest()[:16]
    mp3, js = os.path.join(CACHE, chave + ".mp3"), os.path.join(CACHE, chave + ".json")
    if not (os.path.exists(mp3) and os.path.exists(js)):
        com = edge_tts.Communicate(texto, VOZ, rate=RITMO, boundary="WordBoundary")
        palavras, audio = [], bytearray()
        async for ch in com.stream():
            if ch["type"] == "audio":
                audio += ch["data"]
            elif ch["type"] == "WordBoundary":
                ini = ch["offset"] / 1e7
                palavras.append({"texto": ch["text"], "t": ini, "fim": ini + ch["duration"] / 1e7})
        open(mp3, "wb").write(audio)
        json.dump(palavras, open(js, "w", encoding="utf-8"), ensure_ascii=False)
    return mp3, MP3(mp3).info.length, json.load(open(js, encoding="utf-8"))


def _blocos(palavras: list[dict], deslocamento: float, maximo: int = 4) -> list[dict]:
    """A legenda em pedaços curtos (até 4 palavras, quebrando na pontuação)."""
    blocos, atual = [], []
    for w in palavras:
        atual.append({"texto": w["texto"], "t": w["t"] + deslocamento, "fim": w["fim"] + deslocamento})
        if len(atual) >= maximo or w["texto"][-1:] in ",.?!:":
            blocos.append(atual)
            atual = []
    if atual:
        blocos.append(atual)
    return [{"inicio": b[0]["t"] - 0.05, "fim": b[-1]["fim"], "palavras": b} for b in blocos]


# ------------------------------------------------------------------ trilha e efeitos

def _env(n: int, ataque: float, queda: float) -> np.ndarray:
    t = np.arange(n) / SR
    return np.minimum(1, t / max(ataque, 1e-4)) * np.exp(-t / queda)


def _passa_baixa(x: np.ndarray, corte: float) -> np.ndarray:
    a = math.exp(-2 * math.pi * corte / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):  # um polo; a trilha é curta, cabe em Python
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def trilha(duracao: float, bpm: int, semente: int) -> np.ndarray:
    """Uma batida leve e animada: bumbo, palmas, chimbal, baixo e acordes."""
    rng = np.random.default_rng(semente)
    n = int((duracao + 1) * SR)
    mix = np.zeros(n)
    batida = 60 / bpm
    # Lá menor, Fá, Dó, Sol (um compasso cada)
    acordes = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
    hz = lambda m: 440 * 2 ** ((m - 69) / 12)
    nb = int(duracao / batida) + 2
    for b in range(nb):
        t0 = int(b * batida * SR)
        if t0 >= n:
            break
        # bumbo: seno que desce de 140 para 45 Hz
        m = int(0.32 * SR)
        tt = np.arange(m) / SR
        freq = 45 + 95 * np.exp(-tt * 28)
        kick = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-tt * 9)
        mix[t0:t0 + m] += 0.9 * kick[: n - t0]
        # palma nos tempos 2 e 4
        if b % 2 == 1:
            m = int(0.18 * SR)
            ruido = rng.standard_normal(m) * _env(m, 0.002, 0.05)
            palma = ruido - _passa_baixa(ruido, 900)
            mix[t0:t0 + m] += 0.35 * palma[: n - t0]
        # chimbal em colcheias
        for meio in (0, 0.5):
            ti = int((b + meio) * batida * SR)
            if ti >= n:
                continue
            m = int(0.05 * SR)
            r = rng.standard_normal(m) * _env(m, 0.001, 0.012)
            hat = r - _passa_baixa(r, 6000)
            mix[ti:ti + m] += (0.10 if meio else 0.06) * hat[: n - ti]
        # baixo: tônica do acorde, em colcheias
        acorde = acordes[(b // 4) % 4]
        for meio in (0, 0.5):
            ti = int((b + meio) * batida * SR)
            if ti >= n:
                continue
            m = int(batida * 0.48 * SR)
            tt = np.arange(m) / SR
            f = hz(acorde[0] - 12)
            onda = np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(4 * np.pi * f * tt)
            mix[ti:ti + m] += 0.22 * (onda * _env(m, 0.004, 0.16))[: n - ti]
    # acordes (pad suave), um por compasso
    compasso = 4 * batida
    for c in range(int(duracao / compasso) + 2):
        t0 = int(c * compasso * SR)
        if t0 >= n:
            break
        m = int(compasso * SR)
        tt = np.arange(m) / SR
        pad = np.zeros(m)
        for nota in acordes[c % 4]:
            for det in (-0.12, 0.12):
                f = hz(nota) * (1 + det / 100)
                pad += np.sign(np.sin(2 * np.pi * f * tt)) * 0.5 + np.sin(2 * np.pi * f * tt)
        env = np.minimum(1, tt / 0.25) * np.minimum(1, (compasso - tt) / 0.3)
        mix[t0:t0 + m] += 0.035 * (pad * env)[: n - t0]
    mix = _passa_baixa(mix, 7000)
    # entra e sai devagar
    t = np.arange(n) / SR
    mix *= np.minimum(1, t / 0.6) * np.clip((duracao + 0.5 - t) / 1.2, 0, 1)
    return mix / (np.max(np.abs(mix)) + 1e-9) * 0.9


def efeito(tipo: str, semente: int) -> np.ndarray:
    rng = np.random.default_rng(semente)
    if tipo == "whoosh":
        m = int(0.55 * SR)
        tt = np.arange(m) / SR
        r = rng.standard_normal(m)
        # o ruído "abre" e "fecha": filtro que sobe e desce
        y = np.zeros(m)
        acc = 0.0
        for i in range(m):
            corte = 300 + 5000 * math.sin(math.pi * tt[i] / tt[-1]) ** 2
            a = math.exp(-2 * math.pi * corte / SR)
            acc = (1 - a) * r[i] + a * acc
            y[i] = acc
        y *= np.sin(np.pi * tt / tt[-1]) ** 1.5
        return y / (np.max(np.abs(y)) + 1e-9) * 0.5
    if tipo == "pop":
        m = int(0.16 * SR)
        tt = np.arange(m) / SR
        f = 900 * np.exp(-tt * 9) + 300
        y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 26)
        return y * 0.45
    if tipo == "impacto":
        m = int(0.7 * SR)
        tt = np.arange(m) / SR
        f = 32 + 90 * np.exp(-tt * 14)
        y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 4.5)
        r = rng.standard_normal(m) * np.exp(-tt * 22) * 0.25
        return (y + r) * 0.8
    raise ValueError(tipo)


def _salvar_wav(caminho: str, x: np.ndarray):
    x = np.clip(x, -1, 1)
    with wave.open(caminho, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


# ------------------------------------------------------------------ montagem

async def _roteiro(reel: ReelMotion):
    cursor, cenas, legendas, falas, marcas = 0.35, [], [], [], []
    for k, c in enumerate(reel.cenas):
        dur = c.minimo
        if c.fala:
            mp3, d, palavras = await _tts(c.fala)
            inicio_fala = cursor + 0.25
            falas.append((inicio_fala, mp3))
            legendas += _blocos(palavras, inicio_fala)
            dur = max(dur, 0.25 + d + c.folga)
        cenas.append({"tipo": c.tipo, "inicio": cursor, "fim": cursor + dur, "flash": k > 0, **c.params})
        marcas.append((cursor, "impacto" if k == 0 else ("pop" if c.tipo == "chamada" else "whoosh")))
        cursor += dur
    return {"cenas": cenas, "legendas": legendas}, falas, marcas, cursor + 0.3


async def _desenhar(roteiro: dict, total: float, video: str):
    frames = int(total * FPS)
    proc = subprocess.Popen(
        [FF, "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "-",
         "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS), video],
        stdin=subprocess.PIPE,
    )
    async with async_playwright() as pw:
        nav = await pw.chromium.launch()
        pg = await nav.new_page(viewport={"width": 1080, "height": 1920})
        await pg.goto("file:///" + os.path.join(AQUI, "palco.html").replace("\\", "/"))
        await pg.evaluate("document.fonts.ready")
        await pg.wait_for_timeout(600)
        await pg.evaluate("r => window.carregar(r)", roteiro)
        cdp = await pg.context.new_cdp_session(pg)
        for i in range(frames):
            await pg.evaluate("t => window.renderFrame(t)", i / FPS)
            shot = await cdp.send("Page.captureScreenshot", {"format": "jpeg", "quality": 93})
            import base64
            proc.stdin.write(base64.b64decode(shot["data"]))
            if i % 300 == 0:
                print(f"    quadro {i}/{frames}", flush=True)
        await nav.close()
    proc.stdin.close()
    proc.wait()


def _audio(reel: ReelMotion, falas, marcas, total: float, pasta: str) -> str:
    musica = os.path.join(pasta, "musica.wav")
    _salvar_wav(musica, trilha(total, reel.bpm, reel.numero))
    sfx = {}
    for tipo in ("whoosh", "pop", "impacto"):
        sfx[tipo] = os.path.join(pasta, f"{tipo}.wav")
        _salvar_wav(sfx[tipo], efeito(tipo, reel.numero))
    entradas, filtros, vozes, efeitos = ["-i", musica], [], [], []
    k = 1
    for t, mp3 in falas:
        entradas += ["-i", mp3]
        ms = int(t * 1000)
        filtros.append(f"[{k}:a]aresample={SR},adelay={ms}|{ms}[v{k}]")
        vozes.append(f"[v{k}]")
        k += 1
    for t, tipo in marcas:
        entradas += ["-i", sfx[tipo]]
        ms = max(0, int((t - 0.12) * 1000))
        filtros.append(f"[{k}:a]adelay={ms}|{ms}[e{k}]")
        efeitos.append(f"[e{k}]")
        k += 1
    filtros.append(f"{''.join(vozes)}amix=inputs={len(vozes)}:normalize=0,asplit=2[voz][chave]")
    # a música abaixa sozinha quando a voz fala
    filtros.append("[0:a]volume=0.17[mus];[mus][chave]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=350[musd]")
    filtros.append(f"{''.join(efeitos)}amix=inputs={len(efeitos)}:normalize=0,volume=0.35[fx]")
    filtros.append("[voz][musd][fx]amix=inputs=3:normalize=0,loudnorm=I=-14:TP=-1.2:LRA=9[a]")
    saida = os.path.join(pasta, "audio.m4a")
    subprocess.run([FF, "-y", "-loglevel", "error", *entradas, "-filter_complex", ";".join(filtros),
                    "-map", "[a]", "-t", f"{total:.3f}", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", saida], check=True)
    return saida


def rodar(reel: ReelMotion) -> str:
    os.makedirs(SAIDA, exist_ok=True)
    pasta = os.path.join(TMP, reel.slug)
    os.makedirs(pasta, exist_ok=True)
    roteiro, falas, marcas, total = asyncio.run(_roteiro(reel))
    video = os.path.join(pasta, "video.mp4")
    asyncio.run(_desenhar(roteiro, total, video))
    audio = _audio(reel, falas, marcas, total, pasta)
    saida = os.path.join(SAIDA, f"motion-{reel.numero:02d}-{reel.slug}.mp4")
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", video, "-i", audio, "-map", "0:v", "-map", "1:a",
                    "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", saida], check=True)
    print(f"OK {saida} ({total:.1f}s)")
    return saida
