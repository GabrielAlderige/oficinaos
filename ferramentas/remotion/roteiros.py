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

ROTEIROS = {r["numero"]: r for r in [R01, R02, R03, R04, R05, R06, R07, R08, R09, R10]}
