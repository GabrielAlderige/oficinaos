"""Abre uma rota, clica em botões em sequência e lista o que aparece.
Uso: python dialogo.py rota "Botão 1" ["Botão 2" ...]   (prefixo t: clica num texto, l: num link)"""
import asyncio, re, sys, os
from playwright.async_api import async_playwright

BASE = "http://localhost:5173"
OUT = os.path.join(os.path.dirname(__file__), "..", "tmp", "mapa")
USUARIO = os.environ.get("OOS_USER", "demo@oficinaos.dev")


def limpa(xs):
    return [re.sub(r"\s+", " ", x).strip() for x in xs if x and x.strip()]


async def main():
    rota, cliques = sys.argv[1], sys.argv[2:]
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1536, "height": 864})
        await pg.goto(BASE + "/entrar")
        await pg.get_by_label(re.compile("e-mail", re.I)).fill(USUARIO)
        await pg.get_by_label(re.compile("senha", re.I)).first.fill("demonstracao2026")
        await pg.get_by_role("button", name=re.compile("entrar", re.I)).click()
        await pg.wait_for_url(re.compile(r"^(?!.*entrar).*$"), timeout=20000)
        await pg.goto(BASE + "/" + rota.lstrip("/"))
        await pg.wait_for_timeout(2000)
        for c in cliques:
            if c.startswith("t:"):
                await pg.get_by_text(c[2:], exact=False).first.click()
            elif c.startswith("l:"):
                await pg.get_by_role("link", name=c[2:]).first.click()
            else:
                await pg.get_by_role("button", name=c, exact=True).first.click()
            await pg.wait_for_timeout(1500)
        alvo = pg.get_by_role("dialog")
        escopo = alvo if await alvo.count() else pg.locator("main")
        print("ONDE:", "dialog" if await alvo.count() else "main", pg.url)
        print("TEXTO:", re.sub(r"\s+", " ", (await escopo.first.inner_text()))[:1500])
        print("BOT:", " | ".join(limpa(await escopo.first.get_by_role("button").all_inner_texts())[:40]))
        print("LABEL:", " | ".join(limpa(await escopo.first.locator("label").all_inner_texts())[:40]))
        ph = [await i.get_attribute("placeholder") for i in await escopo.first.locator("input[placeholder],textarea[placeholder]").all()]
        print("PH:", " | ".join(x for x in ph if x))
        nome = re.sub(r"[^a-z0-9]+", "_", (rota + "_" + "_".join(cliques)).lower()).strip("_")[:80]
        await pg.screenshot(path=os.path.join(OUT, "d_" + nome + ".png"))
        await b.close()

asyncio.run(main())
