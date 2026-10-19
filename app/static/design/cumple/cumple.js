/* Cumpleaños (Rosember, 19-oct-2026): la pieza de Canva «¡Feliz Cumpleaños!» de Nuvia, generada con la foto de perfil,
   el nombre y el cargo de cada persona. Fondo, globos, logo, cursiva y mensaje salen de las piezas originales
   (static/design/cumple/fondo.jpg y cursiva.png, extraídos de «CUMPLEAÑOS OCTUBRE»); solo cambian foto, nombre y cargo.
   Lo usan Parameters › Formatos Canva › Cumpleaños (vista y descarga) y el anuncio animado del día (anunciar).

   DSCumple.dibujar(canvas, {foto, nombre, cargo})  → Promise (1080 × 1350, como Instagram)
   DSCumple.anunciar(personas, {alCerrar})          → anuncio a pantalla completa (carrusel si son varias)        */
(function () {
  'use strict';
  if (window.DSCumple) return;
  var BASE = '/static/design/cumple/';
  var V = (document.currentScript && (document.currentScript.src.split('?v=')[1] || '')) || '1';
  var W = 1080, H = 1350;
  var OVALO = {cx: 554.5, cy: 490, rx: 257, ry: 280};      // medido en las piezas de Canva
  var NOMBRE = {y: 850, tam: 58, max: 860};                 // Poppins Bold, como en Canva
  var CARGO = {y: 928, tam: 58, max: 880};

  function img(src) {
    return new Promise(function (ok, mal) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = function () { mal(new Error('No cargó ' + src)); }; i.src = src; });
  }
  var piezas = null, fuentes = null;
  function base() { return piezas || (piezas = Promise.all([img(BASE + 'fondo.jpg?v=' + V), img(BASE + 'cursiva.png?v=' + V)])); }
  function cargarFuentes() {
    if (fuentes) return fuentes;
    if (!document.querySelector('link[data-cumple-fuente]')) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.cumpleFuente = '1';
      l.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&display=swap'; document.head.appendChild(l);
    }
    fuentes = (document.fonts && document.fonts.load ? document.fonts.load('700 58px Poppins') : Promise.resolve()).catch(function () {});
    return fuentes;
  }
  function ajustar(ctx, texto, max, tam) {
    var t = tam;
    do { ctx.font = '700 ' + t + 'px Poppins, "Segoe UI", Arial, sans-serif'; if (ctx.measureText(texto).width <= max) break; t -= 2; } while (t > 26);
  }
  function dibujar(canvas, d) {
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    return Promise.all([base(), img(d.foto), cargarFuentes()]).then(function (r) {
      var fondo = r[0][0], cursiva = r[0][1], foto = r[1];
      ctx.drawImage(fondo, 0, 0, W, H);
      // Foto dentro del óvalo: lo llena (sin bordes), un poco más arriba del centro para no cortar la cara
      ctx.save();
      ctx.beginPath(); ctx.ellipse(OVALO.cx, OVALO.cy, OVALO.rx, OVALO.ry, 0, 0, Math.PI * 2); ctx.closePath();
      ctx.fillStyle = '#f4f4f2'; ctx.fill(); ctx.clip();
      var s = Math.max(2 * OVALO.rx / foto.naturalWidth, 2 * OVALO.ry / foto.naturalHeight);
      var fw = foto.naturalWidth * s, fh = foto.naturalHeight * s;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(foto, OVALO.cx - fw / 2, OVALO.cy - OVALO.ry - Math.max(0, fh - 2 * OVALO.ry) * 0.2, fw, fh);
      ctx.restore();
      ctx.drawImage(cursiva, 0, 0, W, H);   // «¡Feliz Cumpleaños!» va encima de la foto, como en Canva
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      var nombre = String(d.nombre || '').toUpperCase(), cargo = String(d.cargo || '').toUpperCase();
      ajustar(ctx, nombre, NOMBRE.max, NOMBRE.tam); ctx.fillText(nombre, W / 2, NOMBRE.y);
      if (cargo) { ajustar(ctx, cargo, CARGO.max, CARGO.tam); ctx.fillText(cargo, W / 2, CARGO.y); }
      return canvas;
    });
  }

  // ---------- Anuncio del día (animado) ----------
  var css = null;
  function estilos() {
    if (css) return;
    css = document.createElement('style');
    css.textContent = [
      '.cu-capa{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;overflow:hidden;',
      ' background:radial-gradient(ellipse at 50% 45%,rgba(30,58,110,.92),rgba(3,6,16,.97) 70%);backdrop-filter:blur(6px);animation:cuEntra .5s ease both;font-family:Poppins,system-ui,sans-serif}',
      '.cu-capa.sale{animation:cuSale .45s ease both}',
      '.cu-rayos{position:absolute;width:160vmax;height:160vmax;left:50%;top:48%;transform:translate(-50%,-50%);opacity:.22;pointer-events:none;',
      ' background:repeating-conic-gradient(from 0deg,rgba(250,204,21,.55) 0deg 6deg,transparent 6deg 18deg);animation:cuGira 40s linear infinite;',
      ' -webkit-mask:radial-gradient(circle,#000 0,transparent 60%);mask:radial-gradient(circle,#000 0,transparent 60%)}',
      '.cu-foco{position:absolute;width:70vmin;height:70vmin;left:50%;top:48%;transform:translate(-50%,-50%);border-radius:50%;',
      ' background:radial-gradient(circle,rgba(255,236,170,.35),transparent 65%);animation:cuLate 3s ease-in-out infinite;pointer-events:none}',
      '.cu-cab{position:absolute;top:max(14px,3vh);left:0;right:0;text-align:center;color:#fde68a;font-weight:700;font-size:clamp(16px,2.4vw,26px);letter-spacing:.02em;',
      ' text-shadow:0 2px 16px rgba(0,0,0,.6);animation:cuBaja .8s .2s cubic-bezier(.2,1.4,.4,1) both;padding:0 60px}',
      '.cu-escena{position:relative;width:min(92vw,calc((100vh - 140px) * .8),620px);aspect-ratio:4/5;perspective:1400px}',
      '.cu-pieza{position:absolute;inset:0;transition:transform .9s cubic-bezier(.2,.9,.25,1),opacity .7s ease,filter .7s ease}',
      '.cu-pieza canvas{width:100%;height:100%;display:block;border-radius:18px;box-shadow:0 30px 90px rgba(0,0,0,.65),0 0 0 2px rgba(250,204,21,.45),0 0 60px rgba(250,204,21,.25)}',
      '.cu-pieza.activa{animation:cuAparece 1.1s cubic-bezier(.2,1.25,.35,1) both}',
      '.cu-pieza.antes{transform:translateX(-62%) scale(.72) rotateY(28deg);opacity:.35;filter:blur(2px) brightness(.6)}',
      '.cu-pieza.despues{transform:translateX(62%) scale(.72) rotateY(-28deg);opacity:.35;filter:blur(2px) brightness(.6)}',
      '.cu-pieza.oculta{opacity:0;transform:scale(.6);pointer-events:none}',
      '.cu-cerrar{position:absolute;top:14px;right:16px;z-index:3;width:44px;height:44px;border-radius:50%;border:0;cursor:pointer;font-size:22px;color:#fff;',
      ' background:rgba(255,255,255,.14);backdrop-filter:blur(4px);transition:background .2s,transform .2s}',
      '.cu-cerrar:hover,.cu-cerrar:focus-visible{background:rgba(255,255,255,.28);transform:rotate(90deg);outline:none}',
      '.cu-flecha{position:absolute;top:50%;z-index:3;width:48px;height:48px;margin-top:-24px;border-radius:50%;border:0;cursor:pointer;font-size:26px;color:#fff;background:rgba(255,255,255,.14)}',
      '.cu-flecha:hover,.cu-flecha:focus-visible{background:rgba(255,255,255,.3);outline:none}.cu-ant{left:max(10px,2vw)}.cu-sig{right:max(10px,2vw)}',
      '.cu-puntos{position:absolute;bottom:max(14px,2.5vh);left:0;right:0;display:flex;gap:10px;justify-content:center;z-index:3}',
      '.cu-puntos button{width:11px;height:11px;border-radius:50%;border:0;padding:0;background:rgba(255,255,255,.35);cursor:pointer;transition:all .3s}',
      '.cu-puntos button.on{background:#facc15;width:28px;border-radius:6px}',
      '.cu-ayuda{position:absolute;bottom:max(36px,5vh);left:0;right:0;text-align:center;color:rgba(255,255,255,.55);font-size:12px}',
      '.cu-confeti{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2}',
      '.cu-confeti i{position:absolute;top:-16px;width:9px;height:14px;border-radius:2px;animation:cuCae var(--d) cubic-bezier(.25,.6,.6,1) var(--t) forwards}',
      '.cu-globo{position:absolute;bottom:-140px;width:70px;height:88px;border-radius:50% 50% 48% 48%;pointer-events:none;opacity:.9;animation:cuSube var(--d) ease-in var(--t) forwards;z-index:1}',
      '.cu-globo::after{content:"";position:absolute;left:50%;top:100%;width:1px;height:70px;background:rgba(255,255,255,.4)}',
      '@keyframes cuEntra{from{opacity:0}}@keyframes cuSale{to{opacity:0;transform:scale(1.04)}}',
      '@keyframes cuGira{to{transform:translate(-50%,-50%) rotate(360deg)}}@keyframes cuLate{50%{transform:translate(-50%,-50%) scale(1.12);opacity:.8}}',
      '@keyframes cuBaja{from{opacity:0;transform:translateY(-30px) scale(.9)}}',
      '@keyframes cuAparece{0%{opacity:0;transform:scale(.4) rotate(-8deg) translateY(60px)}60%{opacity:1;transform:scale(1.05) rotate(1.5deg)}100%{transform:none}}',
      '@keyframes cuCae{to{transform:translate(var(--x),var(--h)) rotate(var(--r));opacity:.15}}',
      '@keyframes cuSube{to{transform:translate(var(--x),-130vh) rotate(var(--r))}}',
      '@media (prefers-reduced-motion:reduce){.cu-capa,.cu-rayos,.cu-foco,.cu-cab,.cu-pieza.activa,.cu-confeti i,.cu-globo{animation:none!important}.cu-confeti,.cu-globo{display:none}}'
    ].join('\n');
    document.head.appendChild(css);
  }
  var COLORES = ['#facc15', '#f59e0b', '#3b82f6', '#1d4ed8', '#ffffff', '#fde68a', '#60a5fa'];
  function fiesta(capa) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var c = document.createElement('div'); c.className = 'cu-confeti';
    for (var i = 0; i < 90; i++) {
      var p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%'; p.style.background = COLORES[i % COLORES.length];
      p.style.setProperty('--x', (Math.random() * 200 - 100).toFixed(0) + 'px'); p.style.setProperty('--h', (innerHeight + 60) + 'px');
      p.style.setProperty('--r', (Math.random() * 900 - 450).toFixed(0) + 'deg'); p.style.setProperty('--d', (2.4 + Math.random() * 2.2).toFixed(2) + 's');
      p.style.setProperty('--t', (Math.random() * 1.2).toFixed(2) + 's'); if (i % 4 === 0) p.style.borderRadius = '50%';
      c.appendChild(p);
    }
    capa.appendChild(c);
    for (var g = 0; g < 9; g++) {
      var b = document.createElement('span'); b.className = 'cu-globo';
      b.style.left = (g < 5 ? Math.random() * 22 : 78 + Math.random() * 20) + '%';
      b.style.background = 'radial-gradient(circle at 32% 28%,rgba(255,255,255,.75),' + (g % 2 ? '#d4a017' : '#1e40af') + ' 45%,' + (g % 2 ? '#8a6408' : '#0b1f5c') + ')';
      b.style.setProperty('--x', (Math.random() * 80 - 40).toFixed(0) + 'px'); b.style.setProperty('--r', (Math.random() * 30 - 15).toFixed(0) + 'deg');
      b.style.setProperty('--d', (6 + Math.random() * 4).toFixed(1) + 's'); b.style.setProperty('--t', (Math.random() * 1.5).toFixed(2) + 's');
      capa.appendChild(b);
    }
    setTimeout(function () { c.remove(); }, 6500);
  }

  function anunciar(personas, op) {
    op = op || {};
    if (!personas || !personas.length || document.querySelector('.cu-capa')) return;
    estilos();
    var capa = document.createElement('div');
    capa.className = 'cu-capa'; capa.setAttribute('role', 'dialog'); capa.setAttribute('aria-modal', 'true');
    var n = personas.length;
    capa.setAttribute('aria-label', n === 1 ? 'Hoy cumple años ' + personas[0].nombre : 'Hoy cumplen años ' + n + ' personas');
    capa.innerHTML = '<div class="cu-rayos"></div><div class="cu-foco"></div>' +
      '<div class="cu-cab">' + (op.titulo || ('🎉 ' + (n === 1 ? '¡Hoy celebramos a alguien especial!' : '¡Hoy celebramos a ' + n + ' personas!') + ' 🎉')) + '</div>' +
      '<button type="button" class="cu-cerrar" aria-label="Cerrar (Esc)" title="Cerrar (Esc)">✕</button>' +
      '<div class="cu-escena"></div>' +
      (n > 1 ? '<button type="button" class="cu-flecha cu-ant" aria-label="Anterior">‹</button><button type="button" class="cu-flecha cu-sig" aria-label="Siguiente">›</button><div class="cu-puntos"></div>' : '') +
      '<div class="cu-ayuda">Esc o ✕ para cerrar</div>';
    document.body.appendChild(capa);
    var escena = capa.querySelector('.cu-escena'), puntos = capa.querySelector('.cu-puntos');
    var piezasEl = personas.map(function (p, i) {
      var d = document.createElement('div'); d.className = 'cu-pieza oculta';
      var cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', '¡Feliz cumpleaños, ' + p.nombre + '! ' + (p.cargo || ''));
      d.appendChild(cv); escena.appendChild(d);
      dibujar(cv, p).catch(function () { d.remove(); });
      if (puntos) {
        var b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', p.nombre);
        b.onclick = function () { ir(i, true); }; puntos.appendChild(b);
      }
      return d;
    });
    var actual = -1, temporizador = null;
    function ir(i, manual) {
      i = (i + n) % n;
      piezasEl.forEach(function (el, k) {
        el.className = 'cu-pieza ' + (k === i ? 'activa' : n > 1 && k === (i - 1 + n) % n ? 'antes' : n > 1 && k === (i + 1) % n ? 'despues' : 'oculta');
      });
      if (puntos) Array.prototype.forEach.call(puntos.children, function (b, k) { b.classList.toggle('on', k === i); });
      if (i !== actual) fiesta(capa);
      actual = i;
      clearInterval(temporizador);
      if (n > 1) temporizador = setInterval(function () { ir(actual + 1); }, manual ? 9000 : 6500);   // el carrusel avanza solo
    }
    function cerrar() {
      clearInterval(temporizador);
      document.removeEventListener('keydown', teclas, true);
      capa.classList.add('sale');
      setTimeout(function () { capa.remove(); }, 450);
      if (op.alCerrar) op.alCerrar();
    }
    function teclas(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); }
      else if (n > 1 && e.key === 'ArrowRight') ir(actual + 1, true);
      else if (n > 1 && e.key === 'ArrowLeft') ir(actual - 1, true);
    }
    capa.querySelector('.cu-cerrar').onclick = cerrar;
    if (n > 1) { capa.querySelector('.cu-ant').onclick = function () { ir(actual - 1, true); }; capa.querySelector('.cu-sig').onclick = function () { ir(actual + 1, true); }; }
    escena.addEventListener('click', function (e) { var el = e.target.closest('.cu-pieza'); if (el && (el.classList.contains('antes') || el.classList.contains('despues'))) ir(piezasEl.indexOf(el), true); });
    document.addEventListener('keydown', teclas, true);
    capa.querySelector('.cu-cerrar').focus();
    ir(0);
    return {cerrar: cerrar};
  }

  window.DSCumple = {dibujar: dibujar, anunciar: anunciar, OVALO: OVALO};
})();
