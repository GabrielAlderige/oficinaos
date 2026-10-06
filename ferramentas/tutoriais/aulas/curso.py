"""As 24 aulas do curso de tutoriais do OficinaOS.

Rodar:  python aulas/curso.py 3 5 7     (grava as aulas pedidas)
        python aulas/curso.py todas
Antes de cada aula a demo é recriada (npm run db:seed:demo -- --reset --seed).
"""
import os, re, subprocess, sys, time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "motor"))
from motor import (Aula, Passo, arrastar, mover, assinar, cartao, celular_app, celular_chat, celular_url, clicar, digitar,
                   escrever, fechar_celular, focar, grupo, guardar, marcar, no_celular, pausa, rodar, rolar, rolar_topo,
                   selecionar, tecla)
from a08_orcamento_link import AULA as A08

REPO = r"C:\Users\galby\Projetos\oficinaos"
PSQL = r"C:\Program Files\PostgreSQL\17\bin\psql.exe"
CHAVE_PIX = "be7a29c4-5c81-4135-9757-e2910d18739f"  # aleatória, de nenhuma conta: o QR do vídeo não paga ninguém


# ------------------------------------------------------------------ atalhos de localização

def B(nome, exato=True):
    return lambda p: p.get_by_role("button", name=nome, exact=exato).first


def BR(padrao):
    return lambda p: p.get_by_role("button", name=re.compile(padrao)).first


def DB(nome):
    """Botão dentro do diálogo aberto."""
    return lambda p: p.get_by_role("dialog").get_by_role("button", name=nome, exact=True).first


def DL(rotulo):
    return lambda p: p.get_by_role("dialog").get_by_label(rotulo, exact=True).first


def LBL(rotulo):
    return lambda p: p.get_by_label(rotulo, exact=True).first


def PH(texto, no_dialogo=False):
    def alvo(p):
        base = p.get_by_role("dialog") if no_dialogo else p
        return base.get_by_placeholder(re.compile(re.escape(texto))).first
    return alvo


def TX(texto, exato=False):
    return lambda p: p.locator("main").get_by_text(texto, exact=exato).first


def LINK(nome):
    return lambda p: p.get_by_role("link", name=nome, exact=True).first


def MENU(nome):
    return lambda p: p.locator("aside, nav").get_by_role("link", name=nome, exact=True).first


def CARTAO_DO_TEXTO(texto):
    return lambda p: p.get_by_text(texto).first.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")


def H1(p):
    return p.get_by_role("heading", level=1).first


def linha(texto, botao):
    """O botão `botao` da linha que tem `texto` (ex.: o 'Problema' do item 'Pneus e estepe')."""
    def alvo(p):
        return (p.get_by_role("dialog").locator("div").filter(has_text=texto)
                .filter(has=p.get_by_role("button", name=botao, exact=True)).last
                .get_by_role("button", name=botao, exact=True).first)
    return alvo


def opcao(texto, nome):
    """O botão de opção `nome` da linha do checklist que tem `texto`."""
    def alvo(p):
        radio = p.get_by_role("radio", name=nome, exact=True)
        return (p.get_by_role("dialog").locator("div").filter(has_text=texto).filter(has=radio).last
                .get_by_role("radio", name=nome, exact=True).first)
    return alvo


ABRIR_JANELA = "() => { window.open = (u) => { window.__wa = u; return null }; return true }"
TEXTO_WA = "() => new URL(window.__wa).searchParams.get('text')"


def wa_texto(g):
    return g.dados["wa"].replace("http://localhost:5173", "https://app.oficinaosbr.com")


# ------------------------------------------------------------------ preparo (fora da gravação)

def sql_demo(comando):
    """Roda SQL no banco de desenvolvimento, no contexto da oficina demo (o RLS é forçado)."""
    url = next(l.split("=", 1)[1].strip() for l in open(os.path.join(REPO, ".env"), encoding="utf-8")
               if l.startswith("DATABASE_OWNER_URL="))
    # pelo driver `pg` do próprio projeto, em Node: o Smart App Control do Windows bloqueia o psql.exe
    js = """
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.OOS_URL });
  await c.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.user_id', (select id::text from users where email = 'demo@oficinaos.dev'), true)");
    await c.query("select set_config('app.org_id', (select organization_id::text from memberships limit 1), true)");
    await c.query(process.env.OOS_SQL);
    await c.query('commit');
  } catch (e) { await c.query('rollback'); console.error(e.message); process.exitCode = 1; }
  finally { await c.end(); }
})();
"""
    subprocess.run(["node", "-e", js], cwd=REPO, check=True, env={**os.environ, "OOS_URL": url, "OOS_SQL": comando})


async def prep_pix(pg):
    await pg.goto("http://localhost:5173/configuracoes/oficina")
    campo = pg.get_by_label("Chave Pix")
    await campo.wait_for()
    await campo.fill(CHAVE_PIX)
    await campo.press("Tab")
    await pg.get_by_text("Chave Pix salva.").wait_for(timeout=8000)


async def prep_posvenda(pg):
    sql_demo("update work_orders set delivered_at = delivered_at - interval '8 days' where status = 'DELIVERED';")
    await pg.goto("http://localhost:5173/configuracoes/automacoes")
    await pg.get_by_role("button", name="Rodar agora").first.click()
    await pg.wait_for_timeout(2500)


# ------------------------------------------------------------------ as aulas

A01 = Aula(
    slug="conhecendo-o-oficinaos", numero=1, modulo="Primeiros passos",
    titulo="Conhecendo o OficinaOS",
    subtitulo="Onde fica cada coisa e o que olhar quando você abre o sistema de manhã.",
    abertura_fala="Nesta aula, você vai conhecer o OficinaOS: onde fica cada coisa e o que olhar quando abre o sistema de manhã.",
    inicio="/",
    passos=[
        Passo("Esta é a tela de início. Aqui em cima está o que acontece agora na oficina: os carros no pátio, os orçamentos esperando aprovação, os carros prontos para entregar e os agendamentos de hoje.",
              [focar(grupo("Na oficina", "Agendados hoje"))],
              legenda="Agora na oficina: pátio, aprovações, prontos e agendados de hoje."),
        Passo("Logo abaixo, o dinheiro do mês: quanto a oficina faturou e quanto de fato entrou no caixa. Faturar não é receber.",
              [focar(grupo("Faturado", "Recebido"))]),
        Passo("Do lado direito fica a lista de Atenção necessária: orçamento que o cliente nem abriu, carro pronto esperando, peça acabando. É a sua lista de tarefas do dia.",
              [focar(cartao("Atenção necessária"))],
              legenda="Atenção necessária: a lista de tarefas do dia."),
        Passo("No menu da esquerda ficam as partes do sistema, na ordem do dia de trabalho: a agenda, as ordens de serviço e os orçamentos; os clientes e os veículos; os serviços e as peças; e o dinheiro.",
              [focar(lambda p: p.locator("aside").first)],
              legenda="O menu segue o dia de trabalho: agenda, OS, clientes, catálogo e dinheiro."),
        Passo("Para achar qualquer coisa, use a busca aqui em cima, ou aperte Control K. Serve placa, nome ou telefone.",
              [focar(None), clicar(BR("^Buscar placa")), escrever("DEM1A05"), pausa(0.8)],
              legenda="Busca: placa, nome ou telefone. Atalho: Ctrl + K."),
        Passo("Toque no resultado e você vai direto para a ficha do carro.",
              [clicar(lambda p: p.get_by_role("dialog").get_by_text("Toyota Corolla").first, 1.2)]),
    ],
    encerramento_titulo="Você já sabe se achar no OficinaOS.",
    encerramento_fala="Pronto! Agora você já sabe se localizar. Na próxima aula: cadastrar os seus serviços e preços.",
    proxima="Cadastrando seus serviços e preços",
)

A02 = Aula(
    slug="servicos-e-precos", numero=2, modulo="Primeiros passos",
    titulo="Cadastrando seus serviços e preços",
    subtitulo="O catálogo de mão de obra que o orçamento usa.",
    abertura_fala="Nesta aula, você vai cadastrar um serviço, com preço e tempo, para ele entrar no orçamento com um toque.",
    inicio="/servicos",
    passos=[
        Passo("Os serviços são o catálogo de mão de obra da oficina. Cada um tem o preço e o tempo, e é daqui que o orçamento puxa os valores.",
              [focar(CARTAO_DO_TEXTO("Alinhamento e balanceamento"))]),
        Passo("Para cadastrar um novo, toque em Novo serviço.",
              [focar(None), clicar(B("Novo serviço"))]),
        Passo("Dê um nome que o cliente entenda, e uma categoria.",
              [digitar(DL("Nome do serviço"), "Troca de fluido de freio"), digitar(DL("Categoria"), "Freios")]),
        Passo("Aqui o preço é fixo: cento e dez reais, em quarenta e cinco minutos. Se fosse por hora técnica, o sistema multiplicaria o valor da hora pelo tempo.",
              [digitar(DL("Preço"), "110,00"), digitar(DL("Tempo padrão (horas, opcional)"), "0,75")],
              legenda="Preço fixo: R$ 110,00, em 45 minutos (0,75 h)."),
        Passo("Se o serviço tem intervalo de manutenção, informe. O sistema usa isso para lembrar o cliente da próxima troca.",
              [clicar(lambda p: p.get_by_role("dialog").get_by_text("Intervalo de manutenção").first, 0.6),
               digitar(PH("12", True), "24")],
              legenda="Intervalo de manutenção: o sistema lembra o cliente da próxima troca."),
        Passo("Toque em Cadastrar serviço. Pronto: ele já está na lista, pronto para entrar no orçamento.",
              [clicar(DB("Cadastrar serviço"), 1.4), focar(TX("Troca de fluido de freio"))]),
    ],
    encerramento_titulo="Seu catálogo de serviços está pronto.",
    encerramento_fala="Pronto! Seus serviços já estão no sistema. Na próxima aula: cadastrar cliente e carro em um minuto.",
    proxima="Cliente e carro em um minuto",
)

A03 = Aula(
    slug="cliente-e-carro", numero=3, modulo="Clientes e veículos",
    titulo="Cliente e carro em um minuto",
    subtitulo="Só o nome é obrigatório. O resto, você completa quando precisar.",
    abertura_fala="Nesta aula, você vai cadastrar um cliente e o carro dele, em menos de um minuto.",
    inicio="/clientes",
    passos=[
        Passo("Para cadastrar um cliente, toque em Novo cliente. Só o nome é obrigatório.",
              [clicar(B("Novo cliente"))]),
        Passo("Preencha o nome e o WhatsApp: é por ele que vão o orçamento e o aviso de carro pronto.",
              [digitar(DL("Nome"), "Ricardo Almeida"), digitar(DL("WhatsApp"), "(11) 90000-0091")]),
        Passo("Pergunte se ele aceita receber lembretes de revisão pelo WhatsApp. Sem esse aceite, a oficina só fala do serviço em andamento, como pede a LGPD.",
              [marcar(lambda p: p.get_by_role("dialog").get_by_role("checkbox").last)],
              legenda="Lembrete de revisão só com o aceite do cliente (LGPD)."),
        Passo("Toque em Cadastrar cliente. A ficha dele abre na hora.",
              [clicar(DB("Cadastrar cliente"), 1.6)]),
        Passo("Agora o carro: toque em Adicionar veículo.",
              [clicar(B("Adicionar veículo"))]),
        Passo("Digite a placa. O sistema aceita a antiga e a Mercosul, e avisa se ela já estiver cadastrada.",
              [digitar(DL("Placa"), "DEM2B45")]),
        Passo("Depois a marca, o modelo, o ano e a quilometragem.",
              [digitar(DL("Marca"), "Volkswagen"), digitar(DL("Modelo"), "Polo"),
               digitar(DL("Ano fabricação"), "2020"), digitar(DL("Quilometragem"), "48500")]),
        Passo("Toque em Cadastrar veículo. Pronto: cliente e carro no sistema.",
              [clicar(DB("Cadastrar veículo"), 1.4), focar(cartao("Veículos"))]),
    ],
    encerramento_titulo="Cliente e carro cadastrados.",
    encerramento_fala="Pronto! Na próxima aula: achar qualquer cliente ou carro pela placa.",
    proxima="Achando tudo pela placa",
)

A04 = Aula(
    slug="achando-pela-placa", numero=4, modulo="Clientes e veículos",
    titulo="Achando tudo pela placa",
    subtitulo="A busca rápida e o histórico de cada carro.",
    abertura_fala="Nesta aula, você vai achar um carro pela placa e ver todo o histórico dele.",
    inicio="/",
    passos=[
        Passo("Cliente chegou e você só sabe a placa? Toque na busca, ou aperte Control K.",
              [clicar(BR("^Buscar placa"))]),
        Passo("Digite a placa, ou só um pedaço dela. Também serve o nome ou o telefone.",
              [escrever("DEM1A01"), pausa(0.6)]),
        Passo("Toque no carro.",
              [clicar(lambda p: p.get_by_role("dialog").get_by_text("Volkswagen Gol").first, 1.4)]),
        Passo("Na ficha do carro está tudo: os dados, o dono, a quilometragem e o histórico de cada visita, com os serviços e as peças trocadas.",
              [focar(cartao("Histórico de serviços"))],
              legenda="Histórico do carro: cada visita, com serviços, peças e km."),
        Passo("Toque numa visita para abrir a ordem de serviço dela.",
              [focar(None), clicar(lambda p: p.locator("main a[href^='/ordens/']").first, 1.5)]),
    ],
    encerramento_titulo="Qualquer carro em segundos.",
    encerramento_fala="Pronto! Na próxima aula: marcar e remarcar serviços na agenda.",
    proxima="Marcar e remarcar na agenda",
)

A05 = Aula(
    slug="agenda", numero=5, modulo="Agenda",
    titulo="Marcar e remarcar na agenda",
    subtitulo="Cada mecânico com a sua coluna, e remarcar é arrastar.",
    abertura_fala="Nesta aula, você vai marcar um serviço na agenda e remarcar arrastando.",
    inicio="/agenda",
    passos=[
        Passo("A agenda mostra o dia, a semana ou o mês, com cada serviço no horário e a cor do mecânico.",
              [clicar(B("Semana"), 1.0), clicar(B("Dia"), 1.0)]),
        Passo("Para marcar, toque em Agendar.",
              [clicar(B("Agendar"))]),
        Passo("Escolha o cliente: dá para buscar pelo nome ou pela placa.",
              [digitar(PH("Nome, telefone ou placa", True), "Gabriela"),
               clicar(lambda p: p.get_by_role("dialog").get_by_role("button", name=re.compile("^Gabriela Prado")).first)]),
        Passo("Depois o carro e o serviço.",
              [selecionar(DL("Veículo"), "DEM1A07"), selecionar(DL("Serviço"), "Troca de pastilhas de freio")]),
        Passo("E quem vai fazer. Se o horário bater com outro serviço do mesmo mecânico, o sistema avisa.",
              [selecionar(DL("Mecânico"), "Diego Rocha")]),
        Passo("Toque em Agendar. Pronto, está na agenda.",
              [clicar(DB("Agendar"), 1.5)]),
        Passo("Precisou remarcar? É só arrastar o serviço para outro horário.",
              [arrastar(lambda p: p.get_by_role("button", name=re.compile("^Troca de óleo e filtro")).first, 0, 130)]),
    ],
    encerramento_titulo="Agenda organizada, sem caderno.",
    encerramento_fala="Pronto! Na próxima aula: abrir a ordem de serviço pela placa, quando o carro chega.",
    proxima="Abrindo a OS pela placa",
)

A06 = Aula(
    slug="abrindo-a-os", numero=6, modulo="Ordem de serviço",
    titulo="Abrindo a OS pela placa",
    subtitulo="Cliente e carro vêm preenchidos. O orçamento sai daí.",
    abertura_fala="Nesta aula, você vai abrir uma ordem de serviço em poucos toques, começando pela placa.",
    inicio="/ordens",
    passos=[
        Passo("Quando o carro chega, abra a ordem de serviço. Toque em Nova OS.",
              [clicar(LINK("Nova OS"), 1.0)]),
        Passo("Comece pela placa ou pelo nome do cliente.",
              [digitar(PH("Nome, telefone ou placa"), "DEM1A06"),
               clicar(BR("^Fábio Marques"))]),
        Passo("O sistema já traz os carros desse cliente. Escolha o que chegou.",
              [clicar(BR("Renault Sandero"))]),
        Passo("Anote o que o cliente relatou, com as palavras dele, e a quilometragem do painel.",
              [digitar(LBL("Relato"), "Barulho na suspensão ao passar em lombada"), digitar(LBL("Quilometragem"), "65120")],
              legenda="O relato do cliente, com as palavras dele, e a km do painel."),
        Passo("Os serviços e as peças são opcionais agora: dá para abrir a OS e orçar depois do diagnóstico. Toque em Abrir OS.",
              [clicar(B("Abrir OS"), 1.6)],
              legenda="Itens são opcionais: dá para orçar depois do diagnóstico."),
        Passo("Pronto: a OS está aberta, com o número, o cliente e o carro. Daqui saem o check-in, o orçamento e a entrega.",
              [focar(H1)]),
    ],
    encerramento_titulo="OS aberta em segundos.",
    encerramento_fala="Pronto! Na próxima aula: o check-in, com quilometragem, checklist e fotos.",
    proxima="Check-in com fotos e quilometragem",
)

A07 = Aula(
    slug="check-in", numero=7, modulo="Ordem de serviço",
    titulo="Check-in com fotos e quilometragem",
    subtitulo="Registra como o carro chegou. Protege a oficina.",
    abertura_fala="Nesta aula, você vai fazer o check-in do carro: quilometragem, combustível, checklist e avarias.",
    inicio="/ordens/18",
    passos=[
        Passo("Antes de mexer no carro, faça o check-in. Ele registra como o carro chegou, e protege a oficina.",
              [clicar(B("Check-in"))]),
        Passo("Informe a quilometragem do painel e o nível de combustível.",
              [digitar(DL("Quilometragem de entrada"), "44320"), selecionar(DL("Combustível"), "1/2")]),
        Passo("No checklist, marque o que está ok e o que tem problema. Aqui, os pneus estão gastos.",
              [marcar(opcao("Faróis e lanternas", "Ok")), marcar(opcao("Pneus e estepe", "Problema"))]),
        Passo("Achou um risco ou um amassado? Escolha o local e o tipo, e adicione a avaria.",
              [selecionar(DL("Local"), "Para-choque traseiro"), selecionar(DL("Tipo"), "Risco"),
               clicar(DB("Adicionar avaria"))]),
        Passo("Confira os acessórios que ficaram no carro. Pelo celular, dá para tirar fotos, que ficam guardadas na OS.",
              [clicar(DB("Estepe")), clicar(DB("Macaco")), clicar(DB("Documento do veículo"))],
              legenda="Acessórios conferidos. No celular, as fotos ficam guardadas na OS."),
        Passo("Toque em Registrar check-in. Se o cliente disser que o risco não estava lá, está tudo registrado, com data e hora.",
              [clicar(DB("Registrar check-in"), 1.6), clicar(B("Histórico"), 1.0)],
              legenda="Check-in registrado, com data e hora."),
    ],
    encerramento_titulo="O carro entrou documentado.",
    encerramento_fala="Pronto! Na próxima aula: mandar o orçamento por link, para o cliente aprovar pelo celular.",
    proxima="Orçamento por link: o cliente aprova pelo celular",
)

A09 = Aula(
    slug="executar-e-avisar", numero=9, modulo="Ordem de serviço",
    titulo="Executar o serviço e avisar que ficou pronto",
    subtitulo="Cronômetro, finalização e o aviso com a mensagem pronta.",
    abertura_fala="Nesta aula, você vai executar o serviço, finalizar a OS e avisar o cliente que o carro ficou pronto.",
    inicio="/ordens/11",
    passos=[
        Passo("Com o orçamento aprovado, é hora de trabalhar. Toque em Iniciar execução.",
              [clicar(B("Iniciar execução"), 1.2)]),
        Passo("Cada serviço tem um cronômetro: o mecânico dá play quando começa, e o tempo real vai para os relatórios.",
              [clicar(BR("^Iniciar o cronômetro"), 1.0)],
              legenda="Cronômetro por serviço: o tempo real vai para os relatórios."),
        Passo("Faltou peça? Toque em Aguardando peça, e a OS fica sinalizada até a peça chegar.",
              [focar(B("Aguardando peça")), pausa(0.8), focar(None)]),
        Passo("Terminou o serviço? Toque em Finalizar serviço.",
              [clicar(B("Finalizar serviço"))]),
        Passo("O sistema confirma: as peças saem do estoque, e a OS vira conta a receber no financeiro.",
              [focar(lambda p: p.get_by_role("alertdialog")), pausa(0.6), focar(None),
               clicar(lambda p: p.get_by_role("alertdialog").get_by_role("button", name="Finalizar serviço"), 1.4)],
              legenda="Finalizar: as peças saem do estoque e a OS vira conta a receber."),
        Passo("Agora avise o cliente. Toque em Avisar que está pronto: a mensagem sai pronta no WhatsApp.",
              [guardar("_", ABRIR_JANELA), clicar(B("Avisar que está pronto")), guardar("wa", TEXTO_WA),
               celular_chat("Oficina Demonstração", wa_texto)]),
        Passo("O cliente recebe na hora, sabendo que pode buscar o carro.",
              [pausa(1.5), fechar_celular()]),
    ],
    encerramento_titulo="Serviço feito, cliente avisado.",
    encerramento_fala="Pronto! Na próxima aula: entregar o carro, com a assinatura do cliente na tela.",
    proxima="Entrega com assinatura do cliente",
)

A10 = Aula(
    slug="entrega-com-assinatura", numero=10, modulo="Ordem de serviço",
    titulo="Entrega com assinatura do cliente",
    subtitulo="Quem recebeu, a km de saída e a assinatura na tela.",
    abertura_fala="Nesta aula, você vai entregar o carro, com quem recebeu, a quilometragem de saída e a assinatura do cliente.",
    inicio="/ordens/6",
    passos=[
        Passo("O cliente chegou para buscar. Toque em Entregar veículo.",
              [clicar(B("Entregar veículo"))]),
        Passo("Anote quem recebeu, porque nem sempre é o dono, e a quilometragem de saída.",
              [digitar(DL("Quem recebeu"), "Fábio Marques"), digitar(DL("Km na saída"), "65012")]),
        Passo("Peça para o cliente assinar na tela, com o dedo. A assinatura fica guardada como comprovante.",
              [assinar(lambda p: p.get_by_role("dialog").locator("canvas").first)]),
        Passo("Se ainda falta receber, o sistema avisa, e a entrega fica registrada assim mesmo. Toque em Entregar veículo.",
              [focar(lambda p: p.get_by_role("dialog").get_by_text("Falta receber").first), pausa(0.8), focar(None),
               clicar(DB("Entregar veículo"), 1.6)],
              legenda="Falta receber? O sistema avisa, e a entrega fica registrada."),
        Passo("Pronto: entregue, com assinatura, data e hora. O que falta receber continua nas contas a receber.",
              [focar(H1)]),
    ],
    encerramento_titulo="Entrega com comprovante.",
    encerramento_fala="Pronto! Na próxima aula: receber com Pix na hora, com o QR na tela.",
    proxima="Recebendo com Pix na hora",
)

A11 = Aula(
    slug="pix-na-hora", numero=11, modulo="Dinheiro",
    titulo="Recebendo com Pix na hora",
    subtitulo="O QR com o valor certo, direto para a conta da oficina.",
    abertura_fala="Nesta aula, você vai receber o pagamento com Pix na hora, com o QR já com o valor certo.",
    inicio="/ordens/6",
    preparo=[prep_pix],
    passos=[
        Passo("Na hora de receber, abra a aba Dinheiro da OS.",
              [clicar(B("Dinheiro"), 1.0)]),
        Passo("Toque em Pix na hora.",
              [clicar(B("Pix na hora"), 1.2)]),
        Passo("O sistema gera o QR do Pix com o valor certo, direto para a conta da oficina. O cliente aponta a câmera e paga.",
              [focar(lambda p: p.get_by_role("dialog"))],
              legenda="O QR já sai com o valor certo, para a conta da oficina."),
        Passo("Também dá para copiar o código, ou mandar no WhatsApp do cliente.",
              [focar(None), focar(DB("Copiar código")), pausa(0.6), focar(None)]),
        Passo("O banco não avisa o sistema. Confira na sua conta e toque em Recebi, dar baixa.",
              [clicar(DB("Recebi, dar baixa"), 1.6)],
              legenda="Conferiu no banco? Toque em Recebi, dar baixa."),
        Passo("Pronto: o pagamento entrou no caixa, e a OS mostra que está paga.",
              [focar(CARTAO_DO_TEXTO("Recebido"))]),
    ],
    encerramento_titulo="Recebido, sem maquininha.",
    encerramento_fala="Pronto! Na próxima aula: cadastrar peças e controlar o estoque mínimo.",
    proxima="Peças e estoque mínimo",
)

A12 = Aula(
    slug="pecas-e-estoque", numero=12, modulo="Peças, estoque e compras",
    titulo="Peças e estoque mínimo",
    subtitulo="O que tem na prateleira, o que está acabando e o que cobrar.",
    abertura_fala="Nesta aula, você vai cadastrar uma peça e ver como o estoque avisa o que está acabando.",
    inicio="/pecas",
    passos=[
        Passo("Em Peças e estoque fica tudo o que está na prateleira, com a quantidade e o preço.",
              [focar(CARTAO_DO_TEXTO("Amortecedor dianteiro"))]),
        Passo("Os avisos aqui em cima mostram o que está abaixo do mínimo e o que acabou. Toque para filtrar.",
              [focar(None), clicar(BR("^Abaixo do mínimo"), 1.2)]),
        Passo("Para cadastrar uma peça, toque em Nova peça.",
              [clicar(B("Nova peça"))]),
        Passo("Nome, marca e o código do fabricante, que é o que você pede no balcão do fornecedor.",
              [digitar(DL("Nome da peça"), "Pastilha de freio traseira"), digitar(DL("Marca"), "Cobreq"),
               digitar(DL("Código do fabricante"), "N-1234")]),
        Passo("O preço de venda, quantas tem na prateleira, quanto custou, e o estoque mínimo.",
              [digitar(DL("Preço de venda"), "180,00"), digitar(DL("Quantidade na prateleira hoje"), "4"),
               digitar(DL("Custo unitário"), "95,00"), digitar(DL("Estoque mínimo"), "2")],
              legenda="Preço, quantidade, custo e estoque mínimo."),
        Passo("Toque em Cadastrar peça. Quando ela sair numa OS, o estoque baixa sozinho.",
              [clicar(DB("Cadastrar peça"), 1.4)]),
    ],
    encerramento_titulo="Estoque sob controle.",
    encerramento_fala="Pronto! Na próxima aula: pesquisar o preço da peça nos fornecedores.",
    proxima="Pesquisa de peças",
)

A13 = Aula(
    slug="pesquisa-de-pecas", numero=13, modulo="Peças, estoque e compras",
    titulo="Pesquisa de peças",
    subtitulo="Prateleira e fornecedores lado a lado, com o preço para cobrar.",
    abertura_fala="Nesta aula, você vai pesquisar uma peça e comparar a sua prateleira com os fornecedores.",
    inicio="/pesquisa-de-pecas",
    passos=[
        Passo("Antes de comprar, pesquise. O sistema compara o que você tem na prateleira com as listas de preço dos fornecedores.",
              [focar(PH("Pastilha de freio"))]),
        Passo("Digite a peça e toque em Pesquisar.",
              [focar(None), digitar(PH("Pastilha de freio"), "pastilha de freio dianteira"), clicar(B("Pesquisar"), 1.6)]),
        Passo("Os selos mostram o melhor preço, a entrega mais rápida e o melhor custo-benefício.",
              [focar(CARTAO_DO_TEXTO("Melhor preço"))]),
        Passo("E cada oferta já mostra quanto cobrar do cliente, com a margem da oficina.",
              [focar(lambda p: p.locator("main").get_by_text("cobrar").first)],
              legenda="O preço de venda já vem com a sua margem."),
    ],
    encerramento_titulo="Comprar certo é lucro.",
    encerramento_fala="Pronto! Na próxima aula: o fluxo de caixa e as contas a receber.",
    proxima="Fluxo de caixa e contas a receber",
)

A14 = Aula(
    slug="fluxo-de-caixa", numero=14, modulo="Dinheiro",
    titulo="Fluxo de caixa e contas a receber",
    subtitulo="O que entrou, o que saiu e o que ainda falta receber.",
    abertura_fala="Nesta aula, você vai ver o dinheiro da oficina: as contas a receber, o fluxo de caixa e o lucro.",
    inicio="/financeiro/receber",
    passos=[
        Passo("Em Financeiro, a primeira aba mostra o que os clientes devem. Cada OS finalizada vira uma conta a receber.",
              [focar(lambda p: p.locator("main").get_by_role("button", name=re.compile("OS nº")).first.locator(
                  "xpath=ancestor::div[contains(@class,'rounded-xl')][1]"))]),
        Passo("As vencidas aparecem em destaque. Dá para filtrar.",
              [focar(None), clicar(B("Vencidas"), 1.0)]),
        Passo("Na aba Fluxo de caixa, o que entrou e o que saiu, dia a dia.",
              [clicar(LINK("Fluxo de caixa"), 1.4), focar(cartao("Entradas e saídas"))]),
        Passo("E o lucro estimado: o faturamento menos o custo das peças e as despesas.",
              [focar(cartao("Lucro estimado"))]),
        Passo("Para lançar uma despesa, como o aluguel ou a conta de luz, toque em Lançar despesa.",
              [focar(B("Lançar despesa"))]),
    ],
    encerramento_titulo="O dinheiro da oficina, à vista.",
    encerramento_fala="Pronto! Na próxima aula: configurar e acompanhar a comissão dos mecânicos.",
    proxima="Comissão do mecânico",
)

A15 = Aula(
    slug="comissao", numero=15, modulo="Dinheiro",
    titulo="Comissão do mecânico",
    subtitulo="Um percentual sobre a mão de obra, calculado sozinho.",
    abertura_fala="Nesta aula, você vai configurar a comissão dos mecânicos e ver o sistema calcular sozinho.",
    inicio="/configuracoes/precos",
    passos=[
        Passo("A comissão fica em Configurações, Preços e estoque. É um percentual sobre a mão de obra, nunca sobre a peça.",
              [focar(LBL("Comissão padrão do mecânico"))],
              legenda="Comissão: percentual sobre a mão de obra, nunca sobre a peça."),
        Passo("Aqui, dez por cento para todos. Cada mecânico pode ter o seu, e cada serviço também: o mais específico vence.",
              [focar(None), digitar(LBL("Comissão padrão do mecânico"), "10"), clicar(B("Salvar"), 1.2)],
              legenda="Comissão padrão: 10%. Mecânico e serviço podem ter o seu."),
        Passo("A comissão é calculada quando a OS é finalizada. Vamos finalizar o Honda Civic, que está com o Diego.",
              [guardar("_", "() => true"), clicar(MENU("Ordens de serviço"), 1.2),
               clicar(lambda p: p.locator("main a[href='/ordens/8']").first, 1.4)]),
        Passo("Toque em Finalizar serviço, e confirme.",
              [clicar(B("Finalizar serviço")),
               clicar(lambda p: p.get_by_role("alertdialog").get_by_role("button", name="Finalizar serviço"), 1.4)]),
        Passo("Em Financeiro, Comissões, aparece a comissão de cada mecânico. Ela acompanha o que o cliente já pagou: aqui, o Diego ganha catorze reais quando o cliente quitar a OS.",
              legenda="A comissão acompanha o que o cliente pagou: R$ 14,00 quando a OS for quitada.",
              acoes=
              [clicar(MENU("Financeiro"), 1.2), clicar(LINK("Comissões"), 1.6), focar(lambda p: p.locator("main").get_by_text("Diego Rocha").first.locator(
                  "xpath=ancestor::div[contains(@class,'rounded-xl')][1]"))]),
    ],
    encerramento_titulo="Comissão sem conta de cabeça.",
    encerramento_fala="Pronto! Na próxima aula: a ficha do carro, com a especificação de cada peça.",
    proxima="Ficha do carro e busca por chassi",
)

A16 = Aula(
    slug="ficha-do-carro", numero=16, modulo="Ficha do carro",
    titulo="Ficha do carro e busca por chassi",
    subtitulo="O que serve em cada carro, sem abrir catálogo de fabricante.",
    abertura_fala="Nesta aula, você vai consultar a ficha do carro: o óleo, os filtros e o que serve em cada modelo.",
    inicio="/ficha-do-carro",
    passos=[
        Passo("A ficha do carro mostra o que serve em cada modelo: óleo, filtros, pastilha, torque de roda. Sem abrir catálogo de fabricante.",
              [focar(PH("Gol 2013"))]),
        Passo("Digite o modelo e o ano.",
              [focar(None), digitar(PH("Gol 2013"), "Onix 2019"), pausa(0.8)]),
        Passo("Escolha a versão do motor.",
              [clicar(lambda p: p.locator("main").get_by_role("button", name="Ver ficha").first, 1.6)]),
        Passo("Aí está a especificação de cada item, para orçar e comprar a peça certa.",
              [focar(lambda p: p.locator("[role=dialog]").or_(p.locator("main")).last)]),
        Passo("Não sabe a versão do carro? Cole o chassi no mesmo campo. O sistema lê a marca e o ano, e mostra só as fichas que servem.",
              [focar(None), tecla("Escape", 0.6), clicar(MENU("Ficha do carro"), 1.2),
               digitar(PH("Gol 2013"), "9BGKS48U0KG000001", 40), pausa(1.2),
               focar(lambda p: p.locator("main").get_by_text("Chevrolet").first.locator(
                   "xpath=ancestor::div[contains(@class,'rounded')][1]"))],
              legenda="Pelo chassi: o sistema lê a marca e o ano, e filtra as fichas."),
    ],
    encerramento_titulo="A peça certa, na primeira.",
    encerramento_fala="Pronto! Na próxima aula: o painel do dia, com o que precisa da sua atenção.",
    proxima="O painel do dia",
)

A17 = Aula(
    slug="painel-do-dia", numero=17, modulo="Painel e relatórios",
    titulo="O painel do dia",
    subtitulo="Faturamento, produção e a lista do que precisa de atenção.",
    abertura_fala="Nesta aula, você vai usar o painel do início para saber, em um minuto, como a oficina está.",
    inicio="/",
    passos=[
        Passo("O painel muda conforme o período: hoje, esta semana ou este mês.",
              [clicar(B("Esta semana"), 1.0), clicar(B("Este mês"), 1.0)]),
        Passo("O gráfico mostra o faturamento dia a dia.",
              [focar(cartao("Faturamento"))]),
        Passo("E a produção do mês: serviços concluídos, a taxa de orçamentos aprovados e os clientes novos.",
              [focar(grupo("Serviços concluídos", "Clientes novos"))],
              legenda="Produção: serviços concluídos, orçamentos aprovados e clientes novos."),
        Passo("Na lista de Atenção necessária, cada item leva direto para onde se resolve. Toque em um.",
              [focar(None), clicar(lambda p: p.locator("main").get_by_text(re.compile("^OS \\d+ ·")).first, 1.6)],
              legenda="Cada alerta leva direto para onde se resolve."),
    ],
    encerramento_titulo="A oficina inteira em um minuto.",
    encerramento_fala="Pronto! Na próxima aula: os relatórios, na tela, em planilha e em PDF.",
    proxima="Relatórios em PDF",
)

A18 = Aula(
    slug="relatorios", numero=18, modulo="Painel e relatórios",
    titulo="Relatórios em PDF",
    subtitulo="Os números do jeito que o contador pede.",
    abertura_fala="Nesta aula, você vai tirar os relatórios da oficina: na tela, em planilha ou em PDF.",
    inicio="/",
    passos=[
        Passo("Os relatórios ficam aqui em cima, em Relatórios.",
              [clicar(B("Relatórios"), 1.2)]),
        Passo("Escolha o período e o relatório: faturamento, lucro, serviços, peças, mecânicos ou aprovação de orçamentos.",
              [selecionar(DL("Período"), "Últimos 30 dias"), clicar(DB("Mecânicos"), 1.2)],
              legenda="Período e relatório: faturamento, lucro, serviços, peças, mecânicos..."),
        Passo("Os números aparecem na tela, e saem em planilha ou em PDF.",
              [focar(DB("PDF"))]),
        Passo("E tem os pacotes prontos, com vários relatórios num arquivo só, para mandar ao contador.",
              [focar(DB("Financeiro completo"))]),
    ],
    encerramento_titulo="O contador agradece.",
    encerramento_fala="Pronto! Na próxima aula: o pós-venda, com a mensagem pronta para o cliente voltar.",
    proxima="Pós-venda com mensagem pronta",
)

A19 = Aula(
    slug="pos-venda", numero=19, modulo="Pós-venda e clientes novos",
    titulo="Pós-venda com mensagem pronta",
    subtitulo="Quem chamar hoje, com o texto pronto.",
    abertura_fala="Nesta aula, você vai usar o pós-venda: a lista de quem chamar hoje, com a mensagem pronta.",
    inicio="/pos-venda",
    preparo=[prep_posvenda],
    passos=[
        Passo("O pós-venda é o que faz o cliente voltar. Toda manhã, o sistema monta sozinho a fila de quem chamar.",
              [clicar(B("Todos"), 1.2)]),
        Passo("Uma semana depois do serviço, revisão vencendo, e cliente que sumiu há seis meses: cada um com o texto pronto.",
              [focar(lambda p: p.locator("main").get_by_role("link", name="Abrir no WhatsApp").first.locator(
                  "xpath=ancestor::div[contains(@class,'rounded-xl')][1]"))],
              legenda="Uma semana depois, revisão vencendo, cliente sumido: tudo na fila."),
        Passo("Toque em Abrir no WhatsApp: a mensagem sai com o nome do cliente, o carro e o serviço.",
              [focar(None),
               guardar("_", "() => { window.__wa = [...document.querySelectorAll('main a')].find(a => a.textContent.includes('Abrir no WhatsApp')).href; return true }"),
               mover(lambda p: p.locator("main").get_by_role("link", name="Abrir no WhatsApp").first),
               guardar("wa", TEXTO_WA), celular_chat("Oficina Demonstração", wa_texto)]),
        Passo("Depois de falar, marque como feito, e ele sai da fila de hoje.",
              [pausa(1.2), fechar_celular(), clicar(B("Já falei"), 1.2)]),
    ],
    encerramento_titulo="Cliente bem cuidado volta.",
    encerramento_fala="Pronto! Na próxima aula: o funil, para não perder cliente novo.",
    proxima="Funil de clientes novos",
)

A20 = Aula(
    slug="funil", numero=20, modulo="Pós-venda e clientes novos",
    titulo="Funil de clientes novos",
    subtitulo="O orçamento que ainda não virou OS, e a ligação que não pode esfriar.",
    abertura_fala="Nesta aula, você vai usar o funil para acompanhar os clientes novos até fechar.",
    inicio="/funil",
    passos=[
        Passo("O funil é para os clientes novos: cada pedido de orçamento vira um card, que anda pelas etapas até fechar.",
              [focar(grupo("Em aberto no funil", "Perdidos"))],
              legenda="Cada pedido vira um card, de novo contato até fechado."),
        Passo("Cada card mostra o carro, o que o cliente pediu, de onde ele veio e quanto vale.",
              [focar(lambda p: p.locator("main").get_by_text("Rafael Moura").first.locator(
                  "xpath=ancestor::div[contains(@class,'rounded')][1]"))]),
        Passo("Para andar com o card, é só arrastar para a próxima etapa.",
              [focar(None), arrastar(lambda p: p.locator("main").get_by_text("Rafael Moura").first, 300, 0)]),
        Passo("Perdeu o cliente? Toque em Perdi e anote o motivo. Isso mostra onde a oficina perde venda.",
              [focar(B("Perdi"))]),
    ],
    encerramento_titulo="Nenhum cliente novo esquecido.",
    encerramento_fala="Pronto! Na próxima aula: as conversas e o WhatsApp oficial.",
    proxima="Conversas e WhatsApp oficial",
)

A21 = Aula(
    slug="whatsapp", numero=21, modulo="WhatsApp",
    titulo="Conversas e WhatsApp oficial",
    subtitulo="Com a conta da própria oficina, as mensagens saem sozinhas.",
    abertura_fala="Nesta aula, você vai entender como o WhatsApp funciona no OficinaOS, com e sem a conexão oficial.",
    inicio="/configuracoes/whatsapp",
    passos=[
        Passo("Sem conectar nada, o sistema já funciona: ele abre o WhatsApp com a mensagem pronta, e você só toca em enviar.",
              [focar(cartao("O WhatsApp da sua oficina"))],
              legenda="Sem conectar: o WhatsApp abre com a mensagem pronta."),
        Passo("Com o WhatsApp oficial, a oficina usa a própria conta da Meta. Cole aqui os códigos do número e o token, e toque em Conectar e testar.",
              [focar(LBL("Phone number ID")), pausa(0.6), focar(B("Conectar e testar"))],
              legenda="WhatsApp oficial: a conta da Meta é da própria oficina."),
        Passo("Conectado, os avisos saem sozinhos, como o de veículo pronto, e as respostas chegam aqui no sistema.",
              [focar(cartao("Enviar sozinho"))]),
        Passo("As conversas ficam em Conversas, no menu: cada cliente com o histórico de mensagens.",
              [focar(None), clicar(MENU("Conversas"), 1.4)]),
    ],
    encerramento_titulo="WhatsApp do jeito da oficina.",
    encerramento_fala="Pronto! Na próxima aula: o OficinaOS no celular do mecânico.",
    proxima="O app no celular do mecânico",
)

A22 = Aula(
    slug="celular-do-mecanico", numero=22, modulo="No celular",
    titulo="O app no celular do mecânico",
    subtitulo="Minhas OS: só os carros que estão com ele.",
    abertura_fala="Nesta aula, você vai ver como o mecânico usa o OficinaOS no celular.",
    usuario="mechanic@oficinaos.dev",
    inicio="/minhas-os",
    passos=[
        Passo("O mecânico usa o OficinaOS no celular. Ele abre pelo navegador e coloca na tela de início, como um aplicativo, sem loja.",
              [celular_app("/minhas-os", "Celular do mecânico")],
              legenda="Pelo navegador, e vira app na tela do celular. Sem loja."),
        Passo("Em Minhas OS, ele vê só os carros que estão com ele, com o que o cliente relatou.",
              [rolar(no_celular(lambda b: b.get_by_text("OS 8").first))]),
        Passo("Daqui ele inicia a execução, finaliza o serviço e tira as fotos do check-in, sem passar pelo balcão.",
              [clicar(no_celular(lambda b: b.get_by_role("button", name="Iniciar execução").first), 1.4)],
              legenda="Iniciar, finalizar e fotografar, sem passar pelo balcão."),
        Passo("E o dono vê tudo em tempo real, na tela do computador.",
              [pausa(1.0), fechar_celular()]),
    ],
    encerramento_titulo="A oficina no bolso do mecânico.",
    encerramento_fala="Pronto! Na próxima aula: convidar a equipe e definir o que cada um vê.",
    proxima="Equipe e papéis",
)

A23 = Aula(
    slug="equipe-e-papeis", numero=23, modulo="Configurações e equipe",
    titulo="Equipe e papéis",
    subtitulo="Cada pessoa com o próprio acesso, vendo só o que precisa.",
    abertura_fala="Nesta aula, você vai convidar uma pessoa para a equipe e escolher o que ela pode ver.",
    inicio="/configuracoes/equipe",
    passos=[
        Passo("Cada pessoa da oficina entra com o próprio acesso, e vê só o que o papel dela permite.",
              [focar(cartao("Equipe"))]),
        Passo("Para chamar alguém, toque em Convidar pessoa.",
              [focar(None), clicar(B("Convidar pessoa"))]),
        Passo("Coloque o e-mail e escolha o papel. O mecânico, por exemplo, vê as ordens de serviço, mas não vê custos nem o financeiro.",
              [digitar(DL("E-mail"), "lucas.mecanico@exemplo.com"), selecionar(DL("Papel"), "Mecânico")],
              legenda="O mecânico vê as OS, mas não vê custos nem financeiro."),
        Passo("Toque em Criar convite. O sistema gera um link para mandar pelo WhatsApp: a pessoa cria a senha e entra.",
              [clicar(DB("Criar convite"), 1.4), focar(lambda p: p.get_by_role("dialog"))]),
        Passo("E na lista da equipe, você define a comissão de cada mecânico.",
              [focar(None), tecla("Escape", 0.8), focar(lambda p: p.locator("main").get_by_label("Comissão").first)]),
    ],
    encerramento_titulo="Equipe certa, acesso certo.",
    encerramento_fala="Pronto! Na última aula: os dados da oficina e a chave Pix.",
    proxima="Dados da oficina e Pix",
)

A24 = Aula(
    slug="dados-da-oficina", numero=24, modulo="Configurações e equipe",
    titulo="Dados da oficina e Pix",
    subtitulo="O que aparece para o cliente, e a chave do Pix na hora.",
    abertura_fala="Nesta aula, você vai configurar os dados da oficina, o horário e a chave Pix.",
    inicio="/configuracoes/oficina",
    passos=[
        Passo("Em Configurações, Oficina, ficam os dados que aparecem para o cliente: nome, telefone, WhatsApp e endereço.",
              [focar(cartao("Identificação"))]),
        Passo("O horário de funcionamento organiza a agenda.",
              [focar(cartao("Funcionamento"))]),
        Passo("Cadastre a chave Pix da oficina: é com ela que a OS gera o QR do Pix na hora. Ela é salva assim que você sai do campo.",
              [digitar(LBL("Chave Pix"), CHAVE_PIX, 15), tecla("Tab", 1.4)],
              legenda="Chave Pix: salva assim que você sai do campo."),
        Passo("Cole o link de avaliação do Google: depois da entrega, o sistema convida o cliente a avaliar a oficina.",
              [focar(LBL("Link de avaliação do Google"))]),
        Passo("E, se quiser, exija a assinatura de quem recebe o carro na entrega.",
              [focar(cartao("Entrega do veículo"))]),
    ],
    encerramento_titulo="Você concluiu o curso do OficinaOS.",
    encerramento_fala="Pronto! Você terminou o curso. Qualquer dúvida, chame no WhatsApp. Bom trabalho na oficina!",
    proxima=None,
)

CURSO = {a.numero: a for a in [A01, A02, A03, A04, A05, A06, A07, A08, A09, A10, A11, A12, A13, A14, A15, A16,
                               A17, A18, A19, A20, A21, A22, A23, A24]}


def recriar_demo():
    subprocess.run("npm run db:seed:demo -- --reset --seed", shell=True, cwd=REPO, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    pedidas = sorted(CURSO) if sys.argv[1:] == ["todas"] else [int(x) for x in sys.argv[1:]]
    falhas = []
    for n in pedidas:
        t = time.time()
        print(f"--- aula {n}: {CURSO[n].titulo}", flush=True)
        try:
            recriar_demo()
            rodar(CURSO[n])
            print(f"    ok em {time.time() - t:.0f}s", flush=True)
        except Exception as e:  # segue para a próxima e relata no fim
            falhas.append((n, repr(e)[:200]))
            print(f"    FALHOU: {repr(e)[:300]}", flush=True)
            print("    DETALHE: " + " | ".join(str(e).splitlines())[:3000], flush=True)
    print("FALHAS:", falhas if falhas else "nenhuma")
