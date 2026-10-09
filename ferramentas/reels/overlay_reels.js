// Camada visual dos Reels do OficinaOS (vídeo vertical 1080x1920).
// Mesma interface do overlay dos tutoriais (window.__tut), para as ações do
// motor funcionarem iguais. O sistema roda a 250%: a tela tem 432px de
// largura lógica, então ele aparece na versão de celular.
// Áreas que o Instagram cobre: ~240px no topo e ~420px embaixo, mais os
// botões na direita. Nada importante mora nelas.
(() => {
  if (window.top !== window) return;
  // a página roda como celular de verdade (432x768, densidade 2,5): o vídeo sai
  // em 1080x1920. A camada é desenhada em 1080x1920 e encolhida para caber;
  // as posições que o Playwright devolve (em 432x768) são multiplicadas por K
  const K = 2.5;
  const ZOOM = 1 / K;
  const aplicarZoom = () => {};

  const CSS = `
  #tut{position:fixed;left:0;top:0;width:1080px;height:1920px;zoom:${ZOOM};pointer-events:none;z-index:2147483000;font-family:Poppins,"Segoe UI",Arial,sans-serif}
  #tut *{box-sizing:border-box}
  .tut-card{position:fixed;left:0;top:0;width:1080px;height:1920px;background:#0A0A0B;color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 90px;opacity:0;transition:opacity .35s ease;overflow:hidden}
  .tut-card.on{opacity:1}
  .tut-card::before{content:"";position:absolute;right:-300px;top:-160px;width:900px;height:900px;border-radius:50%;border:120px solid #F26B1D;opacity:.16}
  .tut-card::after{content:"";position:absolute;left:-200px;bottom:-260px;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,#F26B1D44,transparent 70%)}
  .tut-logo{display:flex;align-items:center;gap:18px;font-weight:800;font-size:46px;margin-bottom:80px;position:relative;z-index:1}
  .tut-logo i{width:66px;height:66px;border-radius:16px;background:#F26B1D;display:grid;place-items:center}
  .tut-logo i::after{content:"";width:24px;height:24px;border:7px solid #fff;border-radius:50%}
  .tut-logo b{color:#F26B1D}
  .tut-eyebrow{font-size:38px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#F26B1D;margin-bottom:26px;position:relative;z-index:1}
  .tut-tit{font-size:104px;line-height:1.04;font-weight:800;letter-spacing:-.015em;position:relative;z-index:1}
  .tut-tit em{font-style:normal;color:#F26B1D}
  .tut-sub{font-size:46px;color:#C9C5BF;margin-top:44px;line-height:1.3;position:relative;z-index:1}
  .tut-cta{margin-top:70px;display:inline-flex;align-self:flex-start;background:#F26B1D;color:#0A0A0B;font-weight:800;font-size:50px;padding:28px 46px;border-radius:24px;position:relative;z-index:1}
  .tut-rod{margin-top:34px;font-size:38px;color:#8E8A84;display:flex;gap:30px;position:relative;z-index:1}
  .tut-rod b{color:#fff;font-weight:700}
  .tut-topo{position:fixed;left:60px;right:60px;top:250px;background:#0A0A0B;color:#fff;font-size:50px;line-height:1.15;font-weight:800;padding:26px 34px;border-radius:26px;opacity:0;transform:translateY(-16px);transition:opacity .3s,transform .3s;box-shadow:0 14px 40px rgba(0,0,0,.35)}
  .tut-topo span{color:#F26B1D}
  .tut-topo.on{opacity:0}
  .tut-leg{position:fixed;left:60px;right:150px;top:1250px;background:rgba(10,10,11,.9);color:#fff;font-size:50px;line-height:1.28;font-weight:600;padding:28px 36px 30px 44px;border-radius:26px;opacity:0;transform:translateY(18px);transition:opacity .25s,transform .25s;box-shadow:0 14px 44px rgba(0,0,0,.35)}
  .tut-leg::before{content:"";position:absolute;left:0;top:22px;bottom:22px;width:10px;border-radius:0 8px 8px 0;background:#F26B1D}
  .tut-leg.on{opacity:1;transform:none}
  .tut-leg.cima{top:300px}
  .tut-selo{display:none}
  .tut-cursor{position:fixed;left:0;top:0;width:70px;height:70px;transition:transform .6s cubic-bezier(.45,.05,.25,1);filter:drop-shadow(0 4px 6px rgba(0,0,0,.35));z-index:3}
  .tut-onda{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:8px solid #F26B1D;animation:tutOnda .6s ease-out forwards;z-index:2}
  @keyframes tutOnda{from{transform:scale(.4);opacity:1}to{transform:scale(3.4);opacity:0}}
  .tut-foco{position:fixed;border:8px solid #F26B1D;border-radius:24px;box-shadow:0 0 0 9999px rgba(10,10,11,.45);transition:all .4s ease;opacity:0}
  .tut-foco.on{opacity:1}
  .tut-cel,.tut-fundo{display:none}
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
      <div class="tut-cel"><div class="rot"></div><div class="tela"></div></div>
      <div class="tut-topo"></div>
      <div class="tut-leg"></div>
      <div class="tut-selo" hidden><i></i><span></span></div>
      <div class="tut-card"></div>
      <svg class="tut-cursor" viewBox="0 0 24 24"><path d="M4 2l15 10.5-6.6 1.2 3.9 7.3-3 1.6-3.9-7.4L4 19.5z" fill="#fff" stroke="#0A0A0B" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    document.documentElement.appendChild(raiz);
    const q = (s) => raiz.querySelector(s);
    q('.tut-cursor').style.transform = 'translate(900px,1500px)';
    let alvoY = 0; // altura (em 1920) da última coisa apontada
    const posicionar = () => q('.tut-leg').classList.toggle('cima', alvoY > 1050);
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    // *palavra* vira destaque laranja
    const marca = (t) => esc(t).replace(/\*([^*]+)\*/g, '<em>$1</em>');

    window.__tut = {
      card(html, on = true) {
        const c = q('.tut-card');
        if (html !== null) c.innerHTML = html;
        c.classList.toggle('on', on);
        q('.tut-cursor').style.opacity = on ? '0' : '1';
      },
      gancho(sobre, titulo) {
        this.card(`<div class="tut-logo"><i></i><span>Oficina<b>OS</b></span></div>
          ${sobre ? `<div class="tut-eyebrow">${esc(sobre)}</div>` : ''}
          <div class="tut-tit">${marca(titulo)}</div>`);
      },
      chamada(titulo, sub) {
        this.card(`<div class="tut-logo"><i></i><span>Oficina<b>OS</b></span></div>
          <div class="tut-tit">${marca(titulo)}</div>
          ${sub ? `<div class="tut-sub">${esc(sub)}</div>` : ''}
          <div class="tut-cta">Teste grátis · 14 dias</div>
          <div class="tut-rod"><b>Link na bio</b><span>oficinaosbr.cloud</span></div>`);
      },
      esconderCard() { this.card(null, false); },
      topo(t) {
        const e = q('.tut-topo');
        if (!t) { e.classList.remove('on'); return; }
        e.innerHTML = marca(t);
        e.classList.add('on');
      },
      legenda(t) {
        const l = q('.tut-leg');
        if (!t) { l.classList.remove('on'); return; }
        l.textContent = t;
        posicionar();
        l.classList.add('on');
      },
      selo() {},
      mover(x, y) { q('.tut-cursor').style.transform = `translate(${x * K - 10}px,${y * K - 6}px)`; alvoY = y * K; posicionar(); },
      onda(x, y) {
        const o = document.createElement('div');
        o.className = 'tut-onda';
        o.style.left = x * K + 'px'; o.style.top = y * K + 'px';
        raiz.appendChild(o);
        setTimeout(() => o.remove(), 700);
      },
      foco(r, pad = 14) {
        const f = q('.tut-foco');
        if (!r) { f.classList.remove('on'); return; }
        alvoY = (r.y + r.height / 2) * K; posicionar();
        Object.assign(f.style, { left: r.x * K - pad + 'px', top: r.y * K - pad + 'px', width: r.width * K + pad * 2 + 'px', height: r.height * K + pad * 2 + 'px' });
        f.classList.add('on');
      },
      celularUrl() {}, celularChat() {}, fecharCelular() {},
    };
  }

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
