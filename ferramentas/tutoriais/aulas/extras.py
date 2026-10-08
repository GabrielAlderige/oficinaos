"""Aulas 25 a 30: as funções que o curso original não cobria.

Pacotes de serviço, a lista de orçamentos, as recomendações de pedido, importar
planilha, as automações e o plano. Usam os mesmos atalhos de `curso.py`.
"""
import asyncio, os, re, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "motor"))
from motor import Aula, Passo, cartao, clicar, digitar, focar, ir, rolar, selecionar

DADOS = os.path.join(os.path.dirname(__file__), "dados")


# ------------------------------------------------------------------ atalhos (os de curso.py, sem importar em ciclo)

def B(nome, exato=True):
    return lambda p: p.get_by_role("button", name=nome, exact=exato).first


def BR(padrao):
    return lambda p: p.get_by_role("button", name=re.compile(padrao)).first


def DB(nome):
    return lambda p: p.get_by_role("dialog").get_by_role("button", name=nome, exact=True).first


def DBR(padrao):
    return lambda p: p.get_by_role("dialog").get_by_role("button", name=re.compile(padrao)).first


def DTAB(nome):
    return lambda p: p.get_by_role("dialog").get_by_role("tab", name=nome, exact=True).first


def DL(rotulo):
    return lambda p: p.get_by_role("dialog").get_by_label(rotulo, exact=True).first


def LBL(rotulo):
    return lambda p: p.get_by_label(rotulo, exact=True).first


def TX(texto, exato=False):
    return lambda p: p.locator("main").get_by_text(texto, exact=exato).first


def DTX(texto):
    return lambda p: p.get_by_role("dialog").get_by_text(texto).first


def LINHA(texto):
    """A linha (link) da lista que tem `texto`."""
    return lambda p: p.locator("main a").filter(has_text=texto).first


def CARTAO_DO_TEXTO(texto):
    return lambda p: p.get_by_text(texto).first.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")


def anexar(seletor, arquivo):
    """Escolhe o arquivo no campo de upload (o seletor de arquivos do sistema não aparece no vídeo)."""
    async def f(g):
        await g.p.locator(seletor).first.set_input_files(arquivo)
        await asyncio.sleep(0.8)
    return f


def liberar_area_de_transferencia():
    """O 'Copiar lista' usa a área de transferência; no navegador da gravação ela precisa de permissão."""
    async def f(g):
        await g.p.context.grant_permissions(["clipboard-read", "clipboard-write"])
    return f


# ------------------------------------------------------------------ as aulas

A25 = Aula(
    slug="pacotes-de-servico", numero=25, modulo="Primeiros passos",
    titulo="Pacotes de serviço",
    subtitulo="O que a oficina vende junto entra na OS com um toque.",
    abertura_fala="Nesta aula, você vai montar um pacote de serviço e usar ele numa ordem de serviço, com um toque.",
    inicio="/servicos/pacotes",
    passos=[
        Passo("Pacote é o que a oficina vende junto, como a revisão com a troca dos filtros. Monte uma vez, e na OS ele entra com um toque.",
              [focar(TX("Nenhum pacote cadastrado"))],
              legenda="Pacote: o que a oficina vende junto, montado uma vez só."),
        Passo("Toque em Novo pacote.",
              [focar(None), clicar(B("Novo pacote"))]),
        Passo("Dê um nome que o cliente entenda e, se quiser, uma descrição curta.",
              [digitar(DL("Nome do pacote"), "Revisão dos 10.000 km"),
               digitar(DL("Descrição"), "Revisão completa com troca dos filtros de óleo e de ar.")]),
        Passo("Agora escolha o que entra. Nos serviços, toque em Revisão completa.",
              [clicar(DBR("^Revisão completa"))]),
        Passo("Nas peças, o filtro de óleo e o filtro de ar.",
              [clicar(DTAB("Peças")), clicar(DBR("^Filtro de óleo")), clicar(DBR("^Filtro de ar"))]),
        Passo("O sistema soma na hora: hoje o pacote sai por quatrocentos e noventa reais. O preço é sempre o do catálogo no dia em que você usa.",
              [focar(DTX("Hoje o pacote sai por"))],
              legenda="Hoje o pacote sai por R$ 490,00, pelo preço do catálogo."),
        Passo("Toque em Criar pacote.",
              [focar(None), clicar(DB("Criar pacote"), 1.4), focar(TX("Revisão dos 10.000 km"))]),
        Passo("Para usar, abra uma ordem de serviço e toque em Adicionar.",
              [focar(None),
               clicar(lambda p: p.locator("aside, nav").get_by_role("link", name="Ordens de serviço", exact=True).first, 1.4),
               clicar(lambda p: p.locator("main a").filter(has_text="Diego Fontes").filter(has_text="Hyundai").first, 1.6),
               clicar(BR("^Adicionar$"))]),
        Passo("Na aba Pacotes, toque no pacote.",
              [clicar(DTAB("Pacotes")), clicar(DBR("^Revisão dos 10"), 1.6)]),
        Passo("Os três itens entram de uma vez, como linhas normais. Dá para mudar a quantidade, o preço ou apagar o que não foi usado.",
              [focar(TX("Filtro de ar", True))],
              legenda="Os itens entram como linhas normais: tudo continua editável."),
    ],
    encerramento_titulo="Seus pacotes estão prontos.",
    encerramento_fala="Pronto! Agora a revisão entra na OS com um toque. Na próxima aula: acompanhar os orçamentos enviados.",
    proxima="Acompanhando os orçamentos",
)

A26 = Aula(
    slug="acompanhando-os-orcamentos", numero=26, modulo="Orçamento e aprovação",
    titulo="Acompanhando os orçamentos",
    subtitulo="Quem recebeu o link, quem abriu e quem ainda não respondeu.",
    abertura_fala="Nesta aula, você vai acompanhar todos os orçamentos enviados, numa tela só.",
    inicio="/orcamentos",
    passos=[
        Passo("Em Orçamentos ficam todos os orçamentos que saíram da oficina: quem recebeu o link, quem abriu e quem ainda não respondeu.",
              [focar(LINHA("Camila Nogueira"))],
              legenda="Orçamentos: quem recebeu, quem abriu e quem não respondeu."),
        Passo("Cada linha mostra se o cliente já abriu o link e até quando o orçamento vale.",
              [focar(TX("ainda não abriu"))]),
        Passo("Os botões de cima filtram pela situação. Veja os recusados.",
              [focar(None), clicar(B("Recusado"), 1.2)]),
        Passo("Recusado não é o fim da conversa: abra a OS, ajuste os itens e mande um orçamento novo.",
              [focar(LINHA("Eduarda Lima"))]),
        Passo("Volte para os que esperam resposta, e toque num deles.",
              [focar(None), clicar(B("Aguardando resposta"), 1.0), clicar(LINHA("Camila Nogueira"), 1.6)]),
        Passo("Você cai direto na OS. Se o cliente respondeu por telefone, registre a resposta aqui. Ou mande o link de novo pelo WhatsApp.",
              [focar(B("Registrar resposta"))],
              legenda="Respondeu por telefone? Registre aqui. Ou reenvie pelo WhatsApp."),
    ],
    encerramento_titulo="Nenhum orçamento esquecido.",
    encerramento_fala="Pronto! Agora você sabe onde está cada orçamento. Na próxima aula: o que comprar antes de faltar.",
    proxima="O que comprar antes de faltar",
)

A27 = Aula(
    slug="o-que-comprar", numero=27, modulo="Peças, estoque e compras",
    titulo="O que comprar antes de faltar",
    subtitulo="A lista de reposição, pronta para mandar ao fornecedor.",
    abertura_fala="Nesta aula, você vai ver o que repor no estoque e mandar a lista para o fornecedor.",
    inicio="/pecas/recomendacoes",
    passos=[
        Passo("Em Peças e estoque, a aba Recomendações de pedido mostra o que repor antes de faltar.",
              [focar(TX("Acabando no estoque"))]),
        Passo("Cada peça mostra quanto está abaixo do mínimo e quanto custou na última compra.",
              [focar(TX("Amortecedor dianteiro"))],
              legenda="Quanto falta para o mínimo, e o último custo."),
        Passo("Toque em Copiar lista. Ela vai pronta, com as quantidades, para colar no WhatsApp do fornecedor.",
              [focar(None), liberar_area_de_transferencia(), clicar(B("Copiar lista"), 1.4)]),
        Passo("Quando a peça chegar, abra a ficha dela.",
              [clicar(lambda p: p.locator("main").get_by_role("link", name="Amortecedor dianteiro").first, 1.6)]),
        Passo("E toque em Entrada, para registrar a quantidade e o valor pago. É isso que mantém o custo médio e o preço sugerido certos.",
              [focar(B("Entrada"))],
              legenda="Entrada: quantidade e valor pago, para o custo médio ficar certo."),
    ],
    encerramento_titulo="Estoque sem surpresa.",
    encerramento_fala="Pronto! Agora você compra antes de faltar. Na próxima aula: trazer os seus clientes de uma planilha.",
    proxima="Importar sua planilha",
)

A28 = Aula(
    slug="importar-planilha", numero=28, modulo="Configurações e equipe",
    titulo="Importar sua planilha",
    subtitulo="Clientes, veículos e peças de outro sistema, de uma vez.",
    abertura_fala="Nesta aula, você vai trazer os seus clientes de uma planilha, sem digitar um por um.",
    inicio="/configuracoes/importar",
    passos=[
        Passo("Se a oficina já tem os clientes numa planilha ou em outro sistema, dá para trazer tudo de uma vez, em Configurações, Importar.",
              [focar(TX("Importar planilha", True))]),
        Passo("Escolha o que vai importar: clientes, veículos ou peças. Aqui, clientes.",
              [clicar(B("Clientes"))]),
        Passo("A tela mostra as colunas que a planilha precisa ter. Só o nome é obrigatório, e o cabeçalho pode ser com ou sem acento.",
              [focar(TX("Colunas obrigatórias"))],
              legenda="Só o nome é obrigatório."),
        Passo("No Excel, salve a planilha como CSV e escolha o arquivo.",
              [focar(None), anexar("main input[type=file]", os.path.join(DADOS, "clientes-exemplo.csv"))],
              legenda="No Excel: Salvar como → CSV."),
        Passo("Toque em Conferir. Nada é gravado ainda: o sistema mostra como entendeu cada linha.",
              [clicar(B("Conferir"), 2.0)]),
        Passo("Quatro clientes novos e nenhum recusado. Se uma linha tiver problema, ela aparece aqui, com o motivo.",
              [focar(TX("Conferência (nada foi gravado)"))],
              legenda="Conferência: 4 novos, 0 recusados. Nada foi gravado ainda."),
        Passo("Estando tudo certo, toque em Importar de verdade.",
              [focar(None), clicar(B("Importar de verdade"), 2.0)]),
        Passo("Pronto: os clientes já estão na lista, com o WhatsApp e o e-mail.",
              [ir("/clientes"), focar(TX("Roberto Antunes"))]),
    ],
    encerramento_titulo="Seus clientes já estão no sistema.",
    encerramento_fala="Pronto! Seus clientes chegaram sem digitar nada. Na próxima aula: o que o sistema faz sozinho.",
    proxima="Automações",
)

A29 = Aula(
    slug="automacoes", numero=29, modulo="Configurações e equipe",
    titulo="Automações",
    subtitulo="O que o sistema faz sozinho, todo dia.",
    abertura_fala="Nesta aula, você vai ver o que o OficinaOS faz sozinho todo dia, e escolher o horário.",
    inicio="/configuracoes/automacoes",
    passos=[
        Passo("Em Configurações, Automações, fica o que o sistema faz sozinho. Nenhuma automação manda mensagem para o cliente: ela deixa tudo pronto, e quem envia é você.",
              [focar(cartao("O que o sistema faz sozinho"))],
              legenda="As automações deixam tudo pronto. Quem envia é você."),
        Passo("Toda manhã, a fila de pós-venda: quem contatar hoje, quem está com a revisão vencendo e quem sumiu há seis meses.",
              [focar(TX("Fila de pós-venda"))]),
        Passo("O lembrete de agendamento avisa no sino quem ainda não confirmou o horário de amanhã.",
              [focar(TX("Lembrete de agendamento"))]),
        Passo("O aviso de orçamento sem resposta lembra você de cobrar o cliente.",
              [focar(TX("Orçamento sem resposta"))]),
        Passo("E o resumo do dia chega por e-mail, com o que precisa de atenção.",
              [focar(TX("Resumo do dia por e-mail"))]),
        Passo("Em Quando e como, escolha a hora em que tudo roda: aqui, às sete da manhã, antes de abrir a oficina.",
              [focar(None), selecionar(LBL("Hora de rodar"), "07:00"), focar(LBL("Hora de rodar"))],
              legenda="Hora de rodar: 07:00, antes de abrir a oficina."),
        Passo("Quer ver funcionando agora? Toque em Rodar agora, na fila de pós-venda.",
              [focar(None), clicar(B("Rodar agora"), 2.0)]),
    ],
    encerramento_titulo="O sistema trabalha enquanto você dorme.",
    encerramento_fala="Pronto! Agora o sistema prepara o seu dia sozinho. Na próxima aula: o seu plano e como pagar.",
    proxima="Seu plano e o pagamento",
)

A30 = Aula(
    slug="plano-e-pagamento", numero=30, modulo="Configurações e equipe",
    titulo="Seu plano e o pagamento",
    subtitulo="O teste grátis, os planos, como pagar e como cancelar.",
    abertura_fala="Nesta aula, você vai ver o seu plano, como assinar e como funciona o pagamento.",
    inicio="/configuracoes/plano",
    passos=[
        Passo("Em Configurações, Plano, você vê o plano atual e até quando vai o teste grátis.",
              [focar(CARTAO_DO_TEXTO("O teste vai até"))]),
        Passo("Toda oficina começa com catorze dias no Nitro, o plano completo, sem cartão. Assim você conhece tudo antes de escolher.",
              [focar(TX("Em teste"))],
              legenda="14 dias grátis no Nitro, o plano completo, sem cartão."),
        Passo("Aqui estão os três planos, e o que cada um inclui.",
              [focar(CARTAO_DO_TEXTO("Trocar de plano vale na hora"))]),
        Passo("No anual, você paga dez meses e usa doze.",
              [focar(None), clicar(B("Anual"), 1.2), focar(CARTAO_DO_TEXTO("Trocar de plano vale na hora"))],
              legenda="Anual: paga 10 meses, usa 12."),
        Passo("Para assinar, toque em Assinar no plano que escolher. Abre a fatura, e você paga por Pix, boleto ou cartão. O plano ativa sozinho quando o pagamento cai.",
              [focar(B("Assinar"))],
              legenda="Assinar → fatura → Pix, boleto ou cartão. Ativa sozinho."),
        Passo("Se um dia atrasar, são sete dias de folga. Depois disso o sistema fica só para leitura: você continua vendo tudo, mas não lança nada novo até pagar.",
              [focar(None)],
              legenda="Atrasou: 7 dias de folga. Depois, só leitura até pagar."),
        Passo("E dá para cancelar quando quiser, aqui embaixo, sem multa. A oficina usa até o fim do que já pagou.",
              [rolar(CARTAO_DO_TEXTO("Ao cancelar, a oficina continua")), focar(CARTAO_DO_TEXTO("Ao cancelar, a oficina continua"))]),
    ],
    encerramento_titulo="Você concluiu o curso do OficinaOS.",
    encerramento_fala="Pronto! Você terminou o curso. Qualquer dúvida, chame no WhatsApp. Bom trabalho na oficina!",
    proxima=None,
)

EXTRAS = [A25, A26, A27, A28, A29, A30]
