"""Motor dos tutoriais do OficinaOS.

Cada aula é uma lista de passos. Cada passo tem uma FALA (vira narração e
legenda) e AÇÕES no navegador. O motor:
  1. gera a narração de cada fala (voz neural pt-BR) e mede a duração;
  2. grava o navegador em 1920x1080, com o sistema a 125%, fazendo as ações
     enquanto a fala toca — cada passo dura o que a fala dura;
  3. junta o vídeo com as falas nos instantes certos e entrega um MP4.
"""
from __future__ import annotations

import asyncio
import glob
import hashlib
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

import edge_tts
import imageio_ffmpeg
from mutagen.mp3 import MP3
from playwright.async_api import Locator, Page, async_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(RAIZ, "cache-voz")
SAIDA = os.path.join(RAIZ, "videos")
TMP = os.path.join(RAIZ, "tmp")
BASE = os.environ.get("OOS_BASE", "http://localhost:5173")
VOZ = "pt-BR-AntonioNeural"
RITMO = "+6%"
FF = imageio_ffmpeg.get_ffmpeg_exe()
OVERLAY = open(os.path.join(os.path.dirname(__file__), "overlay.js"), encoding="utf-8").read()

Acao = Callable[["Gravacao"], Awaitable[None]]


@dataclass
class Passo:
    fala: str
    acoes: list[Acao] = field(default_factory=list)
    legenda: str | None = None  # se None, a legenda é a própria fala
    depois: float = 0.35  # respiro depois da fala


@dataclass
class Aula:
    slug: str
    numero: int
    modulo: str
    titulo: str
    subtitulo: str
    abertura_fala: str
    passos: list[Passo]
    encerramento_titulo: str
    encerramento_fala: str
    proxima: str | None = None
    usuario: str = "demo@oficinaos.dev"
    inicio: str = "/"  # onde a gravação começa (por trás da abertura)
    # roda ANTES de gravar, na janela sem vídeo: deixa o cenário pronto
    preparo: list[Callable[[Page], Awaitable[None]]] = field(default_factory=list)


# ------------------------------------------------------------------ narração

async def _tts(texto: str) -> tuple[str, float]:
    os.makedirs(CACHE, exist_ok=True)
    chave = hashlib.sha1(f"{VOZ}|{RITMO}|{texto}".encode()).hexdigest()[:16]
    arq = os.path.join(CACHE, chave + ".mp3")
    if not os.path.exists(arq):
        await edge_tts.Communicate(texto, VOZ, rate=RITMO).save(arq)
    return arq, MP3(arq).info.length


# ------------------------------------------------------------------ gravação

class Gravacao:
    def __init__(self, pagina: Page, aula: Aula):
        self.p = pagina
        self.aula = aula
        self.t0 = time.monotonic()
        self.falas: list[tuple[float, str]] = []  # (segundos desde t0, arquivo)

    def agora(self) -> float:
        return time.monotonic() - self.t0

    async def js(self, codigo: str, *args):
        if "__tut" in codigo:
            # uma navegação completa recria a página: espera a camada voltar e repõe o selo
            await self.p.wait_for_function("() => !!window.__tut", timeout=15000)
            selo = getattr(self, "selo", None)
            if selo and not await self.p.evaluate("() => !document.querySelector('#tut .tut-selo').hidden"):
                await self.p.evaluate("t => window.__tut.selo(t)", selo)
        try:
            return await self.p.evaluate(codigo, *args)
        except Exception as e:
            # o clique anterior navegou no meio do comando: espera a página nova e tenta de novo
            if "Execution context was destroyed" not in str(e) and "__tut" not in str(e):
                raise
            await self.p.wait_for_load_state()
            await self.p.wait_for_function("() => !!window.__tut", timeout=15000)
            return await self.p.evaluate(codigo, *args)

    async def falar(self, texto: str, legenda: str | None, acoes: list[Acao], depois: float):
        arq, dur = await _tts(texto)
        inicio = self.agora()
        self.falas.append((inicio, arq))
        if legenda != "":
            await self.js("t => window.__tut.legenda(t)", legenda or texto)
        for acao in acoes:
            await acao(self)
        falta = dur - (self.agora() - inicio)
        if falta > 0:
            await asyncio.sleep(falta)
        await asyncio.sleep(depois)

    # posição de um elemento na tela de 1920x1080
    async def caixa(self, alvo: Locator) -> dict:
        await alvo.wait_for(state="visible", timeout=15000)
        cx = await alvo.bounding_box()
        if cx is None:
            raise RuntimeError(f"sem caixa para {alvo}")
        return cx


# ------------------------------------------------------------------ ações

def pausa(seg: float) -> Acao:
    async def f(g: Gravacao):
        await asyncio.sleep(seg)
    return f


def ir(caminho: str) -> Acao:
    async def f(g: Gravacao):
        await g.p.goto(BASE + caminho)
        await g.p.wait_for_function("() => !!window.__tut")
        await g.p.wait_for_timeout(900)
    return f


def mover(alvo: Callable[[Page], Locator]) -> Acao:
    async def f(g: Gravacao):
        cx = await g.caixa(alvo(g.p))
        await g.js("([x,y]) => window.__tut.mover(x,y)", [cx["x"] + cx["width"] / 2, cx["y"] + cx["height"] / 2])
        await asyncio.sleep(0.75)
    return f


def clicar(alvo: Callable[[Page], Locator], espera: float = 0.6) -> Acao:
    async def f(g: Gravacao):
        loc = alvo(g.p)
        await loc.wait_for(state="visible", timeout=15000)
        # centraliza: com o cabeçalho fixo, o "se precisar" do Playwright deixa o alvo embaixo dele
        await loc.evaluate("el => el.scrollIntoView({block:'center'})")
        await asyncio.sleep(0.35)
        cx = await g.caixa(loc)
        x, y = cx["x"] + cx["width"] / 2, cx["y"] + cx["height"] / 2
        await g.js("([x,y]) => window.__tut.mover(x,y)", [x, y])
        await asyncio.sleep(0.8)
        await g.js("([x,y]) => window.__tut.onda(x,y)", [x, y])
        try:
            await loc.click(timeout=5000)
        except Exception:
            # botão no pé de diálogo comprido: com o zoom de 125% o Playwright às vezes acha que
            # ele está fora da tela. O cursor já está nele; aciona direto, o efeito é o mesmo
            await loc.evaluate("el => el.click()")
        await asyncio.sleep(espera)
    return f


def digitar(alvo: Callable[[Page], Locator], texto: str, atraso: int = 55) -> Acao:
    async def f(g: Gravacao):
        loc = alvo(g.p)
        await clicar(lambda p: loc, 0.2)(g)
        # campo que já vem preenchido (a km da OS, o percentual 0): limpa antes, senão emenda
        await loc.fill("")
        await loc.press_sequentially(texto, delay=atraso)
        await asyncio.sleep(0.3)
    return f


def marcar(alvo: Callable[[Page], Locator]) -> Acao:
    async def f(g: Gravacao):
        loc = alvo(g.p)
        cx = await g.caixa(loc)
        x, y = cx["x"] + cx["width"] / 2, cx["y"] + cx["height"] / 2
        await g.js("([x,y]) => window.__tut.mover(x,y)", [x, y])
        await asyncio.sleep(0.8)
        await g.js("([x,y]) => window.__tut.onda(x,y)", [x, y])
        await loc.check()
        await asyncio.sleep(0.4)
    return f


def focar(alvo: Callable[[Page], Locator] | None, pad: int = 12) -> Acao:
    async def f(g: Gravacao):
        if alvo is None:
            await g.js("() => window.__tut.foco(null)")
            return
        loc = alvo(g.p)
        await loc.evaluate("el => el.scrollIntoView({behavior:'smooth', block:'center'})")
        await asyncio.sleep(0.7)
        cx = await g.caixa(loc)
        await g.js("([r,p]) => window.__tut.foco(r,p)", [cx, pad])
        await asyncio.sleep(0.5)
    return f


def cartao(titulo: str):
    """O cartão inteiro (borda arredondada) que tem este título."""
    return lambda p: p.get_by_role("heading", name=titulo, exact=True).first.locator(
        "xpath=ancestor::div[contains(@class,'rounded-xl')][1]")


def rolar(alvo: Callable[[Page], Locator]) -> Acao:
    async def f(g: Gravacao):
        await alvo(g.p).evaluate("el => el.scrollIntoView({behavior:'smooth', block:'center'})")
        await asyncio.sleep(0.9)
    return f


def rolar_topo() -> Acao:
    async def f(g: Gravacao):
        await g.js("() => window.scrollTo({top:0, behavior:'smooth'})")
        await asyncio.sleep(0.8)
    return f


def celular_chat(contato: str, texto: Callable[["Gravacao"], str] | str) -> Acao:
    async def f(g: Gravacao):
        t = texto(g) if callable(texto) else texto
        await g.js("([c,t]) => window.__tut.celularChat(c,t)", [contato, t])
        await asyncio.sleep(0.6)
    return f


def celular_url(url: Callable[["Gravacao"], str] | str, rotulo: str = "Celular do cliente") -> Acao:
    async def f(g: Gravacao):
        u = url(g) if callable(url) else url
        await g.js("([u,r]) => window.__tut.celularUrl(u,r)", [u, rotulo])
        frame = g.p.frame_locator("#tut iframe")
        await frame.locator("body").wait_for()
        await asyncio.sleep(1.2)
    return f


def no_celular(alvo: Callable[["Locator"], Locator]):
    """Converte um alvo dentro do iframe do celular num alvo da página."""
    return lambda p: alvo(p.frame_locator("#tut iframe").locator("body"))


def fechar_celular() -> Acao:
    async def f(g: Gravacao):
        await g.js("() => window.__tut.fecharCelular()")
        await asyncio.sleep(0.6)
    return f


def guardar(nome: str, codigo: str) -> Acao:
    """Roda JS na página e guarda o resultado em g.dados[nome]."""
    async def f(g: Gravacao):
        if not hasattr(g, "dados"):
            g.dados = {}
        g.dados[nome] = await g.js(codigo)
    return f


def tecla(combinacao: str, espera: float = 0.6) -> Acao:
    async def f(g: Gravacao):
        await g.p.keyboard.press(combinacao)
        await asyncio.sleep(espera)
    return f


def escrever(texto: str, atraso: int = 70) -> Acao:
    """Digita no campo que já está com o foco (ex.: a busca do Ctrl+K)."""
    async def f(g: Gravacao):
        await g.p.keyboard.type(texto, delay=atraso)
        await asyncio.sleep(0.4)
    return f


def selecionar(alvo: Callable[[Page], Locator], opcao: str) -> Acao:
    async def f(g: Gravacao):
        loc = alvo(g.p)
        await loc.evaluate("el => el.scrollIntoView({block:'center'})")
        cx = await g.caixa(loc)
        x, y = cx["x"] + cx["width"] / 2, cx["y"] + cx["height"] / 2
        await g.js("([x,y]) => window.__tut.mover(x,y)", [x, y])
        await asyncio.sleep(0.8)
        await g.js("([x,y]) => window.__tut.onda(x,y)", [x, y])
        # o texto da opção pode ter espaço sem quebra (U+00A0): casa por "contém", com espaço normalizado
        norm = lambda t: re.sub(r"\s+", " ", t.replace(" ", " ")).strip()
        textos = await loc.locator("option").all_inner_texts()
        escolhida = next((t for t in textos if norm(opcao) in norm(t)), None)
        if escolhida is None:
            raise RuntimeError(f"opção '{opcao}' não existe em {textos}")
        await loc.select_option(label=escolhida)
        await asyncio.sleep(0.5)
    return f


def assinar(alvo: Callable[[Page], Locator]) -> Acao:
    """Desenha uma assinatura no quadro, com o cursor acompanhando o traço."""
    async def f(g: Gravacao):
        import math
        loc = alvo(g.p)
        await loc.evaluate("el => el.scrollIntoView({block:'center'})")
        await asyncio.sleep(0.4)
        cx = await g.caixa(loc)
        x0, y0, w, h = cx["x"], cx["y"], cx["width"], cx["height"]
        pontos = []
        for i in range(70):  # um traço ondulado que lembra assinatura, sem cara de reta
            t = i / 69
            pontos.append((x0 + w * (0.12 + 0.72 * t), y0 + h * (0.55 - 0.28 * math.sin(t * math.pi * 3.2) * (1 - 0.4 * t))))
        await g.js("([x,y]) => window.__tut.mover(x,y)", [pontos[0][0], pontos[0][1]])
        await asyncio.sleep(0.8)
        m = g.p.mouse
        await m.move(*pontos[0])
        await m.down()
        for px, py in pontos[1:]:
            await m.move(px, py, steps=2)
            await g.js("([x,y]) => window.__tut.mover(x,y)", [px, py])
        await m.up()
        await asyncio.sleep(0.5)
    return f


def arrastar(alvo: Callable[[Page], Locator], dx: float, dy: float) -> Acao:
    async def f(g: Gravacao):
        loc = alvo(g.p)
        await loc.evaluate("el => el.scrollIntoView({block:'center'})")
        await asyncio.sleep(0.4)
        cx = await g.caixa(loc)
        x, y = cx["x"] + cx["width"] / 2, cx["y"] + min(cx["height"] / 2, 18)
        await g.js("([x,y]) => window.__tut.mover(x,y)", [x, y])
        await asyncio.sleep(0.8)
        m = g.p.mouse
        await m.move(x, y)
        await m.down()
        for i in range(1, 26):
            nx, ny = x + dx * i / 25, y + dy * i / 25
            await m.move(nx, ny)
            await g.js("([x,y]) => window.__tut.mover(x,y)", [nx, ny])
            await asyncio.sleep(0.03)
        await m.up()
        await asyncio.sleep(0.8)
    return f


def grupo(*textos: str):
    """O menor bloco da tela que contém todos estes textos."""
    def alvo(p: Page) -> Locator:
        loc = p.locator("main div")
        for t in textos:
            loc = loc.filter(has_text=t)
        return loc.last
    return alvo


def celular_app(caminho: str, rotulo: str) -> Acao:
    """O próprio sistema aberto dentro do celular (a mesma sessão da gravação)."""
    return celular_url(lambda g: BASE + caminho, rotulo)


# ------------------------------------------------------------------ execução

async def _entrar(navegador, usuario: str, preparo=()) -> dict:
    """Entra numa janela SEM vídeo e devolve a sessão, sem navegar de novo
    (uma navegação a mais troca o token de renovação e invalida o salvo)."""
    ctx = await navegador.new_context(viewport={"width": 1920, "height": 1080})
    pg = await ctx.new_page()
    await pg.goto(BASE + "/entrar")
    await pg.get_by_label(re.compile("e-mail", re.I)).fill(usuario)
    await pg.get_by_label(re.compile("senha", re.I)).first.fill("demonstracao2026")
    await pg.get_by_role("button", name=re.compile("entrar", re.I)).click()
    await pg.wait_for_url(re.compile(r"^(?!.*entrar).*$"), timeout=20000)
    await pg.wait_for_timeout(800)
    for etapa in preparo:
        await etapa(pg)
        await pg.wait_for_timeout(600)
    estado = await ctx.storage_state()
    await ctx.close()
    return estado


async def gravar(aula: Aula) -> str:
    os.makedirs(SAIDA, exist_ok=True)
    pasta = os.path.join(TMP, aula.slug)
    shutil.rmtree(pasta, ignore_errors=True)
    os.makedirs(pasta)

    async with async_playwright() as pw:
        nav = await pw.chromium.launch()
        estado = await _entrar(nav, aula.usuario, aula.preparo)
        ctx = await nav.new_context(
            viewport={"width": 1920, "height": 1080},
            record_video_dir=pasta,
            record_video_size={"width": 1920, "height": 1080},
            storage_state=estado,
        )
        await ctx.add_init_script(OVERLAY)
        pg = await ctx.new_page()
        g = Gravacao(pg, aula)
        await pg.goto(BASE + aula.inicio)
        await pg.wait_for_function("() => !!window.__tut")
        await g.js("([m,n,t,s]) => window.__tut.abertura(m,n,t,s)", [aula.modulo, aula.numero, aula.titulo, aula.subtitulo])
        await pg.evaluate("document.fonts.ready")
        corte = g.agora()  # o vídeo final começa aqui, já com a abertura na tela
        await asyncio.sleep(0.4)
        await g.falar(aula.abertura_fala, "", [], 0.6)
        await g.js("() => window.__tut.esconderCard()")
        g.selo = f"OficinaOS · Aula {aula.numero}"
        await g.js("t => window.__tut.selo(t)", g.selo)
        await asyncio.sleep(0.6)
        for passo in aula.passos:
            await g.falar(passo.fala, passo.legenda, passo.acoes, passo.depois)
        g.selo = None
        await g.js("() => { window.__tut.legenda(null); window.__tut.foco(null); window.__tut.selo(null) }")
        await g.js("([t,p]) => window.__tut.encerramento(t,p)", [aula.encerramento_titulo, aula.proxima])
        await asyncio.sleep(0.5)
        await g.falar(aula.encerramento_fala, "", [], 1.2)
        fim = g.agora()
        await ctx.close()
        await nav.close()

    video = glob.glob(os.path.join(pasta, "*.webm"))[0]
    return _montar(aula, video, g.falas, corte, fim)


def _montar(aula: Aula, video: str, falas: list[tuple[float, str]], corte: float, fim: float) -> str:
    saida = os.path.join(SAIDA, f"{aula.numero:02d}-{aula.slug}.mp4")
    entradas = ["-ss", f"{corte:.3f}", "-i", video]
    filtros, rotulos = [], []
    for i, (t, arq) in enumerate(falas, start=1):
        entradas += ["-i", arq]
        ms = max(0, int((t - corte) * 1000))
        filtros.append(f"[{i}:a]adelay={ms}|{ms}[a{i}]")
        rotulos.append(f"[a{i}]")
    filtros.append(f"{''.join(rotulos)}amix=inputs={len(rotulos)}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]")
    cmd = [FF, "-y", "-loglevel", "error", *entradas, "-filter_complex", ";".join(filtros),
           "-map", "0:v", "-map", "[a]", "-t", f"{fim - corte:.3f}",
           "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", saida]
    subprocess.run(cmd, check=True)
    return saida


def rodar(aula: Aula):
    caminho = asyncio.run(gravar(aula))
    print(f"OK {caminho}")
    return caminho
