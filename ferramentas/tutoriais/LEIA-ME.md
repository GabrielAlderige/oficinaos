# Tutoriais em vídeo: o motor que grava as aulas

As 24 aulas da aba **Tutoriais** são gravadas por este motor, sem ninguém na
frente da tela: ele abre o sistema no navegador, faz cada passo, narra com voz
neural em português e monta o MP4 em Full HD.

## Regravar uma aula (quando uma tela mudar)

Com o sistema rodando local (`npm run dev`, painel em `localhost:5173`):

```sh
pip install playwright edge-tts imageio-ffmpeg mutagen && python -m playwright install chromium
python ferramentas/tutoriais/aulas/curso.py 8        # uma aula
python ferramentas/tutoriais/aulas/curso.py todas    # o curso inteiro (uns 50 min)
```

Antes de cada aula a demo é recriada (`npm run db:seed:demo -- --reset --seed`),
porque as aulas mexem nela. O vídeo sai em `ferramentas/tutoriais/videos/`
(fora do git). Depois copie para a pasta `tutoriais/` da raiz e, se o título ou a
duração mudou, atualize `apps/api/scripts/tutoriais-aulas.ts` e rode
`npm run db:seed:tutoriais`.

## Como é feito

- `motor/motor.py`: cada passo tem uma FALA (narração + legenda) e AÇÕES
  (clicar, digitar, focar, celular...). O passo dura o que a fala dura. Grava
  em 1920x1080 com o sistema em zoom 125%.
- `motor/overlay.js`: a camada visual (abertura, legenda, cursor, foco laranja,
  celular do cliente). O endereço `localhost:5173` aparece como
  `app.oficinaosbr.com` na tela.
- `aulas/curso.py`: os roteiros das 24 aulas. O `preparo` de uma aula roda antes
  da gravação, numa janela sem vídeo (ex.: cadastrar a chave Pix).
- `ferramentas/`: `mapear.py` e `dialogo.py` listam os botões e campos de uma
  tela, para escrever um roteiro novo.

Armadilhas já resolvidas no motor: o login salvo não sobrevive a uma segunda
navegação (o token de renovação gira), então o motor entra numa janela sem vídeo
e fecha na hora; botões no pé de diálogo comprido às vezes não recebem o clique
com o zoom, e o motor aciona direto; campo preenchido é limpo antes de digitar.
