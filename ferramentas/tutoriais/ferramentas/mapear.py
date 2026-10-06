"""Mapeia as telas do sistema para escrever os roteiros: títulos, botões, campos e abas."""
import asyncio, re, sys, os
from playwright.async_api import async_playwright

BASE = "http://localhost:5173"
ROTAS = sys.argv[1].split(",")
USUARIO = sys.argv[2] if len(sys.argv) > 2 else "demo@oficinaos.dev"
OUT = os.path.join(os.path.dirname(__file__), "..", "tmp", "mapa")


def limpa(xs):
    return [re.sub(r"\s+", " ", x).strip() for x in xs if x and x.strip()]


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1536, "height": 864})
        await pg.goto(BASE + "/entrar")
        await pg.get_by_label(re.compile("e-mail", re.I)).fill(USUARIO)
        await pg.get_by_label(re.compile("senha", re.I)).first.fill("demonstracao2026")
        await pg.get_by_role("button", name=re.compile("entrar", re.I)).click()
        await pg.wait_for_url(re.compile(r"^(?!.*entrar).*$"), timeout=20000)
        relatorio = []
        for rota in ROTAS:
            await pg.goto(BASE + "/" + rota.lstrip("/"))
            await pg.wait_for_timeout(2200)
            main = pg.locator("main")
            r = [f"===== /{rota}  ({pg.url})"]
            r.append("H: " + " | ".join(limpa(await main.locator("h1,h2,h3").all_inner_texts())))
            r.append("BOT: " + " | ".join(limpa(await main.get_by_role("button").all_inner_texts())[:50]))
            r.append("TAB: " + " | ".join(limpa(await main.get_by_role("tab").all_inner_texts())))
            r.append("LINK: " + " | ".join(limpa(await main.get_by_role("link").all_inner_texts())[:30]))
            labs = limpa(await main.locator("label").all_inner_texts())[:30]
            r.append("LABEL: " + " | ".join(labs))
            ph = [await i.get_attribute("placeholder") for i in await main.locator("input[placeholder],textarea[placeholder]").all()]
            r.append("PH: " + " | ".join(x for x in ph if x))
            relatorio.append("\n".join(r))
            nome = re.sub(r"[^a-z0-9]+", "_", rota.lower()).strip("_") or "inicio"
            await pg.screenshot(path=os.path.join(OUT, nome + ".png"), full_page=True)
        open(os.path.join(OUT, "mapa.txt"), "a", encoding="utf-8").write("\n\n".join(relatorio) + "\n\n")
        await b.close()

asyncio.run(main())
