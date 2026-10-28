"""Aula 31: foto marcada e vídeo do defeito no orçamento (E45 a E47).

A foto e o vídeo saem de `dados/`: a foto é um quadro do vídeo de exemplo da
landing (gerado por computador), que também é o vídeo enviado na aula.
"""
import asyncio, os, re, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "motor"))
from motor import (Aula, Passo, celular_chat, mover, celular_url, clicar, digitar, fechar_celular, focar, guardar, no_celular,
                   pausa, rolar, rolar_topo, selecionar)

AQUI = os.path.dirname(__file__)
FOTO = os.path.join(AQUI, "dados", "foto-freio.jpg")
VIDEO = os.path.join(AQUI, "..", "..", "..", "apps", "landing", "public", "video-exemplo.mp4")
WA = "() => new URL(window.__wa).searchParams.get('text')"


def CARD(p):
    return p.get_by_text("Fotos e vídeos do defeito", exact=True).first.locator(
        "xpath=ancestor::div[contains(@class,'rounded-xl')][1]")


def NO_CARD(nome):
    return lambda p: CARD(p).get_by_role("button", name=nome, exact=True).first


def D(papel, nome):
    return lambda p: p.get_by_role("dialog").get_by_role(papel, name=nome, exact=True).first


def DL(rotulo):
    return lambda p: p.get_by_role("dialog").get_by_label(rotulo, exact=True).first


def escolher_arquivo(seletor, arquivo):
    """O botão abre a galeria do aparelho, que não aparece no vídeo: o arquivo entra direto no campo."""
    async def f(g):
        await g.p.locator(seletor).first.set_input_files(os.path.abspath(arquivo))
        await asyncio.sleep(1.2)
    return f


def riscar(de, ate, passos=24):
    """Arrasta sobre a foto, em frações da largura e da altura, com o cursor acompanhando."""
    async def f(g):
        tela = g.p.get_by_label("Foto para marcar o defeito")
        cx = await g.caixa(tela)
        x0, y0 = cx["x"] + cx["width"] * de[0], cx["y"] + cx["height"] * de[1]
        x1, y1 = cx["x"] + cx["width"] * ate[0], cx["y"] + cx["height"] * ate[1]
        await g.js("([x,y]) => window.__tut.mover(x,y)", [x0, y0])
        await asyncio.sleep(0.8)
        m = g.p.mouse
        await m.move(x0, y0)
        await m.down()
        for i in range(1, passos + 1):
            nx, ny = x0 + (x1 - x0) * i / passos, y0 + (y1 - y0) * i / passos
            await m.move(nx, ny)
            await g.js("([x,y]) => window.__tut.mover(x,y)", [nx, ny])
            await asyncio.sleep(0.03)
        await m.up()
        await asyncio.sleep(0.6)
    return f


def esperar_video_pronto():
    """O servidor converte o vídeo para tocar em qualquer celular; leva alguns segundos."""
    async def f(g):
        await CARD(g.p).locator("video").first.wait_for(state="visible", timeout=120000)
        await asyncio.sleep(0.6)
    return f


def tocar_no_celular():
    async def f(g):
        video = g.p.frame_locator("#tut iframe").locator("video").first
        await video.evaluate("v => { v.muted = true; return v.play() }")
        await asyncio.sleep(0.4)
    return f


def caber_na_tela():
    """Com o zoom de 125% da gravação, o vh do diálogo passa da tela e o rodapé some.
    Só na gravação: a foto encolhe para o diálogo caber inteiro."""
    return guardar("_css", """() => { const s = document.createElement('style');
        s.textContent = '[role=dialog] canvas{max-height:24vh!important} [role=dialog]{max-height:54vh!important}';
        document.head.appendChild(s); return true }""")


def mensagem(g):
    return g.dados["wa"].replace("http://localhost:5173", "https://app.oficinaosbr.cloud")


def link_real(g):
    return re.search(r"http\S+/orcamento/\S+", g.dados["wa"]).group(0)


A31 = Aula(
    slug="foto-e-video-do-defeito", numero=31, modulo="Orçamento e aprovação",
    titulo="Foto marcada e vídeo do defeito",
    subtitulo="O cliente vê o que você viu, e aprova sem desconfiar.",
    abertura_fala="Nesta aula, você vai mandar no orçamento uma foto com o defeito marcado e um vídeo do que encontrou.",
    inicio="/ordens/16",
    passos=[
        Passo("O cliente aprova mais rápido quando vê o defeito. Na ordem de serviço, o cartão Fotos e vídeos do defeito leva tudo junto no orçamento.",
              [rolar(CARD), focar(CARD)],
              legenda="Fotos e vídeos do defeito: vão junto no orçamento."),
        Passo("Comece pela foto. No celular, o botão Foto abre a câmera. Tire a foto do defeito.",
              [focar(None), caber_na_tela(), clicar(NO_CARD("Foto")),
               escolher_arquivo('input[type=file][accept="image/*"]:not([capture])', FOTO)],
              legenda="Foto: no celular, abre a câmera."),
        Passo("Agora marque o defeito. Com o círculo, arraste o dedo em volta do disco.",
              [riscar((0.28, 0.25), (0.66, 0.80))]),
        Passo("Com a seta, aponte o lugar exato do desgaste.",
              [clicar(D("radio", "Seta"), 0.3), riscar((0.92, 0.95), (0.55, 0.62))]),
        Passo("Escolha a qual serviço a foto se refere e escreva uma legenda curta.",
              [selecionar(DL("De qual serviço ou peça é?"), "Troca de discos de freio"),
               digitar(DL("Legenda (opcional)"), "Disco riscado, precisa trocar")]),
        Passo("Nos planos Supercharger e Nitro, dá também para gravar a explicação falando: você fala e vai marcando a foto, e vira um vídeo curto.",
              [rolar(D("button", "Gravar explicação")), mover(D("button", "Gravar explicação"))],
              legenda="Supercharger e Nitro: grave a explicação com a sua voz sobre a foto."),
        Passo("Desta vez, só a foto. Toque em Salvar foto.",
              [focar(None), clicar(D("button", "Salvar foto"), 1.6), focar(CARD)]),
        Passo("Agora o vídeo. Toque em Vídeo. No celular, ele abre a câmera e você grava até um minuto.",
              [focar(None), clicar(NO_CARD("Vídeo")),
               escolher_arquivo('input[type=file][accept^="video/*,"]', VIDEO)],
              legenda="Vídeo: até 1 minuto, gravado na hora pelo celular."),
        Passo("Diga de qual serviço o vídeo fala, coloque uma legenda e toque em Enviar vídeo.",
              [selecionar(DL("De qual serviço ou peça o vídeo fala?"), "Troca de discos de freio"),
               digitar(DL("Legenda (opcional)"), "Disco riscado e pastilha no fim"),
               clicar(D("button", "Enviar vídeo"), 1.0)]),
        Passo("O sistema prepara o vídeo para tocar em qualquer celular, até no iPhone. Leva alguns segundos, e você pode continuar trabalhando.",
              [focar(CARD), esperar_video_pronto(), focar(CARD)],
              legenda="O vídeo fica pronto em segundos, para tocar em qualquer celular."),
        Passo("Pronto. Agora mande o orçamento, como sempre: Enviar orçamento, e Gerar orçamento.",
              [focar(None), rolar_topo(),
               clicar(lambda p: p.get_by_role("button", name="Enviar orçamento").first, 1.2),
               clicar(D("button", "Gerar orçamento"), 1.6)]),
        Passo("No WhatsApp, a mensagem já avisa que o orçamento tem foto e vídeo do que foi encontrado.",
              [guardar("_", "() => { window.open = (u) => { window.__wa = u; return null }; return true }"),
               clicar(lambda p: p.get_by_role("button", name="Enviar pelo WhatsApp").first),
               guardar("wa", WA),
               celular_chat("Oficina Demonstração", mensagem)],
              legenda="A mensagem já avisa: o orçamento tem foto e vídeo."),
        Passo("O cliente abre o link e, antes do preço, vê o que a oficina viu no carro dele.",
              [pausa(1.2), celular_url(link_real),
               rolar(no_celular(lambda b: b.get_by_text("O que a oficina viu no seu carro").first))]),
        Passo("Ele assiste ao vídeo ali mesmo, sem baixar nada.",
              [rolar(no_celular(lambda b: b.locator("video").first)), tocar_no_celular(), pausa(3.0)]),
        Passo("E a foto marcada aparece junto do serviço. Agora fica fácil aprovar.",
              [rolar(no_celular(lambda b: b.get_by_alt_text("Disco riscado, precisa trocar").first)), pausa(1.5)],
              legenda="A foto marcada aparece junto do serviço."),
        Passo("Para não ocupar espaço, o vídeo fica disponível por sete dias depois que o cliente responde, e então é apagado. Quem quiser guardar, baixa antes.",
              [fechar_celular(), focar(CARD)],
              legenda="O vídeo fica 7 dias depois da resposta. Baixe se quiser guardar."),
    ],
    encerramento_titulo="O cliente vê o defeito e aprova.",
    encerramento_fala="Pronto! Foto marcada em todos os planos; vídeo e explicação falada no Supercharger e no Nitro. Bom trabalho!",
    proxima=None,
)

if __name__ == "__main__":
    from motor import rodar
    rodar(A31)
