"""Os reels em motion graphics do OficinaOS: chamar atenção, não ensinar tela.

Rodar:  python reels_motion.py 1 2      ou      python reels_motion.py todos
Regra da casa: nada de número inventado, depoimento falso ou promessa que o
sistema não cumpre. Conta de exemplo é dita como exemplo.
"""
import sys, time
from motion import Cena, ReelMotion, rodar

M01 = ReelMotion(1, "papel-nao", [
    Cena("impacto", "Você abriu a oficina para consertar carro.",
         params={"sobre": "Dono de oficina", "linhas": ["Você abriu", "a oficina para", "*consertar carro.*"]}),
    Cena("impacto", "Não para correr atrás de papel.",
         params={"linhas": ["Não para", "correr atrás", "de *papel.*"], "tamanho": 150}),
    Cena("lista", "Orçamento perdido no WhatsApp. Cliente dizendo que não autorizou. E o caderno que nunca fecha o mês.",
         params={"titulo": "Isso *te lembra* alguma coisa?", "itens": [
             {"tipo": "nao", "texto": "Orçamento perdido no WhatsApp"},
             {"tipo": "nao", "texto": "\"Eu não autorizei esse serviço\""},
             {"tipo": "nao", "texto": "Caderno que não fecha o mês"}]}),
    Cena("celular", "Com o OficinaOS, o cliente aprova o orçamento pelo celular, e você fica sabendo na hora.",
         params={"cabecalho": "Avisos", "subcabecalho": "Auto Center do Marcos", "notificacoes": [
             {"titulo": "Orçamento aprovado", "texto": "Ana aprovou R$ 640,00 pelo link"},
             {"titulo": "Pagamento registrado", "texto": "Pix de R$ 670,00 · OS 6"},
             {"titulo": "Carro pronto", "texto": "Honda Civic · avisar o cliente"}]}),
    Cena("chamada", "Teste grátis por catorze dias, sem cartão. O link está na bio.",
         params={"titulo": "Sua oficina *no controle.*"}),
])

M02 = ReelMotion(2, "tres-sinais", [
    Cena("impacto", "Três sinais de que a sua oficina está perdendo dinheiro.",
         params={"sobre": "Presta atenção", "linhas": ["3 sinais de que", "sua oficina está", "*perdendo dinheiro.*"]}),
    Cena("lista", "Orçamento que ninguém cobrou. Cliente que não voltou para a revisão. E peça vendida sem saber quanto custou.",
         params={"titulo": "Os *3 sinais:*", "itens": [
             {"tipo": "nao", "texto": "Orçamento que ninguém cobrou"},
             {"tipo": "nao", "texto": "Cliente que não voltou para a revisão"},
             {"tipo": "nao", "texto": "Peça vendida sem saber o custo"}]}),
    Cena("impacto", "Não é falta de cliente. É falta de controle.",
         params={"linhas": ["Não é falta", "de cliente.", "É falta de *controle.*"], "tamanho": 140}),
    Cena("chamada", "Organize a sua oficina. Teste grátis por catorze dias, link na bio.",
         params={"titulo": "Controle que *cabe no bolso.*"}),
])

M03 = ReelMotion(3, "pov-aprovou", [
    Cena("impacto", "Imagina o cliente aprovar o orçamento enquanto você toma o seu café.",
         params={"sobre": "Imagina", "linhas": ["O cliente aprovou", "o orçamento", "enquanto você", "*tomava café.*"], "tamanho": 118}),
    Cena("celular", "Ele recebe o link, vê cada item com o preço e aprova pelo celular.",
         params={"cabecalho": "Avisos", "subcabecalho": "Auto Center do Marcos", "notificacoes": [
             {"titulo": "Orçamento aberto", "texto": "Camila abriu o link · Onix"},
             {"titulo": "Orçamento aprovado", "texto": "Camila aprovou R$ 770,00"}]}),
    Cena("impacto", "Sem ligação, sem áudio, sem esquecer.",
         params={"linhas": ["Sem ligação.", "Sem áudio.", "Sem *esquecer.*"], "tamanho": 150}),
    Cena("chamada", "Teste o OficinaOS de graça por catorze dias. O link está na bio.",
         params={"titulo": "Orçamento aprovado *pelo celular.*"}),
])

M04 = ReelMotion(4, "a-conta", [
    Cena("impacto", "Faz essa conta comigo.",
         params={"sobre": "Rapidinho", "linhas": ["Faz essa", "*conta* comigo."], "tamanho": 150}),
    Cena("numero", "Num exemplo: se um orçamento de oitocentos reais fica esquecido por semana, são três mil e duzentos reais por mês que não entram.",
         params={"sobre": "Um exemplo", "prefixo": "R$ ", "ate": 3200, "unidade": "por mês",
                 "rotulo": "1 orçamento de R$ 800 esquecido por semana"}),
    Cena("impacto", "O OficinaOS começa em cento e quarenta e nove reais por mês.",
         params={"linhas": ["O OficinaOS", "começa em", "*R$ 149* por mês."], "tamanho": 132}),
    Cena("chamada", "Faça a conta com os números da sua oficina. Teste grátis, link na bio.",
         params={"titulo": "Nenhum orçamento *esquecido.*"}),
])

M05 = ReelMotion(5, "antes-e-depois", [
    Cena("impacto", "A sua oficina, antes e depois.",
         params={"linhas": ["Sua oficina:", "*antes e depois.*"], "tamanho": 150}),
    Cena("contraste", "Orçamento por áudio, que o cliente esquece. Agora, um link que ele aprova no celular.",
         params={"antes": "Orçamento por áudio", "depois": "Link que o cliente aprova"}),
    Cena("contraste", "Fiado anotado no caderno. Agora, quem deve aparece na tela.",
         params={"antes": "Fiado no caderno", "depois": "Quem deve, na tela"}),
    Cena("contraste", "Discussão na entrega. Agora, foto na chegada do carro.",
         params={"antes": "Discussão na entrega", "depois": "Foto na chegada"}),
    Cena("chamada", "Teste grátis por catorze dias. O link está na bio.",
         params={"titulo": "Escolha o *depois.*"}),
])

M06 = ReelMotion(6, "mecanico-nao-secretario", [
    Cena("impacto", "Você é mecânico. Não é secretário.",
         params={"linhas": ["Você é", "*mecânico.*", "Não secretário."], "tamanho": 150}),
    Cena("lista", "Deixa o sistema lembrar o cliente da revisão, avisar quem não confirmou o horário e mostrar o que está acabando no estoque.",
         params={"titulo": "Deixa o *sistema* lembrar:", "itens": [
             {"tipo": "ok", "texto": "A revisão do cliente"},
             {"tipo": "ok", "texto": "Quem não confirmou o horário"},
             {"tipo": "ok", "texto": "A peça que está acabando"}]}),
    Cena("impacto", "E você volta a fazer o que sabe.",
         params={"linhas": ["E você volta", "para o *elevador.*"], "tamanho": 140}),
    Cena("chamada", "Teste o OficinaOS por catorze dias, sem cartão. Link na bio.",
         params={"titulo": "Menos papel, *mais carro.*"}),
])

M07 = ReelMotion(7, "quatorze-dias", [
    Cena("numero", "Catorze dias para testar o OficinaOS completo. De graça.",
         params={"sobre": "Teste grátis", "ate": 14, "unidade": "dias", "rotulo": "no plano completo"}),
    Cena("lista", "Sem cartão de crédito. Sem fidelidade. E os dados são seus, para levar quando quiser.",
         params={"titulo": "Sem *pegadinha:*", "itens": [
             {"tipo": "ok", "texto": "Sem cartão de crédito"},
             {"tipo": "ok", "texto": "Sem fidelidade"},
             {"tipo": "ok", "texto": "Seus dados são seus"}]}),
    Cena("chamada", "Cria a conta em dez minutos. O link está na bio.",
         params={"titulo": "Começa *hoje.*", "tamanho": 130}),
])

M08 = ReelMotion(8, "cliente-esquece", [
    Cena("impacto", "O seu cliente não some. Ele esquece.",
         params={"linhas": ["Seu cliente", "não some.", "Ele *esquece.*"], "tamanho": 150}),
    Cena("impacto", "E quem lembra primeiro leva o serviço.",
         params={"linhas": ["E quem lembra", "*primeiro*", "leva o serviço."], "tamanho": 132}),
    Cena("celular", "O OficinaOS monta toda manhã a lista de quem chamar, com a mensagem pronta.",
         params={"cabecalho": "Pós-venda de hoje", "subcabecalho": "Mensagem pronta para o WhatsApp", "notificacoes": [
             {"titulo": "Revisão vencendo", "texto": "Camila · Chevrolet Onix"},
             {"titulo": "Uma semana depois do serviço", "texto": "Bruno · Fiat Strada"},
             {"titulo": "Não volta há 6 meses", "texto": "Diego · Peugeot 208"}]}),
    Cena("chamada", "Teste grátis por catorze dias. O link está na bio.",
         params={"titulo": "Seja *lembrado.*", "tamanho": 130}),
])

M09 = ReelMotion(9, "oficina-pequena", [
    Cena("impacto", "Oficina pequena também merece sistema.",
         params={"linhas": ["Oficina *pequena*", "também merece", "sistema."], "tamanho": 132}),
    Cena("impacto", "E funciona no celular que você já tem.",
         params={"linhas": ["Funciona no", "*celular* que", "você já tem."], "tamanho": 140}),
    Cena("lista", "Sem instalar nada no computador, sem treinamento demorado, a partir de cento e quarenta e nove reais por mês.",
         params={"titulo": "Feito para a *sua* oficina:", "itens": [
             {"tipo": "ok", "texto": "Nada para instalar"},
             {"tipo": "ok", "texto": "Aulas de 1 minuto dentro do sistema"},
             {"tipo": "ok", "texto": "A partir de R$ 149 por mês"}]}),
    Cena("chamada", "Teste grátis por catorze dias. O link está na bio.",
         params={"titulo": "Do seu *tamanho.*", "tamanho": 130}),
])

M10 = ReelMotion(10, "cliente-julga", [
    Cena("impacto", "O seu cliente julga a oficina pelo orçamento.",
         params={"linhas": ["Seu cliente", "julga a oficina", "pelo *orçamento.*"], "tamanho": 136}),
    Cena("contraste", "Um áudio de dois minutos, ou um link com cada serviço, cada peça e o preço.",
         params={"antes": "Áudio de 2 minutos", "depois": "Cada item com o preço", "depoisTag": "COM O OFICINAOS"}),
    Cena("impacto", "Qual dos dois passa mais confiança?",
         params={"linhas": ["Qual passa", "mais *confiança?*"], "tamanho": 150}),
    Cena("chamada", "Mande orçamentos que vendem. Teste grátis, link na bio.",
         params={"titulo": "Orçamento que *vende.*", "tamanho": 130}),
])

MOTION = {r.numero: r for r in [M01, M02, M03, M04, M05, M06, M07, M08, M09, M10]}

if __name__ == "__main__":
    pedidos = sorted(MOTION) if sys.argv[1:] == ["todos"] else [int(x) for x in sys.argv[1:]]
    for n in pedidos:
        t = time.time()
        print(f"--- motion {n}: {MOTION[n].slug}", flush=True)
        rodar(MOTION[n])
        print(f"    ok em {time.time() - t:.0f}s", flush=True)
