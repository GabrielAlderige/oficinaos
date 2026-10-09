"""Os Reels do OficinaOS: 15 vídeos verticais para atrair donos de oficina.

Rodar:  python reels.py 1 2 3     (grava os pedidos)
        python reels.py todos
Antes de cada reel a demo é recriada, como nos tutoriais.
"""
import asyncio, os, re, subprocess, sys, time

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(AQUI, "..", "tutoriais", "motor"))
from motor import BASE, Passo, clicar, digitar, focar, guardar, marcar, pausa, rolar, rolar_topo, tecla, escrever  # noqa: E402
from motor_reels import Reel, rodar, topo  # noqa: E402
sys.path.insert(0, os.path.join(AQUI, "..", "tutoriais", "aulas"))
from motor import assinar, cartao, grupo, selecionar  # noqa: E402
from curso import CHAVE_PIX, prep_pix, prep_posvenda  # noqa: E402

REPO = os.path.abspath(os.path.join(AQUI, "..", ".."))


# ------------------------------------------------------------------ atalhos

def B(nome, exato=True):
    return lambda p: p.get_by_role("button", name=nome, exact=exato).first


def BR(padrao):
    return lambda p: p.get_by_role("button", name=re.compile(padrao)).first


def TX(texto, exato=False):
    return lambda p: p.locator("main").get_by_text(texto, exact=exato).first


def H1(p):
    return p.get_by_role("heading", level=1).first


def ir_a(caminho_ou_fn):
    """Navega (caminho fixo ou calculado na hora) e espera a camada voltar."""
    async def f(g):
        alvo = caminho_ou_fn(g) if callable(caminho_ou_fn) else caminho_ou_fn
        legenda = await g.p.evaluate("() => document.querySelector('#tut .tut-leg.on')?.textContent || null")
        no_painel = not await g.p.evaluate("() => /^\\/(orcamento|acompanhar|cotacao)\\//.test(location.pathname)")
        if no_painel and alvo.startswith("/") and not alvo.startswith("/orcamento/"):
            # dentro do painel: troca de tela sem recarregar (sem tela branca, a camada continua)
            await g.p.evaluate("p => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }", alvo)
            await g.p.wait_for_timeout(1200)
            return
        url = alvo if alvo.startswith("http") else BASE + alvo
        await g.p.goto(url)
        await g.p.wait_for_function("() => !!window.__tut")
        await g.p.wait_for_timeout(700)
        if legenda:
            await g.js("t => window.__tut.legenda(t)", legenda)
    return f


def novo_topo(texto):
    async def f(g):
        g.topo_atual = texto
        await topo(texto)(g)
    return f


ABRIR_JANELA = "() => { window.open = (u) => { window.__wa = u; return null }; return true }"
TEXTO_WA = "() => new URL(window.__wa).searchParams.get('text')"


def link_do_orcamento(g):
    return re.search(r"http\S+/orcamento/\S+", g.dados["wa"]).group(0)


# ------------------------------------------------------------------ os reels

R01 = Reel(
    numero=1, slug="orcamento-pelo-celular",
    gancho_sobre="Dono de oficina",
    gancho="Cliente *some* depois que você manda o orçamento?",
    gancho_fala="Seu cliente some depois que você manda o orçamento?",
    topo="Orçamento aprovado *pelo celular*",
    inicio="/ordens/16",
    passos=[
        Passo("Lançou os serviços na ordem de serviço? Toque em Enviar orçamento.",
              [focar(None), clicar(B("Enviar orçamento"))],
              legenda="Itens lançados? Toque em Enviar orçamento."),
        Passo("Gerou, e o link sai pronto para o WhatsApp do cliente.",
              [clicar(B("Gerar orçamento"), 1.0), guardar("_", ABRIR_JANELA),
               clicar(B("Enviar pelo WhatsApp")), guardar("wa", TEXTO_WA)],
              legenda="O link sai pronto para o WhatsApp do cliente."),
        Passo("O cliente abre no celular, vê cada item com o preço, e aprova.",
              [ir_a(link_do_orcamento), pausa(0.6), rolar(lambda p: p.get_by_text("Total", exact=True).first),
               clicar(B("Aprovar orçamento"))],
              legenda="O cliente vê cada item e aprova no celular."),
        Passo("Confirma com o nome, e pronto.",
              [digitar(lambda p: p.get_by_placeholder("Como a oficina te chama"), "Ana Paula"),
               marcar(lambda p: p.get_by_role("checkbox")),
               clicar(B("Confirmar aprovação"), 1.4)]),
        Passo("Na sua tela, a OS muda sozinha para aprovada, com data e hora. Ninguém mais diz que não autorizou.",
              [ir_a("/ordens/16"), pausa(0.5), focar(H1)],
              legenda="A OS muda sozinha para aprovada, com data e hora."),
    ],
    chamada="Orçamento aprovado *sem ligar* para ninguém.",
    chamada_sub="O OficinaOS organiza a sua oficina do check-in à entrega.",
)

def DB(nome):
    return lambda p: p.get_by_role("dialog").get_by_role("button", name=nome, exact=True).first


def DL(rotulo):
    return lambda p: p.get_by_role("dialog").get_by_label(rotulo, exact=True).first


def PH(texto):
    return lambda p: p.get_by_placeholder(re.compile(re.escape(texto))).first


def anexar(seletor, arquivo):
    async def f(g):
        await g.p.locator(seletor).first.set_input_files(arquivo)
        await asyncio.sleep(0.8)
    return f


def liberar_copiar():
    async def f(g):
        await g.p.context.grant_permissions(["clipboard-read", "clipboard-write"])
    return f


async def prep_comissao(pg):
    """10% de comissão e uma OS finalizada: a tela de comissões passa a ter o que mostrar."""
    await pg.goto(BASE + "/configuracoes/precos")
    campo = pg.get_by_label("Comissão padrão do mecânico", exact=True)
    await campo.wait_for()
    await campo.fill("10")
    await pg.get_by_role("button", name="Salvar", exact=True).click()
    await pg.wait_for_timeout(1200)
    await pg.goto(BASE + "/ordens/8")
    await pg.get_by_role("button", name="Finalizar serviço").first.click()
    await pg.get_by_role("alertdialog").get_by_role("button", name="Finalizar serviço").click()
    await pg.wait_for_timeout(1500)


async def prep_pacote(pg):
    """O pacote da revisão já existe: o reel mostra só o uso na OS."""
    await pg.goto(BASE + "/servicos/pacotes")
    await pg.get_by_role("button", name="Novo pacote").first.click()
    d = pg.get_by_role("dialog")
    await d.get_by_label("Nome do pacote").fill("Revisão dos 10.000 km")
    await d.get_by_role("button", name=re.compile("^Revisão completa")).click()
    await d.get_by_role("tab", name="Peças").click()
    await d.get_by_role("button", name=re.compile("^Filtro de óleo")).click()
    await d.get_by_role("button", name=re.compile("^Filtro de ar")).click()
    await d.get_by_role("button", name="Criar pacote").click()
    await pg.wait_for_timeout(1200)


PLANILHA = os.path.join(REPO, "ferramentas", "tutoriais", "aulas", "dados", "clientes-exemplo.csv")

R02 = Reel(
    numero=2, slug="check-in-com-fotos",
    gancho_sobre="Na entrega do carro", gancho="O risco no para-choque *já estava lá*?",
    gancho_fala="O cliente jura que o risco no para-choque não estava lá?",
    topo="", inicio="/ordens/18",
    passos=[
        Passo("No check-in, a quilometragem e o combustível ficam registrados na entrada.",
              [clicar(B("Check-in")), digitar(DL("Quilometragem de entrada"), "44320"), selecionar(DL("Combustível"), "1/2")],
              legenda="Quilometragem e combustível registrados na entrada."),
        Passo("Viu um risco? Marca onde está, antes de mexer no carro.",
              [selecionar(DL("Local"), "Para-choque traseiro"), selecionar(DL("Tipo"), "Risco"), clicar(DB("Adicionar avaria"))],
              legenda="Risco no para-choque: anotado antes do serviço."),
        Passo("Pelo celular, as fotos ficam guardadas na OS, com data e hora.",
              [clicar(DB("Registrar check-in"), 1.6)],
              legenda="Fotos guardadas na OS, com data e hora."),
    ],
    chamada="Foto na chegada, *zero* discussão na entrega.",
    chamada_sub="Check-in com fotos, checklist e assinatura na entrega.",
)

R03 = Reel(
    numero=3, slug="faturado-e-recebido",
    gancho_sobre="Pergunta rápida", gancho="Quanto sua oficina *faturou* este mês?",
    gancho_fala="Quanto a sua oficina faturou este mês? E quanto entrou de verdade no caixa?",
    topo="", inicio="/",
    passos=[
        Passo("Abriu o sistema, está na tela: carros no pátio, orçamentos esperando e o que está pronto para entregar.",
              [focar(grupo("Na oficina", "Agendados hoje"))],
              legenda="O pátio inteiro na primeira tela."),
        Passo("E o dinheiro do mês: o que foi faturado e o que entrou no caixa. Faturar não é receber.",
              [focar(None), rolar(TX("Faturado")), focar(lambda p: p.locator("main").get_by_text("Faturado").first.locator("xpath=ancestor::div[contains(@class,'rounded')][1]"))],
              legenda="Faturado e recebido, separados."),
        Passo("E a lista do que precisa de atenção hoje.",
              [focar(None), rolar(TX("Atenção necessária")), focar(cartao("Atenção necessária"))]),
    ],
    chamada="Saia do *caderno*. Feche o mês em um minuto.",
    chamada_sub="Painel do dia, contas a receber, fluxo de caixa e relatórios.",
)

R04 = Reel(
    numero=4, slug="mecanico-no-celular",
    gancho_sobre="No pátio", gancho="Mecânico ainda trabalha com *papel*?",
    gancho_fala="O seu mecânico ainda trabalha com papel no pátio?",
    topo="", inicio="/minhas-os", usuario="mechanic@oficinaos.dev",
    passos=[
        Passo("Cada mecânico vê no celular só os carros que estão com ele.",
              [focar(lambda p: p.locator("main").get_by_text("OS 8").first.locator("xpath=ancestor::div[contains(@class,'rounded')][1]"))],
              legenda="Cada mecânico vê só os carros dele."),
        Passo("Começou o diagnóstico? Um toque, e a OS avança de etapa. O dono vê na hora.",
              [focar(None), clicar(lambda p: p.get_by_role("button", name=re.compile("Iniciar")).first, 1.4)],
              legenda="Um toque e a OS avança. O dono vê na hora."),
        Passo("Sem aplicativo de loja: abre no navegador e fica na tela inicial do celular.",
              [pausa(1.0)]),
    ],
    chamada="A OS no *bolso* do mecânico.",
    chamada_sub="Ele vê os carros dele e não vê o seu financeiro.",
)

R05 = Reel(
    numero=5, slug="estoque-minimo",
    gancho_sobre="Já aconteceu aí?", gancho="A peça acabou com o carro *no elevador*.",
    gancho_fala="A peça acabou, e o carro está parado no elevador.",
    topo="", inicio="/pecas",
    passos=[
        Passo("A peça que sai na OS baixa do estoque sozinha. O sistema avisa o que está abaixo do mínimo.",
              [clicar(BR("^Abaixo do mínimo"), 1.2)],
              legenda="Baixa sozinha. Avisa o que está acabando."),
        Passo("E monta a lista do que comprar, com a quantidade.",
              [ir_a("/pecas/recomendacoes"), focar(TX("Acabando no estoque"))],
              legenda="A lista de compra sai pronta."),
        Passo("Um toque e ela vai copiada para o WhatsApp do fornecedor.",
              [focar(None), liberar_copiar(), clicar(B("Copiar lista"), 1.4)]),
    ],
    chamada="Compre *antes* de faltar.",
    chamada_sub="Estoque com mínimo, custo médio e lista de reposição.",
)

R06 = Reel(
    numero=6, slug="cliente-que-volta",
    gancho_sobre="Dinheiro esquecido", gancho="Seu cliente *esquece* da revisão. E você também.",
    gancho_fala="O seu cliente esquece da revisão. E, sejamos sinceros, você também.",
    topo="", inicio="/pos-venda", preparo=[prep_posvenda],
    passos=[
        Passo("Todo dia de manhã, o sistema monta a lista de quem chamar: pós-venda, revisão vencendo e quem sumiu.",
              [clicar(B("Todos"), 1.2), focar(lambda p: p.locator("main").get_by_role("link", name="Abrir no WhatsApp").first.locator("xpath=ancestor::div[contains(@class,'rounded')][1]"))],
              legenda="A lista de quem chamar hoje, pronta toda manhã."),
        Passo("A mensagem já vem escrita. É só tocar e mandar no WhatsApp.",
              [focar(lambda p: p.locator("main").get_by_role("link", name="Abrir no WhatsApp").first)],
              legenda="Mensagem pronta para o WhatsApp."),
    ],
    chamada="Cliente que *volta*, sem anúncio.",
    chamada_sub="Pós-venda, lembrete de revisão e funil de clientes.",
)

R07 = Reel(
    numero=7, slug="pix-na-hora",
    gancho_sobre="Na hora de receber", gancho="Pix na hora, *sem maquininha*.",
    gancho_fala="Receba no Pix na hora, sem maquininha e sem taxa do sistema.",
    topo="", inicio="/ordens/6", preparo=[prep_pix],
    passos=[
        Passo("Na OS pronta, toque em Pix na hora. O QR já vem com o valor certo.",
              [clicar(B("Dinheiro"), 1.0), clicar(B("Pix na hora"), 1.2), focar(lambda p: p.get_by_role("dialog"))],
              legenda="O QR já vem com o valor da OS."),
        Passo("O dinheiro cai direto na chave da sua oficina. Recebeu? Um toque e o caixa está certo.",
              [focar(None), clicar(DB("Recebi, dar baixa"), 1.2), clicar(DB("Registrar"), 1.6)],
              legenda="Cai na sua chave. Um toque e o caixa fecha."),
    ],
    chamada="Recebeu, *baixou*, caixa certo.",
    chamada_sub="Pix com QR na chave da sua oficina, sem intermediário.",
)

R08 = Reel(
    numero=8, slug="busca-pela-placa",
    gancho_sobre="No balcão", gancho="O cliente chegou e só lembra *a placa*?",
    gancho_fala="O cliente chegou e só lembra a placa do carro?",
    topo="", inicio="/",
    passos=[
        Passo("Digita a placa na busca.",
              [clicar(lambda p: p.get_by_role("button", name=re.compile("Buscar", re.I)).first), escrever("DEM1A01"), pausa(0.6)]),
        Passo("Pronto: o carro, o dono e todo o histórico de serviços.",
              [clicar(lambda p: p.get_by_role("dialog").get_by_text("Volkswagen Gol").first, 1.6), rolar(TX("Histórico de serviços")), focar(cartao("Histórico de serviços"))],
              legenda="Carro, dono e histórico de serviços."),
    ],
    chamada="Tudo do carro em *dois segundos*.",
    chamada_sub="Busca por placa, nome ou telefone.",
)

R09 = Reel(
    numero=9, slug="acompanhamento-online",
    gancho_sobre="O telefone não para", gancho="\"Meu carro *já ficou pronto*?\"",
    gancho_fala="Quantas vezes por dia o cliente liga perguntando se o carro já ficou pronto?",
    topo="", inicio="/ordens/8",
    passos=[
        Passo("Na OS, toque em Link de acompanhamento. A mensagem sai pronta para o WhatsApp do cliente.",
              [guardar("_", ABRIR_JANELA), clicar(BR("Link de acompanhamento"), 1.0), guardar("wa", TEXTO_WA)],
              legenda="Um toque: o link vai pronto pelo WhatsApp."),
        Passo("O cliente abre e vê em que etapa está o carro, sem baixar nada.",
              [ir_a(lambda g: re.search(r"http\S+/acompanhar/\S+", g.dados["wa"]).group(0)), pausa(1.0)],
              legenda="O cliente vê a etapa do carro, sem ligar."),
        Passo("Mudou a etapa na oficina, muda no celular dele.",
              [rolar(lambda p: p.locator("body").get_by_text(re.compile("execu", re.I)).first)],
              legenda="Mudou na oficina, muda no celular dele."),
    ],
    chamada="Menos telefone, *mais* serviço.",
    chamada_sub="Link de acompanhamento para cada carro da oficina.",
)

R10 = Reel(
    numero=10, slug="agenda",
    gancho_sobre="Organização", gancho="Agenda no *caderno* da recepção?",
    gancho_fala="A agenda da sua oficina ainda é o caderno da recepção?",
    topo="", inicio="/agenda",
    passos=[
        Passo("Os horários do dia, com o carro, o serviço e o mecânico de cada um.",
              [focar(lambda p: p.locator("main").get_by_role("button", name=re.compile("^Troca de óleo")).first)],
              legenda="Carro, serviço e mecânico de cada horário."),
        Passo("Na véspera, o sistema avisa quem ainda não confirmou. E quando o carro chega, o agendamento vira a OS.",
              [focar(None), clicar(B("Semana"), 1.2)],
              legenda="Avisa quem não confirmou. Vira OS na chegada."),
    ],
    chamada="Agenda que *trabalha* por você.",
    chamada_sub="Dia, semana e mês, com aviso de conflito de horário.",
)

R11 = Reel(
    numero=11, slug="ficha-do-carro",
    gancho_sobre="Pergunta do dia a dia", gancho="Qual óleo vai *nesse carro*?",
    gancho_fala="Qual óleo vai nesse carro? Quanto leva? Qual a medida do pneu?",
    topo="", inicio="/ficha-do-carro",
    passos=[
        Passo("Digita o modelo e o ano.",
              [digitar(PH("Gol 2013"), "Onix 2019"), pausa(0.8)]),
        Passo("Óleo, quantidade, filtros, pastilhas, pneus e torques, com a fonte de cada dado.",
              [clicar(lambda p: p.locator("main").get_by_role("button", name="Ver ficha").first, 1.6),
               focar(lambda p: p.locator("[role=dialog]").or_(p.locator("main")).last)],
              legenda="Óleo, filtros, pastilhas, pneus e torques."),
    ],
    chamada="Mais de *300 carros* com ficha pronta.",
    chamada_sub="Ficha técnica conferida em manual, dentro do sistema.",
)

R12 = Reel(
    numero=12, slug="pacote-de-revisao",
    gancho_sobre="Ganhe tempo", gancho="Orçamento de revisão em *um toque*.",
    gancho_fala="Monte o orçamento da revisão em um toque.",
    topo="", inicio="/ordens/19", preparo=[prep_pacote],
    passos=[
        Passo("Na OS, toque em Adicionar e escolha o pacote pronto.",
              [clicar(BR("^Adicionar$")), clicar(lambda p: p.get_by_role("dialog").get_by_role("tab", name="Pacotes").first),
               clicar(lambda p: p.get_by_role("dialog").get_by_role("button", name=re.compile("^Revisão dos 10")).first, 1.6)],
              legenda="Adicionar, Pacotes, um toque."),
        Passo("Serviço e peças entram de uma vez, com o preço do catálogo.",
              [focar(TX("Filtro de ar", True))],
              legenda="Serviço e peças de uma vez."),
    ],
    chamada="Menos digitação, *mais* carro saindo.",
    chamada_sub="Pacotes de serviço que a sua oficina mais vende.",
)

R13 = Reel(
    numero=13, slug="entrega-com-assinatura",
    gancho_sobre="Na entrega", gancho="Entrega com *assinatura* na tela.",
    gancho_fala="Na entrega, o cliente assina na tela do celular.",
    topo="", inicio="/ordens/6",
    passos=[
        Passo("Quem recebeu e a quilometragem de saída.",
              [clicar(B("Entregar veículo")), digitar(DL("Quem recebeu"), "Fábio Marques"), digitar(DL("Km na saída"), "65012")]),
        Passo("O cliente assina com o dedo. Fica guardado como comprovante.",
              [assinar(lambda p: p.get_by_role("dialog").locator("canvas").first)],
              legenda="Assinatura guardada como comprovante."),
        Passo("E a OS fecha como entregue.",
              [clicar(DB("Entregar veículo"), 1.6), focar(H1)]),
    ],
    chamada="Entregou, *assinou*, guardou.",
    chamada_sub="Comprovante de entrega com assinatura e quilometragem.",
)

R14 = Reel(
    numero=14, slug="quem-abriu-o-orcamento",
    gancho_sobre="Orçamento enviado", gancho="Você sabe se o cliente *abriu* o orçamento?",
    gancho_fala="Você mandou o orçamento. Mas o cliente abriu?",
    topo="", inicio="/orcamentos",
    passos=[
        Passo("Aqui ficam todos os orçamentos enviados, com quem já abriu o link e quem ainda nem viu.",
              [focar(lambda p: p.locator("main a").filter(has_text="Camila Nogueira").first)],
              legenda="Quem abriu o link e quem nem viu."),
        Passo("E até quando cada orçamento vale. Dá para filtrar os aprovados, os recusados e os que esperam resposta.",
              [focar(None), clicar(B("Recusado"), 1.2), clicar(B("Aguardando resposta"), 1.2)],
              legenda="Filtre aprovados, recusados e pendentes."),
        Passo("Viu que não abriu? Manda de novo pelo WhatsApp, com um toque.",
              [clicar(lambda p: p.locator("main a").filter(has_text="Camila Nogueira").first, 1.6), focar(B("Enviar pelo WhatsApp"))],
              legenda="Não abriu? Reenvie com um toque."),
    ],
    chamada="Nenhum orçamento *esquecido*.",
    chamada_sub="Orçamento por link, com aviso de quem abriu.",
)

R15 = Reel(
    numero=15, slug="a-oficina-inteira",
    gancho_sobre="OficinaOS", gancho="Sua oficina *inteira* no celular.",
    gancho_fala="Sua oficina inteira, na palma da mão.",
    topo="", inicio="/",
    passos=[
        Passo("O pátio na primeira tela.", [focar(grupo("Na oficina", "Agendados hoje"))]),
        Passo("As ordens de serviço, por etapa.", [focar(None), ir_a("/ordens"), pausa(0.6)]),
        Passo("A agenda.", [ir_a("/agenda"), pausa(0.6)]),
        Passo("E o estoque, com o que está acabando.", [ir_a("/pecas"), pausa(0.6)]),
    ],
    chamada="A partir de *R$ 149* por mês.",
    chamada_sub="14 dias grátis no plano completo. Sem cartão, sem fidelidade.",
)

REELS = {r.numero: r for r in [R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, R11, R12, R13, R14, R15]}


def recriar_demo():
    subprocess.run("npm run db:seed:demo -- --reset --seed", shell=True, cwd=REPO, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    pedidos = sorted(REELS) if sys.argv[1:] == ["todos"] else [int(x) for x in sys.argv[1:]]
    falhas = []
    for n in pedidos:
        t = time.time()
        print(f"--- reel {n}: {REELS[n].slug}", flush=True)
        try:
            recriar_demo()
            rodar(REELS[n])
            print(f"    ok em {time.time() - t:.0f}s", flush=True)
        except Exception as e:
            falhas.append((n, repr(e)[:200]))
            print("    FALHOU: " + " | ".join(str(e).splitlines())[:2500], flush=True)
    print("FALHAS:", falhas if falhas else "nenhuma")
