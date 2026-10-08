// Camada visual dos tutoriais do OficinaOS. Roda dentro da página gravada.
// Tudo que é do tutorial mora em #tut, que cancela o zoom de 125% do sistema:
// assim as coordenadas que o Playwright devolve (tela de 1920x1080) valem 1:1 aqui.
(() => {
  if (window.top !== window) return; // o celular é um iframe: nada de camada dentro dele
  const ZOOM = 1.25;
  const aplicarZoom = () => { document.documentElement.style.zoom = String(ZOOM); };

  const CSS = `
  #tut{position:fixed;inset:0;zoom:${1 / ZOOM};pointer-events:none;z-index:2147483000;font-family:Poppins,"Segoe UI",Arial,sans-serif}
  #tut *{box-sizing:border-box}
  .tut-card{position:fixed;left:0;top:0;width:1920px;height:1080px;background:#0A0A0B;color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 160px;opacity:0;transition:opacity .45s ease;overflow:hidden}
  .tut-card.on{opacity:1}
  .tut-card::before{content:"";position:absolute;right:-260px;top:-200px;width:900px;height:900px;border-radius:50%;border:120px solid #F26B1D;opacity:.16}
  .tut-card::after{content:"";position:absolute;right:120px;bottom:-320px;width:620px;height:620px;border-radius:50%;background:radial-gradient(circle,#F26B1D55,transparent 70%)}
  .tut-logo{display:flex;align-items:center;gap:18px;font-weight:800;font-size:40px;margin-bottom:70px}
  .tut-logo i{width:58px;height:58px;border-radius:14px;background:#F26B1D;display:grid;place-items:center}
  .tut-logo i::after{content:"";width:22px;height:22px;border:6px solid #fff;border-radius:50%}
  .tut-logo b{color:#F26B1D}
  .tut-mod{font-size:30px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#F26B1D;margin-bottom:18px}
  .tut-tit{font-size:96px;line-height:1.04;font-weight:800;max-width:1350px;letter-spacing:-.01em}
  .tut-sub{font-size:36px;color:#B9B5AF;margin-top:34px;max-width:1300px;line-height:1.35}
  .tut-rod{position:absolute;left:160px;bottom:70px;font-size:26px;color:#8E8A84;display:flex;gap:28px}
  .tut-rod b{color:#fff;font-weight:600}
  .tut-leg{position:fixed;left:50%;bottom:44px;transform:translate(-50%,20px);max-width:1500px;background:rgba(10,10,11,.88);color:#fff;font-size:36px;line-height:1.35;font-weight:500;padding:20px 38px 22px 44px;border-radius:18px;opacity:0;transition:opacity .25s,transform .25s;box-shadow:0 10px 40px rgba(0,0,0,.35);text-align:left}
  .tut-leg::before{content:"";position:absolute;left:0;top:16px;bottom:16px;width:8px;border-radius:0 6px 6px 0;background:#F26B1D}
  .tut-leg.on{opacity:1;transform:translate(-50%,0)}
  .tut-selo{position:fixed;right:28px;bottom:30px;background:#0A0A0B;color:#fff;font-size:20px;font-weight:600;padding:9px 16px;border-radius:999px;display:flex;gap:10px;align-items:center;opacity:.92}
  .tut-selo i{width:12px;height:12px;border-radius:50%;background:#F26B1D}
  .tut-cursor{position:fixed;left:0;top:0;width:44px;height:44px;transition:transform .7s cubic-bezier(.45,.05,.25,1);filter:drop-shadow(0 3px 5px rgba(0,0,0,.35));z-index:3}
  .tut-onda{position:fixed;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:5px solid #F26B1D;animation:tutOnda .6s ease-out forwards;z-index:2}
  @keyframes tutOnda{from{transform:scale(.4);opacity:1}to{transform:scale(3.2);opacity:0}}
  .tut-foco{position:fixed;border:5px solid #F26B1D;border-radius:16px;box-shadow:0 0 0 9999px rgba(10,10,11,.42);transition:all .45s ease;opacity:0}
  .tut-foco.on{opacity:1}
  .tut-cel{position:fixed;right:150px;top:50%;width:422px;height:892px;transform:translate(60px,-50%);opacity:0;transition:opacity .45s,transform .45s;background:#111;border-radius:58px;padding:16px;box-shadow:0 30px 80px rgba(0,0,0,.45),0 0 0 3px #2a2a2a}
  .tut-cel.on{opacity:1;transform:translate(0,-50%)}
  .tut-cel .tela{width:390px;height:860px;border-radius:44px;overflow:hidden;background:#fff;position:relative;pointer-events:none}
  .tut-cel.on .tela{pointer-events:auto}
  .tut-cel iframe{width:390px;height:860px;border:0;display:block}
  .tut-cel .rot{position:absolute;top:-58px;left:0;right:0;text-align:center;color:#fff;font-size:24px;font-weight:600;text-shadow:0 2px 8px rgba(0,0,0,.6)}
  .tut-fundo{position:fixed;inset:0;width:1920px;height:1080px;background:rgba(10,10,11,.55);opacity:0;transition:opacity .45s}
  .tut-fundo.on{opacity:1}
  .chat{height:100%;background:#ECE5DD;display:flex;flex-direction:column;font-family:"Segoe UI",Arial,sans-serif}
  .chat .topo{background:#1F6E5A;color:#fff;padding:52px 18px 14px;font-size:19px;font-weight:600;display:flex;gap:12px;align-items:center}
  .chat .topo i{width:38px;height:38px;border-radius:50%;background:#F26B1D;display:grid;place-items:center;font-style:normal;font-weight:800}
  .chat .msgs{padding:18px 14px;flex:1}
  .chat .bal{background:#fff;border-radius:12px;padding:12px 14px;font-size:16.5px;line-height:1.42;color:#111;white-space:pre-wrap;max-width:330px;box-shadow:0 1px 1px rgba(0,0,0,.12)}
  .chat .bal a{color:#1A73E8;word-break:break-all}
  .chat .hora{text-align:right;font-size:12px;color:#777;margin-top:4px}
  `;

  function montar() {
    if (document.getElementById('tut')) return;
    aplicarZoom();
    const fonte = document.createElement('link');
    fonte.rel = 'stylesheet';
    fonte.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700;800&display=swap';
    document.head.appendChild(fonte);
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    const raiz = document.createElement('div');
    raiz.id = 'tut';
    raiz.innerHTML = `
      <div class="tut-fundo"></div>
      <div class="tut-foco"></div>
      <div class="tut-cel"><div class="rot">Celular do cliente</div><div class="tela"></div></div>
      <div class="tut-leg"></div>
      <div class="tut-selo" hidden><i></i><span></span></div>
      <div class="tut-card"></div>
      <svg class="tut-cursor" viewBox="0 0 24 24"><path d="M4 2l15 10.5-6.6 1.2 3.9 7.3-3 1.6-3.9-7.4L4 19.5z" fill="#fff" stroke="#0A0A0B" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    document.documentElement.appendChild(raiz);
    const q = (s) => raiz.querySelector(s);
    let cx = 1700, cy = 900;
    q('.tut-cursor').style.transform = `translate(${cx}px,${cy}px)`;
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

    window.__tut = {
      card(html, on = true) {
        const c = q('.tut-card');
        if (html !== null) c.innerHTML = html;
        c.classList.toggle('on', on);
        q('.tut-cursor').style.opacity = on ? '0' : '1';
      },
      abertura(mod, num, tit, sub) {
        this.card(`<div class="tut-logo"><i></i><span>Oficina<b>OS</b></span></div>
          <div class="tut-mod">Aula ${num} · ${esc(mod)}</div><div class="tut-tit">${esc(tit)}</div>
          ${sub ? `<div class="tut-sub">${esc(sub)}</div>` : ''}
          <div class="tut-rod"><b>Tutoriais do OficinaOS</b><span>oficinaosbr.cloud</span></div>`);
      },
      encerramento(tit, proxima) {
        this.card(`<div class="tut-logo"><i></i><span>Oficina<b>OS</b></span></div>
          <div class="tut-mod">Pronto</div><div class="tut-tit">${esc(tit)}</div>
          ${proxima ? `<div class="tut-sub">Próxima aula: <b style="color:#fff">${esc(proxima)}</b></div>` : ''}
          <div class="tut-rod"><b>Dúvidas? (35) 99755-8675</b><span>oficinaosbr.cloud</span></div>`);
      },
      esconderCard() { this.card(null, false); },
      legenda(t) {
        const l = q('.tut-leg');
        if (!t) { l.classList.remove('on'); return; }
        l.textContent = t;
        l.classList.add('on');
      },
      selo(t) { const s = q('.tut-selo'); s.hidden = !t; s.querySelector('span').textContent = t || ''; },
      mover(x, y) { cx = x; cy = y; q('.tut-cursor').style.transform = `translate(${x - 6}px,${y - 4}px)`; },
      onda(x, y) {
        const o = document.createElement('div');
        o.className = 'tut-onda';
        o.style.left = x + 'px'; o.style.top = y + 'px';
        raiz.appendChild(o);
        setTimeout(() => o.remove(), 700);
      },
      foco(r, pad = 10) {
        const f = q('.tut-foco');
        if (!r) { f.classList.remove('on'); return; }
        Object.assign(f.style, { left: r.x - pad + 'px', top: r.y - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
        f.classList.add('on');
      },
      celularUrl(url, rotulo) {
        q('.tut-cel .rot').textContent = rotulo || 'Celular do cliente';
        q('.tut-cel .tela').innerHTML = `<iframe src="${url}"></iframe>`;
        q('.tut-cel').classList.add('on'); q('.tut-fundo').classList.add('on');
      },
      celularChat(contato, texto, rotulo) {
        q('.tut-cel .rot').textContent = rotulo || 'Celular do cliente';
        const corpo = esc(texto).replace(/(https?:\/\/\S+)/g, '<a>$1</a>');
        q('.tut-cel .tela').innerHTML = `<div class="chat"><div class="topo"><i>O</i>${esc(contato)}</div>
          <div class="msgs"><div class="bal">${corpo}<div class="hora">agora</div></div></div></div>`;
        q('.tut-cel').classList.add('on'); q('.tut-fundo').classList.add('on');
      },
      fecharCelular() { q('.tut-cel').classList.remove('on'); q('.tut-fundo').classList.remove('on'); },
    };
  }

  // o endereço da máquina de teste nunca aparece no vídeo: mostra o de produção
  const DE = 'http://localhost:5173', PARA = 'https://app.oficinaosbr.cloud';
  function trocarTextos(no) {
    if (!no) return;
    if (no.nodeType === 3) { if (no.nodeValue.includes(DE)) no.nodeValue = no.nodeValue.split(DE).join(PARA); return; }
    const w = document.createTreeWalker(no, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) if (t.nodeValue.includes(DE)) t.nodeValue = t.nodeValue.split(DE).join(PARA);
  }
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'characterData') trocarTextos(m.target);
      for (const n of m.addedNodes) trocarTextos(n);
    }
  }).observe(document, { childList: true, subtree: true, characterData: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
