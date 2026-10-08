/* Carruseles especiales de la página de Inicio de Design:
   - Cover Flow 3D (como iTunes / Finder): la foto del centro de frente y grande, las de los lados inclinadas en 3D con reflejo.
   - Foto grande + tira (como Fotos / Apple TV): la foto elegida arriba y una tira de miniaturas que avanza sola.
   - Fila que fluye (como el Dock del Mac): fotos pequeñas que pasan sin parar y crecen al pasar el mouse.
   Cada foto respeta su encuadre (Ajustar) y se puede elegir con el mouse, el teclado o arrastrando. */
(function() {
  'use strict';
  var NVI = window.NVI, h = NVI.h;
  var C = NVI.CARRUSELES = {};
  var reducido = function() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  function lista(p) { var l = p.items && p.items.length ? p.items : [{src: NVI.placeholder('Agrega fotos')}]; return l; }
  function foto(it, i, cls) {
    var d = h('div', cls); d.style.backgroundImage = 'url("' + (NVI.src(it.src) || NVI.placeholder()).replace(/"/g, '%22') + '")';
    d.style.backgroundSize = 'cover'; NVI.aplicarEnc(d, it.srcEnc, true); d.setAttribute('data-enc', 'items.' + i + '.src');
    return d;
  }
  function abrir(it, l, i, ctx) {
    if (ctx.modo === 'editar') return;
    if (it.enlace) { var u = NVI.url(it.enlace); if (/^\//.test(u)) location.href = u; else window.open(u, '_blank', 'noopener'); return; }
    NVI.lightbox(l.map(function(x) { return {src: NVI.src(x.src) || NVI.placeholder(), titulo: x.titulo}; }), i);
  }
  // pasa solo cada N segundos; se pausa con el mouse encima o con la pestaña oculta
  function autoplay(w, p, ctx, siguiente) {
    if (!(+p.intervalo > 0) || ctx.modo === 'editar') return;
    var pausa = false; w.addEventListener('mouseenter', function() { pausa = true; }); w.addEventListener('mouseleave', function() { pausa = false; });
    var t = setInterval(function() { if (!w.isConnected) { clearInterval(t); return; } if (!pausa && !document.hidden) siguiente(); }, p.intervalo * 1000);
  }
  // arrastrar con el mouse o el dedo para pasar fotos
  function arrastrable(w, paso, alPasar) {
    var x0 = null, acum = 0, movio = false;
    w.addEventListener('pointerdown', function(e) { if (e.button !== 0) return; x0 = e.clientX; acum = 0; movio = false; });
    w.addEventListener('pointermove', function(e) { if (x0 == null) return; var dx = e.clientX - x0; if (Math.abs(dx) > paso) { alPasar(dx < 0 ? 1 : -1); x0 = e.clientX; movio = true; } });
    var fin = function() { x0 = null; }; w.addEventListener('pointerup', fin); w.addEventListener('pointerleave', fin);
    w.addEventListener('click', function(e) { if (movio) { e.stopPropagation(); e.preventDefault(); movio = false; } }, true);
  }
  function teclado(w, ir) {
    w.tabIndex = 0;
    w.addEventListener('keydown', function(e) { if (e.key === 'ArrowRight') { e.preventDefault(); ir(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); ir(-1); } });
  }

  // ---------- Cover Flow 3D ----------
  C.coverflow = function(p, ctx) {
    var l = lista(p), n = l.length, alto = +p.alto || 420;
    var w = h('div', 'nvi-cf'); w.style.height = alto + 'px'; w.style.borderRadius = (p.radio || 0) + 'px';
    var esc = h('div', 'nvi-cf-escena'); w.appendChild(esc);
    var cap = h('div', 'nvi-cf-cap'); w.appendChild(cap);
    var actual = Math.min(n - 1, Math.floor(n / 2)), els = [];
    l.forEach(function(it, i) {
      var c = h('div', 'nvi-cf-it'); c.appendChild(foto(it, i, 'nvi-cf-foto'));
      c.onclick = function() { if (i !== actual) ir(i - actual); else abrir(it, l, i, ctx); };
      esc.appendChild(c); els.push(c);
    });
    var medir = function() {
      var W = w.clientWidth || 900, S = Math.min(alto * 0.62, W * 0.42);
      w.style.setProperty('--cf-s', S + 'px');
      els.forEach(function(c, k) {
        var o = k - actual, a = Math.abs(o), sg = o < 0 ? -1 : 1;
        c.style.zIndex = 100 - a; c.classList.toggle('on', o === 0);
        c.style.opacity = a > 5 ? 0 : 1; c.style.pointerEvents = a > 5 ? 'none' : '';
        c.style.transform = o === 0 ? 'translateX(-50%) translateZ(' + Math.round(S * 0.18) + 'px)'
          : 'translateX(calc(-50% + ' + Math.round(sg * (S * 0.62 + (a - 1) * S * 0.24)) + 'px)) translateZ(' + Math.round(-S * 0.25) + 'px) rotateY(' + (-sg * 62) + 'deg)';
      });
      var it = l[actual] || {};
      cap.innerHTML = (it.titulo ? '<b>' + NVI.esc(it.titulo) + '</b>' : '') + (it.texto ? '<span>' + NVI.esc(it.texto) + '</span>' : '');
      puntos.forEach(function(d, k) { d.classList.toggle('on', k === actual); });
    };
    var ir = function(paso) { actual = Math.max(0, Math.min(n - 1, actual + paso)); medir(); };
    var siguiente = function() { actual = actual >= n - 1 ? 0 : actual + 1; medir(); };
    var puntos = [];
    if (n > 1 && p.flechas !== false) { ['izq', 'der'].forEach(function(lado) { var b = h('button', 'nvi-car-flecha ' + lado, lado === 'izq' ? '‹' : '›'); b.type = 'button'; b.setAttribute('aria-label', lado === 'izq' ? 'Anterior' : 'Siguiente'); b.onclick = function(e) { e.stopPropagation(); ir(lado === 'izq' ? -1 : 1); }; w.appendChild(b); }); }
    if (n > 1 && p.puntos !== false) { var ds = h('div', 'nvi-car-puntos'); l.forEach(function(it, i) { var d = h('button'); d.type = 'button'; d.setAttribute('aria-label', 'Foto ' + (i + 1)); d.onclick = function(e) { e.stopPropagation(); actual = i; medir(); }; puntos.push(d); ds.appendChild(d); }); w.appendChild(ds); }
    // rueda horizontal del trackpad (la vertical sigue bajando la página)
    var tR = 0; w.addEventListener('wheel', function(e) { if (Math.abs(e.deltaX) < Math.abs(e.deltaY) || Math.abs(e.deltaX) < 8) return; e.preventDefault(); var t = Date.now(); if (t - tR < 170) return; tR = t; ir(e.deltaX > 0 ? 1 : -1); }, {passive: false});
    arrastrable(w, 60, ir); teclado(w, ir); autoplay(w, p, ctx, siguiente);
    if ('ResizeObserver' in window) new ResizeObserver(medir).observe(w);
    setTimeout(medir, 0); medir();
    return w;
  };

  // ---------- Foto grande + tira de miniaturas ----------
  C.tira = function(p, ctx) {
    var l = lista(p), n = l.length, alto = +p.alto || 460, th = Math.max(56, Math.min(110, Math.round(alto * 0.2)));
    var w = h('div', 'nvi-tira'); w.style.height = alto + 'px'; w.style.setProperty('--tira-h', th + 'px'); w.style.borderRadius = (p.radio || 0) + 'px';
    var hero = h('div', 'nvi-tira-hero'), strip = h('div', 'nvi-tira-strip'), barra = h('div', 'nvi-tira-barra'), pr = h('i'); barra.appendChild(pr);
    w.appendChild(hero); w.appendChild(barra); w.appendChild(strip);
    var actual = 0, capas = [], thumbs = [];
    l.forEach(function(it, i) {
      var c = h('div', 'nvi-tira-capa'); var f = foto(it, i, 'nvi-tira-foto' + (p.zoomLento ? ' lento' : '')); c.appendChild(f);
      var sombra = h('div', 'nvi-car-capa'); sombra.style.background = 'linear-gradient(0deg, rgba(0,0,0,' + ((p.oscurecer || 0) / 100 + 0.2) + '), rgba(0,0,0,0) 60%)'; c.appendChild(sombra);
      if (it.titulo || it.texto) { var t = h('div', 'nvi-car-txt'); if (it.titulo) t.appendChild(h('h3', '', NVI.esc(it.titulo))); if (it.texto) t.appendChild(h('p', '', NVI.esc(it.texto))); c.appendChild(t); }
      c.onclick = function() { abrir(it, l, i, ctx); };
      hero.appendChild(c); capas.push(c);
      var tb = h('button', 'nvi-tira-th'); tb.type = 'button'; tb.setAttribute('aria-label', it.titulo || 'Foto ' + (i + 1)); tb.title = it.titulo || '';
      var mini = foto(it, i, 'nvi-tira-mini'); mini.removeAttribute('data-enc'); tb.appendChild(mini);
      tb.onclick = function(e) { e.stopPropagation(); ir(i); }; strip.appendChild(tb); thumbs.push(tb);
    });
    var ir = function(i) {
      actual = (i + n) % n;
      capas.forEach(function(c, k) { c.classList.toggle('on', k === actual); });
      thumbs.forEach(function(t, k) { t.classList.toggle('on', k === actual); });
      var t = thumbs[actual]; if (t && strip.scrollWidth > strip.clientWidth) strip.scrollTo({left: t.offsetLeft - (strip.clientWidth - t.offsetWidth) / 2, behavior: reducido() ? 'auto' : 'smooth'});
      // barra de progreso hasta la siguiente foto
      if (+p.intervalo > 0 && ctx.modo !== 'editar') { pr.style.transition = 'none'; pr.style.width = '0%'; void pr.offsetWidth; pr.style.transition = 'width ' + p.intervalo + 's linear'; pr.style.width = '100%'; }
    };
    w.addEventListener('mouseenter', function() { pr.style.transition = 'none'; });
    teclado(w, function(d) { ir(actual + d); }); arrastrable(hero, 70, function(d) { ir(actual + d); });
    autoplay(w, p, ctx, function() { ir(actual + 1); });
    ir(0);
    return w;
  };

  // ---------- Fila que fluye con efecto Dock ----------
  C.fluye = function(p, ctx) {
    var l = lista(p), n = l.length, alto = +p.alto || 300, vis = Math.max(2, Math.min(8, +p.visibles || 5));
    var w = h('div', 'nvi-flu'); w.style.height = alto + 'px'; w.style.borderRadius = (p.radio || 0) + 'px';
    var pista = h('div', 'nvi-flu-pista'); w.appendChild(pista);
    var etiqueta = h('div', 'nvi-flu-tit'); w.appendChild(etiqueta);
    var items = [], vueltas = n < vis ? Math.ceil(vis * 2 / n) : 2;   // se repite para que la fila nunca se corte
    if (vueltas % 2) vueltas++;   // par: la animación va hasta la mitad y empalma sin salto
    for (var v = 0; v < vueltas; v++) l.forEach(function(it, i) {
      var c = h('div', 'nvi-flu-it'); var f = foto(it, i, 'nvi-flu-foto'); if (v) f.removeAttribute('data-enc'); c.appendChild(f);
      c.onclick = function() { abrir(it, l, i, ctx); }; c._it = it; pista.appendChild(c); items.push(c);
    });
    var base = 0, H0 = 0;
    var medir = function() {
      var W = w.clientWidth || 900; base = Math.max(60, (W - (vis - 1) * 14) / vis); H0 = Math.min(alto * 0.55, base * 0.75);
      w.style.setProperty('--flu-w', base + 'px'); w.style.setProperty('--flu-h', H0 + 'px');
      pista.style.animationDuration = Math.max(12, n * (p.velocidad === 'rapida' ? 2.2 : p.velocidad === 'lenta' ? 6 : 3.6)) * vueltas / 2 + 's';
    };
    medir(); if ('ResizeObserver' in window) new ResizeObserver(medir).observe(w);
    if (ctx.modo === 'editar' || reducido()) pista.classList.add('quieta');
    // efecto Dock: cada foto crece según qué tan cerca esté del mouse; las vecinas se apartan
    var centros = null, raf = 0, mx = 0, M = 1.85, off = 0, esc = 1;
    var aplicar = function() {
      raf = 0; if (!centros) return;
      var sig = base * 1.05, mejor = null, mejorS = 0;
      items.forEach(function(c, k) { var d = mx - centros[k], s = 1 + (M - 1) * Math.exp(-(d * d) / (2 * sig * sig)); c.style.width = base * s + 'px'; c.style.height = H0 * s + 'px'; if (s > mejorS) { mejorS = s; mejor = c; } });
      items.forEach(function(c) { c.classList.toggle('foco', c === mejor && mejorS > 1.5); });
      var it = mejor && mejorS > 1.5 ? mejor._it : null;
      etiqueta.textContent = it && it.titulo ? it.titulo : ''; etiqueta.classList.toggle('on', !!(it && it.titulo));
      if (it) { var r = mejor.getBoundingClientRect(), r0 = w.getBoundingClientRect(); etiqueta.style.left = (r.left - r0.left + r.width / 2) / esc + 'px'; etiqueta.style.bottom = (r0.bottom - r.bottom) / esc + 12 + 'px'; }   // sobre la foto que creció
    };
    w.addEventListener('mouseenter', function() {
      if (ctx.modo === 'editar' || reducido()) return;
      // se congela en píxeles (no en %), así al agrandar las fotos la fila no salta
      try { off = new DOMMatrixReadOnly(getComputedStyle(pista).transform).m41; } catch (e) { off = 0; }
      pista.style.animation = 'none'; pista.style.transform = 'translateX(' + off + 'px)';
      // en una sección reducida (escala < 1) se mide en píxeles reales, igual que el tamaño de las fotos
      var r0 = w.getBoundingClientRect(); esc = r0.width / (w.offsetWidth || r0.width) || 1;
      centros = items.map(function(c) { var r = c.getBoundingClientRect(); return (r.left - r0.left + r.width / 2) / esc; });
    });
    w.addEventListener('mousemove', function(e) { if (!centros) return; mx = (e.clientX - w.getBoundingClientRect().left) / esc; if (!raf) raf = requestAnimationFrame(aplicar); });
    w.addEventListener('mouseleave', function() {
      centros = null; items.forEach(function(c) { c.style.width = ''; c.style.height = ''; c.classList.remove('foco'); }); etiqueta.classList.remove('on');
      // sigue desde donde quedó
      setTimeout(function() { if (centros) return; var mitad = pista.scrollWidth / 2 || 1;
        pista.style.transform = ''; pista.style.animation = ''; medir();   // medir vuelve a poner la duración
        pista.style.animationDelay = (off / mitad * (parseFloat(pista.style.animationDuration) || 20)).toFixed(2) + 's'; }, 260);
    });
    return w;
  };
})();
