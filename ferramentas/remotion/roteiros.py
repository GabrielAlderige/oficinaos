"""Os roteiros dos reels em Remotion.

Regra da casa: nada de número inventado, depoimento falso ou promessa que o
sistema não cumpre. Nomes de cliente são de exemplo, como no resto do material.
Cada cena: tipo (gancho | calendario | conversa | lista | chamada), fala, params.
Na tela, *palavra* sai na cor de destaque.
"""

R01 = {
    "numero": 1,
    "slug": "cliente-esquece",
    "cenas": [
        {"tipo": "gancho", "fala": "O seu cliente não some.", "folga": 0.25,
         "params": {"sobre": "Dono de oficina", "linhas": ["Seu cliente", "não *some.*"]}},
        {"tipo": "gancho", "fala": "Ele esquece.", "folga": 0.35,
         "params": {"linhas": ["Ele", "*esquece.*"], "tamanho": 200}},
        {"tipo": "calendario",
         "fala": "Fez a revisão, foi embora, e seis meses depois nem lembra mais o nome da oficina.",
         "params": {"meses": ["ABR", "MAI", "JUN", "JUL", "AGO", "SET"], "numero": 6, "rotulo": "meses depois"}},
        {"tipo": "conversa", "fala": "E quem lembra primeiro leva o serviço.", "minimo": 3.6,
         "params": {"titulo": ["Quem lembra", "*primeiro*, leva."], "mensagens": [
             {"de": "oficina", "texto": "Oi, Camila! A revisão do Onix vence semana que vem. Quer agendar?"},
             {"de": "cliente", "texto": "Quero sim! Sexta de manhã dá?"}]}},
        {"tipo": "lista",
         "fala": "O OficinaOS monta toda manhã a lista de quem chamar, com a mensagem pronta para o WhatsApp.",
         "params": {"titulo": "Toda manhã, *pronto:*", "itens": [
             {"titulo": "Revisão vencendo", "detalhe": "Camila · Chevrolet Onix"},
             {"titulo": "7 dias depois do serviço", "detalhe": "Bruno · Fiat Strada"},
             {"titulo": "Sumiu há 6 meses", "detalhe": "Diego · Peugeot 208"}]}},
        {"tipo": "chamada", "fala": "Teste grátis por catorze dias, sem cartão. O link está na bio.", "folga": 0.9,
         "params": {"titulo": "Seja *lembrado.*"}},
    ],
}

CHAMADA = "Teste grátis por catorze dias, sem cartão. O link está na bio."

R02 = {"numero": 2, "slug": "tres-sinais", "cenas": [
    {"tipo": "gancho", "fala": "Três sinais de que a sua oficina está perdendo dinheiro.",
     "params": {"sobre": "Presta atenção", "linhas": ["3 sinais de que", "sua oficina", "está *perdendo*", "*dinheiro.*"]}},
    {"tipo": "lista", "fala": "Orçamento que ninguém cobrou. Cliente que não voltou para a revisão. E peça vendida sem saber quanto custou.",
     "params": {"titulo": "Os *3 sinais:*", "intervalo": 1.6, "itens": [
         {"tipo": "nao", "titulo": "Orçamento que ninguém cobrou"},
         {"tipo": "nao", "titulo": "Cliente que não voltou para a revisão"},
         {"tipo": "nao", "titulo": "Peça vendida sem saber o custo"}]}},
    {"tipo": "gancho", "fala": "Não é falta de cliente. É falta de controle.",
     "params": {"linhas": ["Não é falta", "de cliente.", "É falta de *controle.*"]}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Controle que", "*cabe no bolso.*"]}},
]}

R03 = {"numero": 3, "slug": "aprovou-no-cafe", "cenas": [
    {"tipo": "gancho", "fala": "Imagina o cliente aprovar o orçamento enquanto você toma o seu café.",
     "params": {"sobre": "Imagina", "linhas": ["O cliente aprovou", "o orçamento", "enquanto você", "tomava *café.*"]}},
    {"tipo": "conversa", "fala": "Ele recebe o link, vê cada item com o preço e aprova pelo celular.", "minimo": 3.8,
     "params": {"titulo": ["Orçamento", "pelo *link*"], "mensagens": [
         {"de": "oficina", "texto": "Seu orçamento está pronto: pastilhas e discos, R$ 770,00. É só abrir o link e aprovar."},
         {"de": "cliente", "texto": "Aprovado! Pode fazer."}]}},
    {"tipo": "gancho", "fala": "Sem ligação, sem áudio, sem esquecer.",
     "params": {"linhas": ["Sem ligação.", "Sem áudio.", "Sem *esquecer.*"]}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Aprovado", "*pelo celular.*"]}},
]}

R04 = {"numero": 4, "slug": "faz-essa-conta", "cenas": [
    {"tipo": "gancho", "fala": "Faz essa conta comigo.", "folga": 0.3,
     "params": {"sobre": "Rapidinho", "linhas": ["Faz essa", "*conta* comigo."]}},
    {"tipo": "numero", "minimo": 4.5,
     "fala": "Num exemplo: se um orçamento de oitocentos reais fica esquecido por semana, são três mil e duzentos reais por mês que não entram.",
     "params": {"sobre": "Um exemplo", "prefixo": "R$ ", "ate": 3200, "unidade": "por mês",
                "rotulo": "1 orçamento de R$ 800 esquecido por semana"}},
    {"tipo": "gancho", "fala": "O OficinaOS começa em cento e quarenta e nove reais por mês.",
     "params": {"linhas": ["O OficinaOS", "começa em", "*R$ 149* por mês."]}},
    {"tipo": "chamada", "fala": "Faça a conta com os números da sua oficina. Teste grátis, o link está na bio.", "folga": 0.9,
     "params": {"titulo": ["Nenhum orçamento", "*esquecido.*"]}},
]}

R05 = {"numero": 5, "slug": "antes-e-depois", "cenas": [
    {"tipo": "gancho", "fala": "A sua oficina, antes e depois.", "folga": 0.3,
     "params": {"linhas": ["Sua oficina,", "*antes e depois.*"]}},
    {"tipo": "contraste", "fala": "Orçamento por áudio, que o cliente esquece. Agora, um link que ele aprova no celular.",
     "params": {"antes": "Orçamento por áudio", "depois": "Link que o cliente aprova"}},
    {"tipo": "contraste", "fala": "Fiado anotado no caderno. Agora, quem deve aparece na tela.",
     "params": {"antes": "Fiado no caderno", "depois": "Quem deve, na tela"}},
    {"tipo": "contraste", "fala": "Discussão na entrega. Agora, foto do carro na chegada.",
     "params": {"antes": "Discussão na entrega", "depois": "Foto na chegada"}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Escolha o", "*depois.*"]}},
]}

R06 = {"numero": 6, "slug": "mecanico-nao-secretario", "cenas": [
    {"tipo": "gancho", "fala": "Você é mecânico. Não é secretário.",
     "params": {"linhas": ["Você é", "*mecânico.*", "Não secretário."]}},
    {"tipo": "lista", "fala": "Deixa o sistema lembrar a revisão do cliente, avisar quem não confirmou o horário e mostrar a peça que está acabando.",
     "params": {"titulo": "Deixa o *sistema* lembrar:", "intervalo": 1.5, "itens": [
         {"icone": "calendario", "titulo": "A revisão do cliente"},
         {"icone": "relogio", "titulo": "Quem não confirmou o horário"},
         {"icone": "chave", "titulo": "A peça que está acabando"}]}},
    {"tipo": "gancho", "fala": "E você volta para o elevador.",
     "params": {"linhas": ["E você volta", "para o *elevador.*"]}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Menos papel,", "*mais carro.*"]}},
]}

R07 = {"numero": 7, "slug": "quatorze-dias", "cenas": [
    {"tipo": "numero", "fala": "Catorze dias para testar o OficinaOS completo. De graça.", "minimo": 3.2,
     "params": {"sobre": "Teste grátis", "ate": 14, "unidade": "dias", "rotulo": "no plano completo"}},
    {"tipo": "lista", "fala": "Sem cartão de crédito. Sem fidelidade. E os seus dados são seus, para levar quando quiser.",
     "params": {"titulo": "Sem *pegadinha:*", "intervalo": 1.3, "itens": [
         {"titulo": "Sem cartão de crédito"},
         {"titulo": "Sem fidelidade"},
         {"titulo": "Seus dados são seus", "detalhe": "saem em planilha quando quiser"}]}},
    {"tipo": "gancho", "fala": "Se não servir para a sua oficina, é só não assinar.",
     "params": {"linhas": ["Não serviu?", "É só *não assinar.*"]}},
    {"tipo": "chamada", "fala": "Cria a sua conta agora. O link está na bio.", "folga": 0.9,
     "params": {"titulo": ["Começa", "*hoje.*"], "rodape": "Link na bio · oficinaosbr.cloud"}},
]}

R08 = {"numero": 8, "slug": "ja-ficou-pronto", "cenas": [
    {"tipo": "gancho", "fala": "Meu carro já ficou pronto? Quantas vezes por dia o telefone toca com essa pergunta?",
     "params": {"sobre": "Quantas vezes por dia?", "linhas": ["“Meu carro", "já ficou", "*pronto?*”"]}},
    {"tipo": "conversa", "fala": "No OficinaOS, você manda um link e o cliente acompanha sozinho.", "minimo": 3.8,
     "params": {"titulo": ["O cliente", "acompanha *sozinho*"], "mensagens": [
         {"de": "cliente", "texto": "Oi! Meu carro já ficou pronto?", "hora": "10:14"},
         {"de": "oficina", "texto": "Acompanhe por este link: ele mostra em que etapa o seu carro está.", "hora": "10:15"}]}},
    {"tipo": "lista", "fala": "Ele vê a etapa do carro no celular, sem baixar nada. Mudou na oficina, muda no celular dele.",
     "params": {"titulo": "No celular *dele:*", "intervalo": 1.2, "itens": [
         {"icone": "chave", "titulo": "Em que etapa está o carro"},
         {"icone": "celular", "titulo": "Sem baixar aplicativo"},
         {"icone": "relogio", "titulo": "Atualiza sozinho"}]}},
    {"tipo": "chamada", "fala": "Menos telefone, mais serviço. Teste grátis, o link está na bio.", "folga": 0.9,
     "params": {"titulo": ["Menos telefone,", "*mais serviço.*"]}},
]}

R09 = {"numero": 9, "slug": "oficina-pequena", "cenas": [
    {"tipo": "gancho", "fala": "Oficina pequena também merece sistema.",
     "params": {"linhas": ["Oficina *pequena*", "também merece", "sistema."]}},
    {"tipo": "gancho", "fala": "E funciona no celular que você já tem.",
     "params": {"linhas": ["Funciona no", "*celular* que", "você já tem."]}},
    {"tipo": "lista", "fala": "Sem instalar nada, com aulas curtas dentro do sistema, a partir de cento e quarenta e nove reais por mês.",
     "params": {"titulo": "Feito para a *sua:*", "intervalo": 1.4, "itens": [
         {"icone": "celular", "titulo": "Nada para instalar"},
         {"icone": "sino", "titulo": "Aulas curtas dentro do sistema"},
         {"icone": "dinheiro", "titulo": "A partir de R$ 149 por mês"}]}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Do seu", "*tamanho.*"]}},
]}

R10 = {"numero": 10, "slug": "nao-autorizei", "cenas": [
    {"tipo": "gancho", "fala": "Eu não autorizei esse serviço. Já ouviu isso na entrega?",
     "params": {"sobre": "Já ouviu isso?", "linhas": ["“Eu não", "autorizei esse", "*serviço.*”"]}},
    {"tipo": "contraste", "fala": "Autorização no boca a boca vira discussão. Com o OficinaOS, a aprovação fica com data e hora.",
     "params": {"antes": "Autorizou de boca", "depois": "Aprovou com data e hora"}},
    {"tipo": "lista", "fala": "Fica registrado quem aprovou, quando aprovou, e as fotos do carro na chegada.",
     "params": {"titulo": "Fica *registrado:*", "intervalo": 1.2, "itens": [
         {"icone": "pessoa", "titulo": "Quem aprovou"},
         {"icone": "relogio", "titulo": "Data e hora da aprovação"},
         {"icone": "celular", "titulo": "Fotos do carro na chegada"}]}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Sem", "*discussão.*"]}},
]}

# ---------------------------------------------------------------- R11 a R20: sem legenda
# Só motion e voz: a tela tem de se explicar sozinha, então as palavras-chave estão escritas nas cenas.

R11 = {"numero": 11, "slug": "segunda-8h", "legenda": False, "cenas": [
    {"tipo": "gancho", "fala": "Segunda-feira, oito da manhã, na sua oficina.",
     "params": {"sobre": "Segunda-feira, 8h", "linhas": ["Pátio *cheio.*", "Telefone", "tocando."]}},
    {"tipo": "lista", "fala": "Cliente perguntando do carro, orçamento para mandar, e a peça que faltou.",
     "params": {"titulo": "Tudo *ao mesmo tempo:*", "intervalo": 1.0, "itens": [
         {"tipo": "nao", "titulo": "\"Meu carro já ficou pronto?\""},
         {"tipo": "nao", "titulo": "Três orçamentos para mandar"},
         {"tipo": "nao", "titulo": "A peça que faltou"}]}},
    {"tipo": "gancho", "fala": "E se a oficina avisasse, cobrasse e lembrasse por você?",
     "params": {"linhas": ["E se a oficina", "*se organizasse*", "sozinha?"]}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Segunda-feira", "*tranquila.*"]}},
]}

R12 = {"numero": 12, "slug": "faturar-nao-e-receber", "legenda": False, "cenas": [
    {"tipo": "gancho", "fala": "Quanto a sua oficina faturou este mês? E quanto entrou de verdade?",
     "params": {"sobre": "Responde rápido", "linhas": ["Faturar", "não é *receber.*"]}},
    {"tipo": "lista", "fala": "Faturado é o que você vendeu. Recebido é o que está no caixa. E a diferença é quem ainda está devendo.",
     "params": {"titulo": "A *diferença:*", "intervalo": 1.5, "itens": [
         {"icone": "chave", "titulo": "Faturado", "detalhe": "o que você vendeu"},
         {"icone": "dinheiro", "titulo": "Recebido", "detalhe": "o que está no caixa"},
         {"icone": "pessoa", "titulo": "A receber", "detalhe": "quem ainda está devendo"}]}},
    {"tipo": "gancho", "fala": "No OficinaOS, você vê os três separados, logo na tela inicial.",
     "params": {"linhas": ["Os três,", "*separados,*", "na tela", "inicial."]}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Caixa", "*às claras.*"]}},
]}

R13 = {"numero": 13, "slug": "pix-na-hora", "legenda": False, "cenas": [
    {"tipo": "gancho", "fala": "Pix na hora, sem maquininha.",
     "params": {"linhas": ["Pix na hora,", "sem", "*maquininha.*"]}},
    {"tipo": "lista", "fala": "Na ordem de serviço pronta, o OficinaOS gera o QR do Pix com o valor certo, na chave da sua própria oficina.",
     "params": {"titulo": "Na OS *pronta:*", "intervalo": 1.4, "itens": [
         {"icone": "celular", "titulo": "QR do Pix com o valor certo"},
         {"icone": "chave", "titulo": "Na chave da sua oficina"},
         {"icone": "dinheiro", "titulo": "Sem taxa do sistema", "detalhe": "cai direto na sua conta"}]}},
    {"tipo": "gancho", "fala": "Recebeu? Um toque e o caixa está certo.",
     "params": {"linhas": ["Recebeu?", "Um toque e", "o caixa está", "*certo.*"]}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Recebe", "*na hora.*"]}},
]}

R14 = {"numero": 14, "slug": "esse-risco", "legenda": False, "cenas": [
    {"tipo": "gancho", "fala": "Esse risco não estava aí. Quem nunca ouviu isso na entrega?",
     "params": {"sobre": "Na entrega", "linhas": ["“Esse risco", "não estava", "*aí.*”"]}},
    {"tipo": "contraste", "fala": "Palavra contra palavra vira discussão. Foto na chegada encerra o assunto.",
     "params": {"antes": "Palavra contra palavra", "depoisTag": "NO CHECK-IN", "depois": "Foto na chegada"}},
    {"tipo": "lista", "fala": "No check-in você registra a quilometragem, o combustível e as avarias com foto, antes de mexer no carro.",
     "params": {"titulo": "Antes de *mexer no carro:*", "intervalo": 1.3, "itens": [
         {"icone": "relogio", "titulo": "Quilometragem"},
         {"icone": "dinheiro", "titulo": "Combustível"},
         {"icone": "celular", "titulo": "Avarias com foto", "detalhe": "guardadas na OS, com data e hora"}]}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Zero", "*discussão.*"]}},
]}

R15 = {"numero": 15, "slug": "a-peca-acabou", "legenda": False, "cenas": [
    {"tipo": "gancho", "fala": "A peça acabou, e o carro está parado no elevador.",
     "params": {"sobre": "Clássico", "linhas": ["A peça *acabou.*", "O carro está", "no elevador."]}},
    {"tipo": "lista", "fala": "No OficinaOS, a peça que sai na ordem de serviço baixa do estoque sozinha, o sistema avisa o que está acabando e monta a lista de compra.",
     "params": {"titulo": "O estoque *se cuida:*", "intervalo": 1.8, "itens": [
         {"icone": "chave", "titulo": "Baixa sozinha na OS"},
         {"icone": "sino", "titulo": "Avisa o que está acabando"},
         {"icone": "celular", "titulo": "Lista de compra pronta", "detalhe": "copiada para o WhatsApp do fornecedor"}]}},
    {"tipo": "gancho", "fala": "Compre antes de faltar.",
     "params": {"linhas": ["Compre antes", "de *faltar.*"]}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Estoque", "*sem susto.*"]}},
]}

R16 = {"numero": 16, "slug": "horario-marcado", "legenda": False, "cenas": [
    {"tipo": "gancho", "fala": "Horário marcado, e o cliente não apareceu.",
     "params": {"linhas": ["Horário", "marcado.", "Cliente", "*sumido.*"]}},
    {"tipo": "conversa", "fala": "Na véspera, o OficinaOS avisa quem ainda não confirmou. É só mandar a mensagem.", "minimo": 3.8,
     "params": {"titulo": ["Na *véspera:*"], "mensagens": [
         {"de": "oficina", "texto": "Oi, Bruno! Amanhã às 8h tem a revisão da Strada. Confirma?", "hora": "17:30"},
         {"de": "cliente", "texto": "Confirmado, estarei aí!", "hora": "17:42"}]}},
    {"tipo": "gancho", "fala": "E quando o carro chega, o agendamento vira a ordem de serviço.",
     "params": {"linhas": ["Chegou?", "O agendamento", "*vira a OS.*"]}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Agenda que", "*trabalha por você.*"]}},
]}

R17 = {"numero": 17, "slug": "qual-oleo", "legenda": False, "cenas": [
    {"tipo": "gancho", "fala": "Qual óleo vai nesse carro? Quanto leva? Qual a medida do pneu?",
     "params": {"sobre": "Toda hora", "linhas": ["Qual óleo", "vai nesse", "*carro?*"]}},
    {"tipo": "numero", "fala": "O OficinaOS tem a ficha técnica de mais de trezentos carros.", "minimo": 3.4,
     "params": {"sobre": "Ficha técnica", "prefixo": "+", "ate": 300, "unidade": "carros", "rotulo": "conferidos no manual do fabricante"}},
    {"tipo": "lista", "fala": "Óleo, quantidade, filtros, pastilhas, pneus e torques, com a fonte de cada dado.",
     "params": {"titulo": "Na *ficha:*", "intervalo": 1.0, "itens": [
         {"icone": "chave", "titulo": "Óleo e quantidade"},
         {"icone": "sino", "titulo": "Filtros e pastilhas"},
         {"icone": "relogio", "titulo": "Pneus e torques", "detalhe": "com a fonte de cada dado"}]}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Sem abrir", "*catálogo.*"]}},
]}

R18 = {"numero": 18, "slug": "mecanico-no-celular", "legenda": False, "cenas": [
    {"tipo": "gancho", "fala": "O seu mecânico ainda trabalha com papel no pátio?",
     "params": {"linhas": ["Seu mecânico", "ainda usa", "*papel?*"]}},
    {"tipo": "lista", "fala": "No OficinaOS, cada mecânico vê no celular só os carros que estão com ele. Um toque e a ordem de serviço avança.",
     "params": {"titulo": "No celular *dele:*", "intervalo": 1.5, "itens": [
         {"icone": "pessoa", "titulo": "Só os carros dele"},
         {"icone": "chave", "titulo": "Um toque, a OS avança"},
         {"icone": "relogio", "titulo": "Você vê na hora", "detalhe": "de onde estiver"}]}},
    {"tipo": "gancho", "fala": "E o seu financeiro continua só com você.",
     "params": {"linhas": ["O financeiro", "fica só", "*com você.*"]}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Pátio", "*no celular.*"]}},
]}

R19 = {"numero": 19, "slug": "comeca-hoje", "legenda": False, "cenas": [
    {"tipo": "gancho", "fala": "Trocar de sistema dá trabalho? Não precisa.",
     "params": {"sobre": "Medo de trocar?", "linhas": ["Começar", "é *simples.*"]}},
    {"tipo": "lista", "fala": "Você cria a conta, traz os seus clientes da planilha, e a equipe aprende com aulas curtas dentro do sistema.",
     "params": {"titulo": "Em *3 passos:*", "intervalo": 1.5, "itens": [
         {"icone": "pessoa", "titulo": "Cria a conta"},
         {"icone": "dinheiro", "titulo": "Traz os clientes da planilha"},
         {"icone": "celular", "titulo": "Aulas curtas para a equipe"}]}},
    {"tipo": "gancho", "fala": "No computador e no celular, sem instalar nada.",
     "params": {"linhas": ["Computador", "e celular.", "Nada para", "*instalar.*"], "tamanho": 120}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Começa", "*hoje.*"]}},
]}

R20 = {"numero": 20, "slug": "oficina-inteira", "legenda": False, "cenas": [
    {"tipo": "gancho", "fala": "A sua oficina inteira, na palma da mão.",
     "params": {"linhas": ["Sua oficina", "inteira, na", "*palma da mão.*"]}},
    {"tipo": "lista", "fala": "Pátio, ordens de serviço, agenda e estoque, no celular e no computador.",
     "params": {"intervalo": 0.8, "itens": [
         {"icone": "chave", "titulo": "Pátio e ordens de serviço"},
         {"icone": "calendario", "titulo": "Agenda"},
         {"icone": "sino", "titulo": "Estoque"},
         {"icone": "dinheiro", "titulo": "Caixa do mês"}]}},
    {"tipo": "numero", "fala": "A partir de cento e quarenta e nove reais por mês, sem fidelidade.", "minimo": 3.4,
     "params": {"sobre": "A partir de", "prefixo": "R$ ", "ate": 149, "unidade": "por mês", "rotulo": "sem fidelidade"}},
    {"tipo": "chamada", "fala": CHAMADA, "folga": 0.9, "params": {"titulo": ["Tudo num", "*lugar só.*"]}},
]}

# ---------------------------------------------------------------- R21 a R50: mais 30, sem legenda
SL = {"legenda": False}


def reel(numero, slug, *cenas, **extra):
    return {"numero": numero, "slug": slug, **SL, **extra, "cenas": list(cenas)}


def g(fala, *linhas, sobre=None, tamanho=None, folga=None):
    p = {"linhas": list(linhas)}
    if sobre: p["sobre"] = sobre
    if tamanho: p["tamanho"] = tamanho
    c = {"tipo": "gancho", "fala": fala, "params": p}
    if folga is not None: c["folga"] = folga
    return c


def li(fala, titulo, *itens, intervalo=1.2):
    its = []
    for it in itens:
        if isinstance(it, str): it = {"titulo": it}
        its.append(it)
    return {"tipo": "lista", "fala": fala, "params": {"titulo": titulo, "intervalo": intervalo, "itens": its}}


def ct(fala, antes, depois, depoisTag=None):
    p = {"antes": antes, "depois": depois}
    if depoisTag: p["depoisTag"] = depoisTag
    return {"tipo": "contraste", "fala": fala, "params": p}


def conv(fala, titulo, *msgs, minimo=3.8):
    return {"tipo": "conversa", "fala": fala, "minimo": minimo,
            "params": {"titulo": titulo, "mensagens": [{"de": d, "texto": t, **({"hora": h} if h else {})} for d, t, h in msgs]}}


def num(fala, ate, unidade, rotulo, sobre=None, prefixo="", minimo=3.4):
    p = {"ate": ate, "unidade": unidade, "rotulo": rotulo, "prefixo": prefixo}
    if sobre: p["sobre"] = sobre
    return {"tipo": "numero", "fala": fala, "minimo": minimo, "params": p}


def fim(*titulo, fala=CHAMADA, rodape=None):
    p = {"titulo": list(titulo)}
    if rodape: p["rodape"] = rodape
    return {"tipo": "chamada", "fala": fala, "folga": 0.9, "params": p}


I = lambda icone, titulo, detalhe=None: {"icone": icone, "titulo": titulo, **({"detalhe": detalhe} if detalhe else {})}
N = lambda titulo, detalhe=None: {"tipo": "nao", "titulo": titulo, **({"detalhe": detalhe} if detalhe else {})}

R21 = reel(21, "quem-abriu",
    g("Você mandou o orçamento. Mas será que o cliente abriu?", "Mandou o", "orçamento.", "Ele *abriu?*"),
    li("No OficinaOS você vê quem já abriu o link, quem nem viu, e até quando cada orçamento vale.", "Na lista de *orçamentos:*",
       I("celular", "Quem já abriu o link"), I("relogio", "Quem ainda nem viu"), I("calendario", "Até quando cada um vale"), intervalo=1.3),
    g("Não abriu? Reenvia pelo WhatsApp com um toque.", "Não abriu?", "*Reenvia* com", "um toque."),
    fim("Nenhum orçamento", "*esquecido.*"))

R22 = reel(22, "assinatura-na-entrega",
    g("Entregou o carro. E a prova de que o cliente recebeu?", "Entregou.", "Cadê a", "*prova?*"),
    li("Na entrega, o OficinaOS registra quem recebeu, a quilometragem de saída e a assinatura do cliente, com o dedo, na tela.", "Na *entrega:*",
       I("pessoa", "Quem recebeu"), I("relogio", "Quilometragem de saída"), I("celular", "Assinatura na tela", "com o dedo, no celular"), intervalo=1.4),
    g("Entregou, assinou, guardou.", "Entregou.", "Assinou.", "*Guardou.*"),
    fim("Entrega", "*com prova.*"))

R23 = reel(23, "doze-horas",
    g("Você trabalha doze horas por dia e ainda leva papel para casa?", "12 horas", "na oficina.", "E o papel", "vai pra *casa?*", sobre="Sinceramente"),
    li("Orçamento para fechar, conta para conferir, cliente para chamar.", "Depois do *expediente:*",
       N("Orçamento para fechar"), N("Conta para conferir"), N("Cliente para chamar"), intervalo=1.0),
    g("O OficinaOS deixa isso pronto durante o dia.", "Deixa *pronto*", "durante", "o dia."),
    fim("Vai pra casa", "*mais cedo.*"))

R24 = reel(24, "fiado",
    g("Quanto o pessoal está te devendo agora?", "Quanto estão", "te *devendo*", "agora?"),
    ct("O fiado no caderno some. No OficinaOS, quem deve aparece na tela, com o valor.", "Fiado no caderno", "Quem deve, na tela"),
    g("Sem precisar lembrar de cabeça.", "Sem lembrar", "de *cabeça.*"),
    fim("Receba o que", "*é seu.*"))

R25 = reel(25, "carro-pronto",
    g("O carro ficou pronto. E o cliente ainda não sabe.", "O carro", "ficou *pronto.*", "O cliente", "não sabe."),
    conv("Um toque em avisar que está pronto, e a mensagem vai para o cliente.", ["Um toque:"],
         ("oficina", "Oi, Ana! O seu Civic está pronto para retirar. Até que horas você consegue vir?", "16:40"),
         ("cliente", "Que ótimo! Passo aí às 18h.", "16:43")),
    g("Carro que sai rápido abre vaga no pátio.", "Carro que sai", "rápido abre", "*vaga no pátio.*"),
    fim("Pátio", "*girando.*"))

R26 = reel(26, "pacote-de-revisao",
    g("Montar orçamento de revisão item por item, toda vez?", "Orçamento de", "revisão, item", "por item,", "*toda vez?*"),
    li("No OficinaOS você monta uma vez o pacote que a oficina mais vende, e na OS ele entra inteiro, com o preço do catálogo.", "Monte *uma vez:*",
       I("chave", "Revisão com os filtros"), I("sino", "Kit de freio"), I("dinheiro", "Preço do catálogo", "cada linha continua editável"), intervalo=1.4),
    g("Menos digitação, mais carro saindo.", "Menos digitação,", "mais carro", "*saindo.*"),
    fim("Orçamento", "*em um toque.*"))

R27 = reel(27, "comissao",
    g("Fim do mês. Quanto de comissão cada mecânico tem para receber?", "Fim do mês.", "Quanto de", "*comissão?*"),
    li("O OficinaOS calcula a comissão de cada mecânico pelos serviços que ele fez.", "Calculada *sozinha:*",
       I("pessoa", "Por mecânico"), I("chave", "Pelos serviços feitos"), I("dinheiro", "Sem planilha", "e sem discussão no fim do mês"), intervalo=1.3),
    g("Conta certa, equipe tranquila.", "Conta certa,", "equipe", "*tranquila.*"),
    fim("Comissão", "*sem briga.*"))

R28 = reel(28, "historico-do-carro",
    g("O cliente voltou. O que foi feito no carro dele da última vez?", "O que foi feito", "da última", "*vez?*", sobre="Ele voltou"),
    li("Pela placa, o OficinaOS mostra o carro, o dono e todo o histórico de serviços.", "Digita a *placa:*",
       I("chave", "O carro"), I("pessoa", "O dono"), I("calendario", "Todo o histórico", "cada serviço, com data"), intervalo=1.2),
    g("Atendimento de quem conhece o cliente.", "Atendimento de", "quem *conhece*", "o cliente."),
    fim("Tudo do carro", "*em segundos.*"))

R29 = reel(29, "tres-planos",
    g("Quanto custa organizar a sua oficina?", "Quanto custa", "*organizar*", "a oficina?"),
    num("O OficinaOS começa em cento e quarenta e nove reais por mês.", 149, "por mês", "plano de entrada", sobre="A partir de", prefixo="R$ "),
    li("São três planos, sem fidelidade, e você testa catorze dias com tudo liberado.", "Do seu *jeito:*",
       I("dinheiro", "3 planos"), I("calendario", "Sem fidelidade"), I("sino", "14 dias grátis", "no plano completo"), intervalo=1.2),
    fim("Preço de", "*oficina.*"))

R30 = reel(30, "acompanhamento",
    g("O cliente quer saber do carro dele. Toda hora.", "O cliente quer", "saber do carro.", "*Toda hora.*"),
    ct("Ligação a cada hora, ou um link que ele acompanha sozinho.", "Ligação a cada hora", "Link de acompanhamento"),
    li("Ele vê em que etapa está o carro, no celular, sem baixar nada.", "Pelo *link:*",
       I("chave", "A etapa do carro"), I("celular", "No celular dele"), I("relogio", "Atualiza sozinho"), intervalo=1.1),
    fim("Cliente", "*tranquilo.*"))

R31 = reel(31, "cliente-sumiu",
    g("Aquele cliente bom, que sumiu há seis meses.", "Aquele cliente", "bom, que", "*sumiu.*"),
    {"tipo": "calendario", "fala": "Ele não foi para o concorrente. Só ninguém chamou.",
     "params": {"meses": ["MAR", "ABR", "MAI", "JUN", "JUL", "AGO"], "numero": 6, "rotulo": "meses sem aparecer"}},
    conv("O OficinaOS mostra quem sumiu e já deixa a mensagem pronta.", ["Mensagem *pronta:*"],
         ("oficina", "Oi, Diego! Faz tempo que o 208 não passa por aqui. Que tal uma revisão?", "09:10"),
         ("cliente", "Verdade! Pode marcar para sábado?", "09:32")),
    fim("Traga o cliente", "*de volta.*"))

R32 = reel(32, "planilha",
    g("A sua oficina roda numa planilha?", "Sua oficina", "roda numa", "*planilha?*"),
    li("Planilha não manda lembrete, não avisa estoque e não mostra quem deve.", "A planilha *não:*",
       N("Manda lembrete"), N("Avisa o estoque"), N("Mostra quem deve"), intervalo=1.0),
    g("E dá para trazer os clientes dela para o OficinaOS.", "Traz os clientes", "dela para o", "*OficinaOS.*"),
    fim("Da planilha", "*ao sistema.*"))

R33 = reel(33, "celular-tela-inicial",
    g("Sistema de oficina precisa de computador?", "Precisa de", "*computador?*"),
    li("O OficinaOS abre no navegador do celular e fica na tela inicial, como um aplicativo.", "No *celular:*",
       I("celular", "Abre no navegador"), I("sino", "Fica na tela inicial"), I("chave", "Sem loja de aplicativo"), intervalo=1.2),
    g("E no computador da recepção também.", "E no computador", "da recepção", "*também.*"),
    fim("Onde você", "*estiver.*"))

R34 = reel(34, "cronometro",
    g("Quanto tempo leva, de verdade, cada serviço na sua oficina?", "Quanto tempo", "leva *de verdade*", "cada serviço?"),
    li("O mecânico dá play no serviço, e o OficinaOS mede o tempo de cada um.", "O *cronômetro:*",
       I("relogio", "Play no serviço"), I("pessoa", "Tempo por mecânico"), I("chave", "Tempo por serviço"), intervalo=1.2),
    g("Com o tempo real, o preço da mão de obra fica justo.", "Tempo real,", "preço *justo.*"),
    fim("Mão de obra", "*bem cobrada.*"))

R35 = reel(35, "avaliacao-google",
    g("Cliente satisfeito vai embora e não deixa avaliação.", "Cliente feliz", "não deixa", "*avaliação.*"),
    conv("Depois da entrega, um toque e o pedido de avaliação vai para ele.", ["Um *pedido:*"],
         ("oficina", "Obrigado pela confiança, Bruno! Se puder, deixa sua avaliação no Google pra gente?", "18:05"),
         ("cliente", "Claro! Acabei de avaliar.", "18:20")),
    g("Avaliação boa no Google traz cliente novo.", "Avaliação boa", "traz cliente", "*novo.*"),
    fim("Seja", "*bem avaliado.*"))

R36 = reel(36, "sem-surpresa",
    g("Ninguém gosta de surpresa na hora de pagar.", "Ninguém gosta", "de *surpresa*", "na hora", "de pagar."),
    ct("Valor falado de boca vira briga. No orçamento por link, cada item tem o preço.", "Valor falado de boca", "Cada item com o preço"),
    g("O cliente aprova o que quer. E paga o que aprovou.", "Aprova o", "que quer.", "Paga o que", "*aprovou.*"),
    fim("Conta", "*transparente.*"))

R37 = reel(37, "relatorio-do-mes",
    g("Qual serviço dá mais dinheiro na sua oficina?", "Qual serviço", "dá mais", "*dinheiro?*"),
    li("Os relatórios do OficinaOS mostram o mês da oficina em poucos toques.", "Nos *relatórios:*",
       I("chave", "Serviços mais vendidos"), I("dinheiro", "Faturamento e lucro"), I("pessoa", "Produção de cada mecânico"), intervalo=1.2),
    g("Quem tem número, decide melhor.", "Quem tem número,", "*decide melhor.*"),
    fim("Oficina", "*no número.*"))

R38 = reel(38, "atendente",
    g("Cada um na oficina vê o que precisa ver.", "Cada um vê", "o que *precisa*", "ver."),
    li("Dono, gerente, atendente e mecânico, cada um com o seu acesso.", "Por *função:*",
       I("pessoa", "Dono vê tudo"), I("sino", "Atendente cuida do balcão"), I("chave", "Mecânico vê os carros dele"), intervalo=1.3),
    g("E o seu financeiro fica protegido.", "O financeiro", "fica", "*protegido.*"),
    fim("Equipe", "*organizada.*"))

R39 = reel(39, "busca-ctrl-k",
    g("Cadê a ficha daquele cliente?", "Cadê a ficha", "daquele", "*cliente?*"),
    li("Na busca do OficinaOS, você acha pela placa, pelo nome ou pelo telefone.", "Busca por:",
       I("chave", "Placa"), I("pessoa", "Nome"), I("celular", "Telefone"), intervalo=0.9),
    g("Em dois segundos, sem gaveta.", "Dois segundos.", "*Sem gaveta.*"),
    fim("Achou,", "*atendeu.*"))

R40 = reel(40, "orcamento-profissional",
    g("Orçamento no papel de pão passa confiança?", "Orçamento no", "papel de pão", "passa *confiança?*"),
    ct("Rabisco no papel, ou um link com o nome da oficina, cada serviço e cada peça.", "Rabisco no papel", "Link com cada item"),
    g("Oficina organizada cobra o preço justo.", "Oficina", "organizada", "cobra o", "*preço justo.*"),
    fim("Orçamento", "*de respeito.*"))

R41 = reel(41, "estoque-parado",
    g("Quanto dinheiro está parado na sua prateleira?", "Quanto dinheiro", "está *parado*", "na prateleira?"),
    li("O OficinaOS guarda o custo de cada peça e mostra o que está entrando e saindo.", "No *estoque:*",
       I("dinheiro", "Custo de cada peça"), I("chave", "Entrada e saída"), I("sino", "Aviso de mínimo"), intervalo=1.2),
    g("Compra o que gira. Não o que encalha.", "Compra o que", "*gira.*", "Não o que", "encalha."),
    fim("Estoque", "*no controle.*"))

R42 = reel(42, "nada-pre-marcado",
    g("Aprovação de orçamento tem que ser clara.", "Aprovação tem", "que ser", "*clara.*"),
    li("No link, o cliente escolhe os itens, escreve o nome e confirma. Nada vem marcado sozinho.", "Na aprovação:",
       I("chave", "Escolhe os itens"), I("pessoa", "Escreve o nome"), I("sino", "Confirma", "nada vem pré-marcado"), intervalo=1.3),
    g("Fica registrado, com data e hora.", "Registrado,", "com data", "*e hora.*"),
    fim("Aprovação", "*sem dúvida.*"))

R43 = reel(43, "oficina-que-cresce",
    g("Sua oficina quer crescer?", "Sua oficina", "quer *crescer?*"),
    li("Crescer é atender mais carros, sem perder cliente nem dinheiro no caminho.", "Crescer é:",
       I("chave", "Mais carros por dia"), I("pessoa", "Cliente que volta"), I("dinheiro", "Dinheiro que entra"), intervalo=1.2),
    g("E isso começa com organização.", "Começa com", "*organização.*"),
    fim("Cresça", "*organizado.*"))

R44 = reel(44, "o-que-falta-receber",
    g("O carro saiu. Mas ficou faltando receber?", "O carro saiu.", "Ficou faltando", "*receber?*"),
    li("Na ordem de serviço, o OficinaOS mostra o recebido, o que falta, e o próximo passo.", "Na OS:",
       I("dinheiro", "Quanto já entrou"), I("sino", "Quanto falta"), I("chave", "O próximo passo"), intervalo=1.2),
    g("Nada sai pela porta sem você saber.", "Nada sai", "pela porta", "*sem você saber.*"),
    fim("Conta", "*fechada.*"))

R45 = reel(45, "terca-de-manha",
    g("Terça de manhã. Quem você precisa chamar hoje?", "Quem você", "precisa chamar", "*hoje?*", sobre="Terça, 8h"),
    li("Toda manhã o OficinaOS monta a lista: revisão vencendo, serviço de uma semana atrás, e quem sumiu.", "A lista *de hoje:*",
       I("calendario", "Revisão vencendo"), I("relogio", "Serviço de 7 dias atrás"), I("pessoa", "Quem sumiu há 6 meses"), intervalo=1.4),
    g("A mensagem já vem pronta para o WhatsApp.", "Mensagem", "*pronta.*"),
    fim("Pós-venda", "*no automático.*"))

R46 = reel(46, "nao-e-caro",
    g("Sistema de oficina é caro?", "Sistema é", "*caro?*"),
    ct("Caro é o orçamento esquecido e o cliente que não volta.", "Mensalidade do sistema", "Orçamento esquecido", depoisTag="CARO MESMO É"),
    num("O OficinaOS começa em cento e quarenta e nove reais por mês.", 149, "por mês", "sem fidelidade", sobre="A partir de", prefixo="R$ "),
    fim("Faça", "*a conta.*"))

R47 = reel(47, "primeiro-carro",
    g("Do primeiro carro do dia até o último.", "Do primeiro", "carro do dia", "*ao último.*"),
    li("Check-in, orçamento, aprovação, serviço, pagamento e entrega. Tudo no mesmo lugar.", "O caminho *todo:*",
       I("celular", "Check-in com foto"), I("sino", "Orçamento e aprovação"), I("chave", "Serviço e cronômetro"), I("dinheiro", "Pagamento e entrega"), intervalo=1.0),
    g("Cada carro sabe onde está.", "Cada carro", "sabe onde", "*está.*"),
    fim("A oficina", "*inteira.*"))

R48 = reel(48, "ao-vivo",
    g("O mecânico terminou o serviço. Você fica sabendo na hora.", "Terminou?", "Você sabe", "*na hora.*"),
    li("A ordem de serviço atualiza ao vivo, no celular do mecânico e no computador da recepção.", "Ao *vivo:*",
       I("chave", "Mecânico avança a OS"), I("celular", "Recepção vê na hora"), I("relogio", "Sem recarregar a tela"), intervalo=1.2),
    g("Sem gritar no pátio.", "Sem gritar", "*no pátio.*"),
    fim("Oficina", "*conectada.*"))

R49 = reel(49, "seus-dados",
    g("E se um dia você quiser sair?", "E se você", "quiser *sair?*"),
    li("Os seus dados são seus: clientes, relatórios e financeiro saem em planilha quando você quiser.", "Seus *dados:*",
       I("pessoa", "Clientes"), I("chave", "Relatórios"), I("dinheiro", "Financeiro", "em planilha, quando quiser"), intervalo=1.2),
    g("E atraso no pagamento nunca bloqueia a leitura.", "Atrasou?", "A leitura", "*nunca trava.*"),
    fim("Sem ficar", "*preso.*"))

R50 = reel(50, "manifesto",
    g("Mecânico bom merece oficina organizada.", "Mecânico bom", "merece oficina", "*organizada.*"),
    li("Cliente que confia, carro que sai no prazo, e dinheiro que fica.", "Merece:",
       I("pessoa", "Cliente que confia"), I("relogio", "Carro no prazo"), I("dinheiro", "Dinheiro que fica"), intervalo=1.2),
    g("O OficinaOS foi feito para isso.", "Feito", "*para isso.*"),
    fim("Bem-vindo ao", "*OficinaOS.*"))

ROTEIROS = {r["numero"]: r for r in [R01, R02, R03, R04, R05, R06, R07, R08, R09, R10,
                                    R11, R12, R13, R14, R15, R16, R17, R18, R19, R20,
                                    R21, R22, R23, R24, R25, R26, R27, R28, R29, R30,
                                    R31, R32, R33, R34, R35, R36, R37, R38, R39, R40,
                                    R41, R42, R43, R44, R45, R46, R47, R48, R49, R50]}
