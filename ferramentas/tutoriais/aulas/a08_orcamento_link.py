import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "motor"))
from motor import (Aula, cartao, Passo, clicar, celular_chat, celular_url, digitar, fechar_celular, focar, guardar,
                   marcar, no_celular, pausa, rodar, rolar, rolar_topo, ir)

WA = "() => new URL(window.__wa).searchParams.get('text')"


def mensagem(g):
    # o link real é o da máquina de teste; no celular aparece o endereço de produção
    return g.dados["wa"].replace("http://localhost:5173", "https://app.oficinaosbr.cloud")


def link_real(g):
    import re
    return re.search(r"http\S+/orcamento/\S+", g.dados["wa"]).group(0)


AULA = Aula(
    slug="orcamento-por-link",
    numero=8,
    modulo="Orçamento e aprovação",
    titulo="Orçamento por link: o cliente aprova pelo celular",
    subtitulo="Do botão Enviar até a OS aprovada, sem ligar para ninguém.",
    abertura_fala="Nesta aula, você vai mandar um orçamento por link e ver o cliente aprovar pelo celular.",
    inicio="/ordens/16",
    passos=[
        Passo(
            fala="Esta é a ordem de serviço do Gol da Ana. Os itens já estão lançados: a troca dos discos de freio e duas correias dentadas, somando seiscentos e quarenta reais.",
            legenda="Os itens já estão lançados na OS: R$ 640,00 no total.",
            acoes=[focar(cartao("Itens"))],
        ),
        Passo(
            fala="Para mandar o orçamento, toque em Enviar orçamento.",
            acoes=[focar(None), clicar(lambda p: p.get_by_role("button", name="Enviar orçamento"))],
        ),
        Passo(
            fala="O sistema mostra exatamente o que o cliente vai ver. Aqui você escolhe a validade e pode deixar um recado.",
            legenda="Você vê o que o cliente vai ver, escolhe a validade e deixa um recado.",
            acoes=[
                focar(lambda p: p.get_by_role("dialog")),
                pausa(0.6),
                focar(None),
                digitar(lambda p: p.get_by_role("dialog").locator("textarea").first,
                        "Ana, as peças chegam no mesmo dia. Qualquer dúvida, me chama!"),
            ],
        ),
        Passo(
            fala="Agora é só tocar em Gerar orçamento.",
            acoes=[clicar(lambda p: p.get_by_role("button", name="Gerar orçamento"), 1.2)],
        ),
        Passo(
            fala="Pronto. Toque em Enviar pelo WhatsApp: a mensagem já sai escrita, com o nome do cliente, o carro, o valor e o link.",
            legenda="Enviar pelo WhatsApp: a mensagem já sai pronta, com o link.",
            acoes=[
                guardar("_", "() => { window.open = (u) => { window.__wa = u; return null }; return true }"),
                clicar(lambda p: p.get_by_role("button", name="Enviar pelo WhatsApp")),
                guardar("wa", WA),
                celular_chat("Oficina Demonstração", mensagem),
            ],
        ),
        Passo(
            fala="No celular, o cliente só toca no link. Não precisa baixar aplicativo nem criar senha.",
            acoes=[pausa(1.6), celular_url(link_real)],
        ),
        Passo(
            fala="Ele vê cada serviço e cada peça, com o preço, e toca em Aprovar orçamento.",
            acoes=[
                rolar(no_celular(lambda b: b.get_by_text("Total", exact=True).first)),
                pausa(0.4),
                clicar(no_celular(lambda b: b.get_by_role("button", name="Aprovar orçamento"))),
            ],
        ),
        Passo(
            fala="Confirma com o nome, marca a autorização, e pronto.",
            acoes=[
                digitar(no_celular(lambda b: b.get_by_placeholder("Como a oficina te chama")), "Ana Paula"),
                marcar(no_celular(lambda b: b.get_by_role("checkbox"))),
                clicar(no_celular(lambda b: b.get_by_role("button", name="Confirmar aprovação")), 1.5),
            ],
        ),
        Passo(
            fala="E na sua tela, a OS muda sozinha para aprovada, com a data e a hora em que o cliente aprovou. Acabou aquela história de cliente dizendo que não autorizou o serviço.",
            legenda="A OS muda sozinha para Aprovada, com data e hora registradas.",
            acoes=[
                pausa(1.0),
                fechar_celular(),
                rolar_topo(),
                pausa(3.5),
                focar(lambda p: p.get_by_role("heading", level=1)),
                pausa(1.6),
                focar(lambda p: p.get_by_text("Aprovou tudo").first.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")),
            ],
        ),
    ],
    encerramento_titulo="Orçamento aprovado, sem ligar para ninguém.",
    encerramento_fala="Pronto! Agora você já manda orçamento por link. Na próxima aula: executar o serviço e avisar o cliente que o carro ficou pronto.",
    proxima="Executar o serviço e avisar que ficou pronto",
)

if __name__ == "__main__":
    rodar(AULA)
