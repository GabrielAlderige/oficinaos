"""Reels do OficinaOS: o motor dos tutoriais, em vídeo vertical (1080x1920).

Cada reel: um GANCHO (frase grande, a dor da oficina), a demonstração no
sistema em versão de celular, com uma faixa no topo e legendas grandes, e a
CHAMADA para o teste grátis. As ações (clicar, focar, digitar...) são as do
motor dos tutoriais, porque a camada visual tem a mesma interface.
"""
from __future__ import annotations

import asyncio
import base64
import glob
import os
import time
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Awaitable, Callable

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, "..", "tutoriais", "motor"))
import motor  # noqa: E402
from motor import FF, BASE, Gravacao, Passo, _entrar, _tts  # noqa: E402
from playwright.async_api import Page, async_playwright  # noqa: E402

OVERLAY = open(os.path.join(AQUI, "overlay_reels.js"), encoding="utf-8").read()
SAIDA = os.path.join(AQUI, "videos")
TMP = os.path.join(AQUI, "tmp")
LARGURA, ALTURA = 1080, 1920


@dataclass
class Reel:
    numero: int
    slug: str
    gancho_sobre: str  # linha pequena acima do gancho
    gancho: str  # a frase grande; *palavra* sai em laranja
    gancho_fala: str
    topo: str  # a faixa que fica no topo durante a demonstração
    passos: list[Passo]
    chamada: str  # título do cartão final; *palavra* em laranja
    chamada_sub: str
    chamada_fala: str = "Teste grátis por catorze dias, sem cartão. O link está na bio."
    inicio: str = "/"
    usuario: str = "demo@oficinaos.dev"
    preparo: list[Callable[[Page], Awaitable[None]]] = field(default_factory=list)
    legenda_do_texto: str = "OficinaOS"


def topo(texto: str | None):
    async def f(g: Gravacao):
        await g.js("t => window.__tut.topo(t)", texto)
    return f


class Screencast:
    """Grava pelo screencast do Chrome: quadros na resolução REAL do aparelho
    (432x768 a 2,5 = 1080x1920). O vídeo do Playwright grava em pixels
    lógicos e deixaria o resto da tela cinza."""

    def __init__(self, pasta: str):
        self.pasta = pasta
        self.quadros: list[tuple[float, str]] = []  # (relógio de parede, arquivo)

    async def iniciar(self, ctx, pg):
        self.cdp = await ctx.new_cdp_session(pg)

        async def quadro(ev):
            n = len(self.quadros)
            arq = os.path.join(self.pasta, f"q{n:05d}.jpg")
            with open(arq, "wb") as f:
                f.write(base64.b64decode(ev["data"]))
            self.quadros.append((ev["metadata"]["timestamp"], arq))
            try:
                await self.cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})
            except Exception:
                pass

        self.cdp.on("Page.screencastFrame", lambda ev: asyncio.ensure_future(quadro(ev)))
        await self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": LARGURA,
                                                     "maxHeight": ALTURA, "everyNthFrame": 1})

    async def parar(self):
        try:
            await self.cdp.send("Page.stopScreencast")
        except Exception:
            pass


async def gravar(reel: Reel) -> str:
    os.makedirs(SAIDA, exist_ok=True)
    pasta = os.path.join(TMP, reel.slug)
    shutil.rmtree(pasta, ignore_errors=True)
    os.makedirs(pasta)

    async with async_playwright() as pw:
        nav = await pw.chromium.launch()
        estado = await _entrar(nav, reel.usuario, reel.preparo)
        ctx = await nav.new_context(
            viewport={"width": 432, "height": 768},
            device_scale_factor=2.5,
            is_mobile=True,
            has_touch=True,
            storage_state=estado,
        )
        await ctx.add_init_script(OVERLAY)
        pg = await ctx.new_page()
        g = Gravacao(pg, reel)
        parede0 = time.time() - g.agora()  # converte o relógio do motor para o do screencast
        cast = Screencast(pasta)
        await cast.iniciar(ctx, pg)
        await pg.goto(BASE + reel.inicio)
        await pg.wait_for_function("() => !!window.__tut")
        await g.js("([s,t]) => window.__tut.gancho(s,t)", [reel.gancho_sobre, reel.gancho])
        await pg.evaluate("document.fonts.ready")
        await asyncio.sleep(0.5)
        corte = g.agora()
        await asyncio.sleep(0.3)
        await g.falar(reel.gancho_fala, "", [], 0.3)
        await g.js("() => window.__tut.esconderCard()")
        g.topo_atual = reel.topo
        await g.js("t => window.__tut.topo(t)", reel.topo)
        await asyncio.sleep(0.4)
        for passo in reel.passos:
            await g.falar(passo.fala, passo.legenda, passo.acoes, passo.depois)
        await g.js("() => { window.__tut.legenda(null); window.__tut.foco(null); window.__tut.topo(null) }")
        await g.js("([t,s]) => window.__tut.chamada(t,s)", [reel.chamada, reel.chamada_sub])
        await asyncio.sleep(0.4)
        await g.falar(reel.chamada_fala, "", [], 1.0)
        fim = g.agora()
        await asyncio.sleep(0.3)
        await cast.parar()
        await ctx.close()
        await nav.close()

    return montar(reel, cast.quadros, parede0, g.falas, corte, fim)


def montar(reel: Reel, quadros, parede0: float, falas, corte: float, fim: float) -> str:
    """Quadros do screencast (só chegam quando a tela muda) viram um vídeo de
    30 fps: cada quadro fica na tela até o próximo."""
    saida = os.path.join(SAIDA, f"reel-{reel.numero:02d}-{reel.slug}.mp4")
    pasta = os.path.dirname(quadros[0][1])
    tempos = [(ts - parede0, arq) for ts, arq in quadros]
    # o último quadro antes do corte abre o vídeo
    antes = [q for q in tempos if q[0] <= corte]
    depois = [q for q in tempos if corte < q[0] < fim]
    lista = ([(corte, antes[-1][1])] if antes else []) + depois
    linhas = []
    for i, (t, arq) in enumerate(lista):
        prox = lista[i + 1][0] if i + 1 < len(lista) else fim
        linhas.append(f"file '{os.path.basename(arq)}'")
        linhas.append(f"duration {max(prox - t, 0.001):.4f}")
    linhas.append(f"file '{os.path.basename(lista[-1][1])}'")
    roteiro = os.path.join(pasta, "quadros.txt")
    with open(roteiro, "w", encoding="utf-8") as f:
        f.write("\n".join(linhas) + "\n")

    entradas = ["-f", "concat", "-safe", "0", "-i", roteiro]
    filtros, rotulos = [], []
    for i, (t, arq) in enumerate(falas, start=1):
        entradas += ["-i", arq]
        ms = max(0, int((t - corte) * 1000))
        filtros.append(f"[{i}:a]adelay={ms}|{ms}[a{i}]")
        rotulos.append(f"[a{i}]")
    filtros.append(f"{''.join(rotulos)}amix=inputs={len(rotulos)}:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]")
    filtros.append(f"[0:v]fps=30,scale={LARGURA}:{ALTURA}:force_original_aspect_ratio=decrease,"
                   f"pad={LARGURA}:{ALTURA}:(ow-iw)/2:(oh-ih)/2:color=0x0A0A0B,setsar=1[v]")
    cmd = [FF, "-y", "-loglevel", "error", *entradas, "-filter_complex", ";".join(filtros),
           "-map", "[v]", "-map", "[a]", "-t", f"{fim - corte:.3f}",
           "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", saida]
    subprocess.run(cmd, check=True)
    return saida


def rodar(reel: Reel) -> str:
    caminho = asyncio.run(gravar(reel))
    print(f"OK {caminho}")
    return caminho
