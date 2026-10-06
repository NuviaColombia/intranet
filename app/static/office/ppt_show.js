/* Nuvia PowerPoint: presentación con diapositivas (transiciones, animaciones, vista del moderador),
   vista previa en el editor, exportar a PDF/imagen y miniaturas. */
(function() {
  'use strict';
  var NV = window.NV, P = NV.ppt, S = P.show = {}, esc = NV.esc;
  NV.CDN.html2canvas = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  NV.lib.html2canvas = function() { return NV.cargarScript(NV.CDN.html2canvas).then(function() { return window.html2canvas; }); };

  // ---------- Efectos ----------
  var DUR = 700;
  function transicion(nuevo, viejo, t, cb) {
    t = t || {}; var tipo = t.tipo || 'ninguna', dur = Math.round((t.dur || 0.7) * 1000), dir = t.dir || 'izq';
    var sgn = dir === 'der' || dir === 'abajo' ? -1 : 1, eje = dir === 'arriba' || dir === 'abajo' ? 'Y' : 'X';
    var op = {duration: dur, easing: 'ease-in-out', fill: 'both'}, a = null;
    var tr = function(v) { return 'translate' + eje + '(' + v + '%)'; };
    switch (tipo) {
      case 'desvanecer': a = nuevo.animate([{opacity: 0}, {opacity: 1}], op); break;
      case 'empujar': a = nuevo.animate([{transform: tr(100 * sgn)}, {transform: tr(0)}], op); if (viejo) viejo.animate([{transform: tr(0)}, {transform: tr(-100 * sgn)}], op); break;
      case 'barrido': a = nuevo.animate(eje === 'X' ? [{clipPath: sgn > 0 ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)'}, {clipPath: 'inset(0 0 0 0)'}] : [{clipPath: sgn > 0 ? 'inset(100% 0 0 0)' : 'inset(0 0 100% 0)'}, {clipPath: 'inset(0 0 0 0)'}], op); break;
      case 'dividir': a = nuevo.animate([{clipPath: 'inset(0 50% 0 50%)'}, {clipPath: 'inset(0 0 0 0)'}], op); break;
      case 'revelar': if (viejo) { viejo.style.zIndex = 3; a = viejo.animate([{transform: tr(0), opacity: 1}, {transform: tr(-100 * sgn), opacity: 0.6}], op); } break;
      case 'cubrir': a = nuevo.animate([{transform: tr(100 * sgn)}, {transform: tr(0)}], op); break;
      case 'zoom': a = nuevo.animate([{transform: 'scale(.3)', opacity: 0}, {transform: 'scale(1)', opacity: 1}], op); break;
      case 'girar': a = nuevo.animate([{transform: 'perspective(1600px) rotateY(90deg)', opacity: 0.2}, {transform: 'perspective(1600px) rotateY(0)', opacity: 1}], op); break;
    }
    if (a) a.onfinish = cb; else cb();
  }
  function animar(el, an, cb) {
    var dur = Math.round((an.dur || 0.5) * 1000), op = {duration: dur, delay: Math.round((an.retraso || 0) * 1000), easing: 'ease-out', fill: 'both'};
    var d = an.dir || 'abajo', desp = {abajo: 'translateY(60px)', arriba: 'translateY(-60px)', izq: 'translateX(-80px)', der: 'translateX(80px)'}[d];
    var desde = {abajo: 'translateY(110vh)', arriba: 'translateY(-110vh)', izq: 'translateX(-110vw)', der: 'translateX(110vw)'}[d];
    var rot = el.style.transform || '', k;
    el.style.visibility = 'visible';
    switch (an.tipo) {
      case 'aparecer': k = [{opacity: 0}, {opacity: 1, offset: 0.01}, {opacity: 1}]; op.duration = 1; break;
      case 'desvanecer': k = [{opacity: 0}, {opacity: 1}]; break;
      case 'volar': k = [{transform: desde + ' ' + rot}, {transform: rot || 'none'}]; break;
      case 'flotar': k = [{opacity: 0, transform: desp + ' ' + rot}, {opacity: 1, transform: rot || 'none'}]; break;
      case 'dividir': k = [{clipPath: 'inset(0 50% 0 50%)'}, {clipPath: 'inset(0 0 0 0)'}]; break;
      case 'barrido': k = [{clipPath: 'inset(0 100% 0 0)'}, {clipPath: 'inset(0 0 0 0)'}]; break;
      case 'zoom': k = [{opacity: 0, transform: 'scale(.2) ' + rot}, {opacity: 1, transform: (rot || '') + ' scale(1)'}]; break;
      case 'rebotar': k = [{opacity: 0, transform: 'translateY(-200px) ' + rot}, {opacity: 1, transform: 'translateY(0) ' + rot, offset: 0.6}, {transform: 'translateY(-30px) ' + rot, offset: 0.8}, {transform: 'translateY(0) ' + rot}]; op.easing = 'ease-in'; break;
      case 'girar': k = [{opacity: 0, transform: 'scale(.3) rotate(-180deg)'}, {opacity: 1, transform: (rot || '') + ' scale(1)'}]; break;
      case 'pulso': k = [{transform: (rot || '') + ' scale(1)'}, {transform: (rot || '') + ' scale(1.12)'}, {transform: (rot || '') + ' scale(1)'}]; break;
      default: k = [{opacity: 1}, {opacity: 1}];
    }
    var a = el.animate(k, op); a.onfinish = function() { if (cb) cb(); };
    return a;
  }
  // Pasos de animación de una diapositiva: cada "al hacer clic" abre un paso; "con" y "después" se suman al paso actual.
  function pasos(diap) {
    var lista = diap.elementos.filter(function(e) { return e.anim && e.anim.tipo && e.anim.tipo !== 'ninguna'; }).sort(function(a, b) { return (a.anim.orden || 0) - (b.anim.orden || 0); });
    var out = [];
    lista.forEach(function(e, i) {
      var ini = e.anim.inicio || 'clic';
      if (!out.length || ini === 'clic') out.push([]);
      out[out.length - 1].push({e: e, despues: ini === 'despues' && i > 0});
    });
    return out;
  }
  function ejecutarPaso(raiz, paso, cb) {
    var restantes = paso.length, retrasoAcum = 0, fin = function() { if (--restantes <= 0 && cb) cb(); };
    if (!restantes) { if (cb) cb(); return; }
    paso.forEach(function(p) {
      var el = raiz.querySelector('[data-id="' + p.e.id + '"]'); if (!el) { fin(); return; }
      var an = Object.assign({}, p.e.anim);
      if (p.despues) { an.retraso = (an.retraso || 0) + retrasoAcum; }
      retrasoAcum = (an.retraso || 0) + (an.dur || 0.5);
      animar(el, an, fin);
    });
  }

  // ---------- Presentación ----------
  var st = null;
  S.activo = function() { return !!st; };
  S.iniciar = function(desde, opts) {
    if (!P.pres) return;
    P.salirEdicion && P.salirEdicion();
    opts = opts || {};
    var visibles = P.pres.diapositivas.map(function(d, i) { return i; }).filter(function(i) { return !P.pres.diapositivas[i].oculta || i === desde; });
    if (!visibles.length) return;
    var pos = Math.max(0, visibles.indexOf(desde)); if (pos < 0) pos = 0;
    var cap = document.createElement('div'); cap.className = 'nvp-show' + (opts.ventana ? ' ventana' : ''); cap.tabIndex = 0;
    cap.innerHTML = '<div class="nvp-show-esc"></div><div class="nvp-show-tapa"></div><div class="nvp-show-barra"><button type="button" data-s="prev" title="Anterior">' + NV.icono('arrow_left', 'p') +
      '</button><span class="nvp-show-n"></span><button type="button" data-s="next" title="Siguiente">' + NV.icono('arrow_right', 'p') + '</button><button type="button" data-s="mod" title="Vista del moderador (P)">' + NV.icono('person_board', 'p') +
      '</button><button type="button" data-s="salir" title="Terminar (Esc)">' + NV.icono('dismiss', 'p') + '</button></div><div class="nvp-mod nv-oculto"></div>';
    document.body.appendChild(cap);
    st = {cap: cap, visibles: visibles, pos: pos, paso: 0, pasos: [], capa: null, moderador: !!P.est.moderador && !opts.ventana, inicio: Date.now(), ventana: !!opts.ventana, timer: null, num: ''};
    if (!opts.ventana && cap.requestFullscreen) cap.requestFullscreen().catch(function() {});
    cap.focus();
    cap.addEventListener('keydown', tecla);
    cap.addEventListener('click', function(e) {
      var b = e.target.closest('[data-s]');
      if (b) { e.stopPropagation(); ({prev: atras, next: adelante, mod: alternarModerador, salir: S.terminar})[b.dataset.s](); return; }
      if (e.target.closest('.nvp-mod-panel')) return;
      var v = e.target.closest('[data-vinculo]');
      if (v) { var u = v.getAttribute('data-vinculo'); if (/^#\d+$/.test(u)) irA(+u.slice(1) - 1); else window.open(u, '_blank', 'noopener'); return; }
      var a = e.target.closest('a[href]'); if (a) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); return; }
      adelante();
    });
    cap.addEventListener('contextmenu', function(e) { e.preventDefault(); atras(); });
    cap.addEventListener('wheel', function(e) { if (e.deltaY > 0) adelante(); else atras(); }, {passive: true});
    document.addEventListener('fullscreenchange', alSalirPantalla);
    window.addEventListener('resize', reescalar);
    mostrar(false);
    if (st.moderador) pintarModerador();
  };
  function alSalirPantalla() { if (st && !st.ventana && !document.fullscreenElement && st.yaFull) S.terminar(); if (st && document.fullscreenElement) st.yaFull = true; }
  S.terminar = function() {
    if (!st) return;
    clearTimeout(st.auto); clearInterval(st.timer);
    var i = st.visibles[Math.min(st.pos, st.visibles.length - 1)];
    st.cap.remove(); document.removeEventListener('fullscreenchange', alSalirPantalla); window.removeEventListener('resize', reescalar);
    if (document.fullscreenElement) document.exitFullscreen().catch(function() {});
    st = null;
    if (typeof i === 'number') P.ir(i);
  };
  function escalaPantalla() {
    var area = st.cap.querySelector('.nvp-show-esc'), W = area.clientWidth || innerWidth, H = area.clientHeight || innerHeight;
    return Math.min(W / P.pres.tam.w, H / P.pres.tam.h);
  }
  function capaDiap(idx, completa) {
    var d = P.pres.diapositivas[idx], r = P.render(d, {modo: 'show', numero: idx + 1}), k = escalaPantalla(), area = st.cap.querySelector('.nvp-show-esc');
    var w = P.pres.tam.w * k, h = P.pres.tam.h * k;
    var marco = document.createElement('div'); marco.className = 'nvp-show-marco';
    marco.style.cssText = 'width:' + w + 'px;height:' + h + 'px;left:' + (area.clientWidth - w) / 2 + 'px;top:' + (area.clientHeight - h) / 2 + 'px';
    r.style.transformOrigin = '0 0'; r.style.transform = 'scale(' + k + ')';
    if (!completa) pasos(d).forEach(function(p) { p.forEach(function(x) { var el = r.querySelector('[data-id="' + x.e.id + '"]'); if (el && x.e.anim.tipo !== 'pulso') el.style.visibility = 'hidden'; }); });
    marco.appendChild(r);
    return marco;
  }
  function reescalar() { if (!st) return; mostrar(true, true); }
  function mostrar(sinTransicion, completa) {
    clearTimeout(st.auto);
    var idx = st.visibles[st.pos], d = P.pres.diapositivas[idx], area = st.cap.querySelector('.nvp-show-esc');
    var viejo = st.capa, nuevo = capaDiap(idx, completa);
    area.appendChild(nuevo); st.capa = nuevo;
    st.pasos = pasos(d); st.paso = completa ? st.pasos.length : 0;
    st.cap.querySelector('.nvp-show-n').textContent = (st.pos + 1) + ' / ' + st.visibles.length;
    var listo = function() { if (viejo && viejo.parentNode) viejo.remove(); programarAuto(); };
    if (sinTransicion || !viejo) { listo(); } else transicion(nuevo, viejo, d.transicion, listo);
    if (st.moderador) pintarModerador();
  }
  function programarAuto() {
    var d = P.pres.diapositivas[st.visibles[st.pos]], av = d.avance || {};
    if (av.seg != null && st.paso >= st.pasos.length) st.auto = setTimeout(adelante, av.seg * 1000);
  }
  function adelante() {
    if (!st) return;
    st.cap.querySelector('.nvp-show-tapa').className = 'nvp-show-tapa';
    if (st.fin) { S.terminar(); return; }
    if (st.paso < st.pasos.length) { var p = st.pasos[st.paso++]; ejecutarPaso(st.capa, p, programarAuto); if (st.moderador) pintarModerador(); return; }
    if (st.pos < st.visibles.length - 1) { st.pos++; mostrar(false); return; }
    st.fin = true;
    var area = st.cap.querySelector('.nvp-show-esc'); if (st.capa) st.capa.remove(); st.capa = null;
    var f = document.createElement('div'); f.className = 'nvp-show-fin'; f.textContent = 'Fin de la presentación con diapositivas. Haga clic para salir.'; area.appendChild(f); st.capa = f;
  }
  function atras() {
    if (!st) return;
    if (st.fin) { st.fin = false; if (st.capa) st.capa.remove(); st.capa = null; mostrar(true, true); return; }
    if (st.pos > 0) { st.pos--; mostrar(true, true); }
  }
  function irA(i) { var p = st.visibles.indexOf(i); if (p >= 0) { st.fin = false; st.pos = p; mostrar(false); } }
  function tecla(e) {
    var k = e.key;
    if (/^\d$/.test(k)) { st.num += k; return; }
    if (k === 'Enter' && st.num) { e.preventDefault(); irA(parseInt(st.num, 10) - 1); st.num = ''; return; }
    st.num = '';
    if (k === 'Escape') { e.preventDefault(); S.terminar(); return; }
    if (['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown', 'n', 'N'].indexOf(k) >= 0) { e.preventDefault(); adelante(); return; }
    if (['ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp'].indexOf(k) >= 0) { e.preventDefault(); atras(); return; }
    if (k === 'Home') { e.preventDefault(); st.fin = false; st.pos = 0; mostrar(true); return; }
    if (k === 'End') { e.preventDefault(); st.fin = false; st.pos = st.visibles.length - 1; mostrar(true, true); return; }
    var tapa = st.cap.querySelector('.nvp-show-tapa');
    if (k === 'b' || k === 'B' || k === '.') { e.preventDefault(); tapa.className = tapa.classList.contains('negra') ? 'nvp-show-tapa' : 'nvp-show-tapa negra'; return; }
    if (k === 'w' || k === 'W' || k === ',') { e.preventDefault(); tapa.className = tapa.classList.contains('blanca') ? 'nvp-show-tapa' : 'nvp-show-tapa blanca'; return; }
    if (k === 'p' || k === 'P') { e.preventDefault(); alternarModerador(); }
  }
  function alternarModerador() { st.moderador = !st.moderador; st.cap.classList.toggle('moderador', st.moderador); NV.$('.nvp-mod', st.cap).classList.toggle('nv-oculto', !st.moderador); if (st.moderador) pintarModerador(); else { clearInterval(st.timer); } mostrar(true, st.paso >= st.pasos.length); }
  function pintarModerador() {
    var m = NV.$('.nvp-mod', st.cap); st.cap.classList.add('moderador'); m.classList.remove('nv-oculto');
    var idx = st.visibles[st.pos], sig = st.visibles[st.pos + 1], d = P.pres.diapositivas[idx];
    var tam = P.pres.tam, k = 300 / tam.w;
    m.innerHTML = '<div class="nvp-mod-panel"><div class="nvp-mod-t"><span class="nvp-mod-reloj">00:00:00</span><span>' + new Date().toLocaleTimeString('es-CO', {hour: 'numeric', minute: '2-digit'}) + '</span></div>' +
      '<div class="nvp-mod-sig-t">Siguiente diapositiva</div><div class="nvp-mod-sig" style="width:' + tam.w * k + 'px;height:' + tam.h * k + 'px"></div>' +
      '<div class="nvp-mod-sig-t">Notas</div><div class="nvp-mod-notas">' + (d.notas || '<i style="opacity:.6">Sin notas</i>') + '</div>' +
      '<div class="nvp-mod-acc"><button type="button" data-s="prev">◀ Anterior</button><button type="button" data-s="next">Siguiente ▶</button></div></div>';
    if (typeof sig === 'number') { var r = P.render(P.pres.diapositivas[sig], {modo: 'mini', numero: sig + 1}); r.style.transformOrigin = '0 0'; r.style.transform = 'scale(' + k + ')'; m.querySelector('.nvp-mod-sig').appendChild(r); }
    else m.querySelector('.nvp-mod-sig').innerHTML = '<div style="color:#bbb;padding:20px;font-size:13px">Fin de la presentación</div>';
    clearInterval(st.timer);
    var reloj = m.querySelector('.nvp-mod-reloj'), t0 = st.inicio;
    var pinta = function() { var s = Math.floor((Date.now() - t0) / 1000); reloj.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(function(x) { return ('0' + x).slice(-2); }).join(':'); };
    pinta(); st.timer = setInterval(pinta, 1000);
  }

  // ---------- Vista previa en el editor ----------
  S.previaTransicion = function() {
    var esc0 = NV.$('#nvpEscena'), d = P.diap(); if (!esc0 || !d) return;
    var r = esc0.firstChild; if (!r) return;
    var clon = r.cloneNode(true); clon.style.position = 'absolute'; clon.style.left = 0; clon.style.top = 0;
    var marco = document.createElement('div'); marco.style.cssText = 'position:absolute;inset:0;overflow:hidden;z-index:5'; marco.appendChild(clon); esc0.appendChild(marco);
    var viejoW = document.createElement('div'); viejoW.style.cssText = 'position:absolute;inset:0;background:#000;z-index:4'; esc0.appendChild(viejoW);
    transicion(marco, viejoW, d.transicion, function() { marco.remove(); viejoW.remove(); });
  };
  S.previaAnim = function(lista) {
    var raiz = NV.$('#nvpEscena .nvp-diap'), d = P.diap(); if (!raiz || !d) return;
    var ps = lista ? [lista.map(function(e) { return {e: e}; })] : pasos(d);
    ps.forEach(function(p) { p.forEach(function(x) { var el = raiz.querySelector('[data-id="' + x.e.id + '"]'); if (el && x.e.anim && x.e.anim.tipo !== 'pulso') el.style.visibility = 'hidden'; }); });
    var i = 0, sig = function() { if (i >= ps.length) { setTimeout(function() { P.pintarEscena(); }, 300); return; } ejecutarPaso(raiz, ps[i++], function() { setTimeout(sig, 250); }); };
    setTimeout(sig, 200);
  };

  // ---------- Capturas (PDF, imagen, miniatura) ----------
  function capturar(i, escala, completa) {
    return NV.lib.html2canvas().then(function(h2c) {
      var host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-20000px;top:0;z-index:-1';
      var r = P.render(P.pres.diapositivas[i], {modo: 'export', numero: i + 1}); host.appendChild(r); document.body.appendChild(host);
      var listo = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      return listo.then(function() { return new Promise(function(ok) { setTimeout(ok, 60); }); })
        .then(function() { return h2c(r, {scale: escala || 2, useCORS: true, backgroundColor: null, logging: false, width: P.pres.tam.w, height: P.pres.tam.h}); })
        .then(function(c) { host.remove(); return c; }, function(e) { host.remove(); throw e; });
    });
  }
  S.capturar = capturar;
  S.miniatura = function(i) { return capturar(i || 0, 0.4).then(function(c) { return c.toDataURL('image/jpeg', 0.8); }); };
  S.imagen = function(i) {
    return capturar(i, 2).then(function(c) { return new Promise(function(ok) { c.toBlob(ok, 'image/png'); }); });
  };
  S.pdf = function(progreso, incluirOcultas) {
    var lista = P.pres.diapositivas.map(function(d, i) { return i; }).filter(function(i) { return incluirOcultas || !P.pres.diapositivas[i].oculta; });
    return NV.lib.pdflib().then(function(PL) {
      return PL.PDFDocument.create().then(function(doc) {
        doc.setTitle(P.doc ? P.doc.titulo : 'Presentación'); doc.setCreator('Nuvia Office'); doc.setProducer('Nuvia Office');
        var k = 0;
        var sig = function() {
          if (k >= lista.length) return doc.save();
          var i = lista[k++]; if (progreso) progreso(k / lista.length, 'Diapositiva ' + k + ' de ' + lista.length);
          return capturar(i, 2).then(function(c) { return doc.embedJpg(NV.dataUrlABytes(c.toDataURL('image/jpeg', 0.92))); }).then(function(img) {
            var pg = doc.addPage([P.pres.tam.w, P.pres.tam.h]); pg.drawImage(img, {x: 0, y: 0, width: P.pres.tam.w, height: P.pres.tam.h});
            var notas = P.pres.diapositivas[i].notas; void notas;
          }).then(sig);
        };
        return sig();
      });
    }).then(function(bytes) { return new Blob([bytes], {type: 'application/pdf'}); });
  };
})();
