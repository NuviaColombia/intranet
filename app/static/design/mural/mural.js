// Mural de Design: pared de avisos (animados), visor para leerlos con zoom y, para quien edita, subir / publicar.
(function() {
  'use strict';
  var raiz = document.getElementById('muRaiz');
  if (!raiz) return;
  var pared = document.getElementById('muPared');
  var EDITOR = raiz.dataset.editor === '1';
  var M = {items: [], borradores: 0};

  function api(url, opts) {
    return fetch(url, opts || {}).catch(function() { throw new Error('Se perdió la conexión con el servidor. Intenta de nuevo.'); })
      .then(function(r) {
        return r.text().then(function(t) {
          var d = null; try { d = t ? JSON.parse(t) : null; } catch (x) {}
          if (!r.ok) throw new Error((d && typeof d.detail === 'string' && d.detail) || ('El servidor respondió con un error (' + r.status + ').'));
          return d;
        });
      });
  }
  function post(url, body) {
    return api(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})});
  }
  function aviso(msg) {
    var el = document.createElement('div'); el.className = 'mu-progreso'; el.setAttribute('role', 'status'); el.textContent = msg;
    document.body.appendChild(el); setTimeout(function() { el.remove(); }, 3200);
  }

  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function fechaCorta(iso) { var d = new Date(iso); return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear(); }
  function fechaLarga(iso) { return new Date(iso).toLocaleDateString('es-CO', {day: 'numeric', month: 'long', year: 'numeric'}); }

  // Inclinación, velocidad y tipo de sujeción "al azar" pero estables para cada aviso (dependen de su id).
  function azar(id, n) { var x = Math.sin(id * 9301 + n * 49297) * 233280; return x - Math.floor(x); }

  // ---------- Pared ----------
  function pintar() {
    pared.textContent = '';
    var vacio = document.getElementById('muVacio');
    vacio.hidden = M.items.length > 0;
    M.items.forEach(function(a, i) {
      var r = (azar(a.id, 1) * 5 - 2.5).toFixed(2);
      var card = document.createElement('div');
      card.className = 'mu-aviso' + (a.publicado ? '' : ' borrador');
      card.style.setProperty('--r', r + 'deg');
      card.style.setProperty('--d', (5 + azar(a.id, 2) * 3).toFixed(2) + 's');
      card.style.setProperty('--delay', (i * 0.09).toFixed(2) + 's');
      var tipo = Math.floor(azar(a.id, 3) * 4);
      if (tipo < 3) {
        var ch = document.createElement('span'); ch.className = 'mu-chinche' + ['', ' azul', ' amar'][tipo]; card.appendChild(ch);
      } else {
        ['izq', 'der'].forEach(function(l) { var c = document.createElement('span'); c.className = 'mu-cinta ' + l; card.appendChild(c); });
      }
      // La primera semana lleva la cinta NUEVO; después queda la fecha en que se publicó.
      if (a.nuevo) { var n = document.createElement('span'); n.className = 'mu-nuevo'; n.textContent = 'NUEVO'; card.appendChild(n); }
      else if (a.publicado && a.publicadoEn) {
        var fe = document.createElement('span'); fe.className = 'mu-fecha'; fe.textContent = fechaCorta(a.publicadoEn);
        fe.title = 'Publicado el ' + fechaLarga(a.publicadoEn); card.appendChild(fe);
      }
      if (!a.publicado) { var b = document.createElement('span'); b.className = 'mu-borr'; b.textContent = 'Borrador'; card.appendChild(b); }
      var papel = document.createElement('button');
      papel.type = 'button'; papel.className = 'mu-papel';
      papel.setAttribute('aria-label', 'Ver aviso: ' + a.titulo);
      var img = document.createElement('img');
      img.src = a.mini; img.alt = a.titulo; img.loading = 'lazy'; img.decoding = 'async';
      if (a.ancho && a.alto) { img.width = a.ancho; img.height = a.alto; }
      papel.appendChild(img);
      papel.addEventListener('click', function() { abrirVisor(i, papel); });
      card.appendChild(papel);
      var et = document.createElement('div'); et.className = 'mu-etiqueta'; et.textContent = a.titulo; card.appendChild(et);
      if (EDITOR) card.appendChild(controles(a, i));
      pared.appendChild(card);
    });
    var pub = document.getElementById('muPublicar');
    if (pub) {
      pub.disabled = !M.borradores;
      pub.textContent = M.borradores ? 'Publicar (' + M.borradores + ')' : 'Todo publicado';
    }
  }

  function boton(txt, cls, titulo, fn) {
    var b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = titulo; if (cls) b.className = cls;
    b.addEventListener('click', fn); return b;
  }
  function controles(a, i) {
    var c = document.createElement('div'); c.className = 'mu-ctrl';
    c.appendChild(boton('✎ Título', '', 'Cambiar el título', function() {
      var t = prompt('Título del aviso:', a.titulo);
      if (t === null || !t.trim()) return;
      post('/design/api/mural/' + a.id, {titulo: t.trim()}).then(cargar).catch(function(e) { alert(e.message); });
    }));
    c.appendChild(a.publicado
      ? boton('Ocultar', 'ocu', 'Quitarlo del mural para los demás (vuelve a borrador)', function() { cambiarPub(a, false); })
      : boton('Publicar', 'pub', 'Publicar solo este aviso', function() { cambiarPub(a, true); }));
    c.appendChild(boton('✕', 'del', 'Eliminar aviso', function() {
      if (!confirm('¿Eliminar el aviso "' + a.titulo + '"? Esta acción no se puede deshacer.')) return;
      post('/design/api/mural/' + a.id + '/eliminar').then(cargar).catch(function(e) { alert(e.message); });
    }));
    return c;
  }
  function cambiarPub(a, v) {
    post('/design/api/mural/' + a.id, {publicado: v}).then(function() { aviso(v ? 'Aviso publicado: ya lo ve todo Design.' : 'Aviso oculto.'); cargar(); })
      .catch(function(e) { alert(e.message); });
  }
  var PEDIDO = (function() { try { return +new URLSearchParams(location.search).get('aviso') || 0; } catch (e) { return 0; } })();
  function cargar() {
    return api('/design/api/mural').then(function(d) {
      M = d; pintar();
      if (PEDIDO) {   // llegó desde un push: abre ese aviso en grande
        var i = M.items.findIndex(function(x) { return x.id === PEDIDO; });
        PEDIDO = 0;
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
        if (i >= 0) abrirVisor(i, document.querySelectorAll('.mu-papel')[i]);
      }
    })
      .catch(function(e) { pared.textContent = ''; aviso('⚠️ ' + e.message); });
  }

  // ---------- Subir (solo quien edita): el navegador comprime a WebP antes de enviar ----------
  function aBlob(canvas, calidad) {
    return new Promise(function(res) {
      canvas.toBlob(function(b) {
        if (b && b.type === 'image/webp') return res(b);
        canvas.toBlob(function(j) { res(j); }, 'image/jpeg', 0.9);   // navegadores que no generan WebP
      }, 'image/webp', calidad);
    });
  }
  function escalar(bmp, maxLado) {
    var k = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
    var c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    var g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }
  function tituloDe(nombre) {
    var t = nombre.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || /^\d+$/.test(t) || /^(img|image|imagen)\s*\d*$/i.test(t)) t = 'Aviso';
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  }
  function subir(files) {
    files = Array.prototype.filter.call(files || [], function(f) { return /^image\/(png|jpe?g|webp)$/.test(f.type); });
    if (!files.length) { aviso('Solo se pueden pegar imágenes JPG, PNG o WebP.'); return; }
    var prog = document.createElement('div'); prog.className = 'mu-progreso'; prog.setAttribute('role', 'status'); document.body.appendChild(prog);
    var hechos = 0, errores = [];
    var cadena = Promise.resolve();
    files.forEach(function(f) {
      cadena = cadena.then(function() {
        prog.textContent = 'Subiendo ' + (hechos + 1) + ' de ' + files.length + '…';
        return createImageBitmap(f).then(function(bmp) {
          var full = escalar(bmp, 2400), mini = escalar(bmp, 640);
          return Promise.all([aBlob(full, 0.88), aBlob(mini, 0.8)]).then(function(bl) {
            var fd = new FormData();
            fd.append('archivo', bl[0], 'aviso.webp'); fd.append('mini', bl[1], 'mini.webp');
            fd.append('titulo', tituloDe(f.name)); fd.append('ancho', full.width); fd.append('alto', full.height);
            return api('/design/api/mural', {method: 'POST', body: fd});
          });
        }).then(function() { hechos++; }).catch(function(e) { errores.push(f.name + ': ' + e.message); });
      });
    });
    cadena.then(function() {
      prog.remove();
      if (errores.length) alert('No se pudieron subir:\n' + errores.join('\n'));
      if (hechos) aviso(hechos + ' aviso(s) pegado(s) como borrador. Revisa y presiona Publicar.');
      cargar();
    });
  }
  if (EDITOR) {
    var inp = document.getElementById('muArchivo');
    document.getElementById('muSubir').addEventListener('click', function() { inp.click(); });
    inp.addEventListener('change', function() { subir(inp.files); inp.value = ''; });
    document.getElementById('muPublicar').addEventListener('click', function() {
      if (!confirm('¿Publicar ' + M.borradores + ' aviso(s)? Los verán todas las personas con acceso a Design.')) return;
      post('/design/api/mural/publicar').then(function(d) { aviso(d.mensaje); cargar(); }).catch(function(e) { alert(e.message); });
    });
    // Push de los avisos «Nuevo» (22-oct-2026): primero una prueba solo a quien administra; luego a todo Design.
    // Al publicar, el push a todos sale solo (servidor).
    var pushar = function(prueba) {
      var nuevos = M.items.filter(function(x) { return x.nuevo; }).length;
      if (!nuevos) { alert('No hay avisos con la cinta «Nuevo».'); return; }
      if (!prueba && !confirm('¿Enviar ' + nuevos + ' push (uno por aviso «Nuevo») a todas las personas con acceso a Design?\nCada uno se queda en pantalla hasta que lo cierren.')) return;
      post('/design/api/mural/push', {prueba: prueba}).then(function(d) { aviso(d.mensaje); }).catch(function(e) { alert(e.message); });
    };
    document.getElementById('muPushPrueba').addEventListener('click', function() { pushar(true); });
    document.getElementById('muPushTodos').addEventListener('click', function() { pushar(false); });
    var ed = document.getElementById('muEditar');
    ed.addEventListener('click', function() {
      var on = raiz.classList.toggle('editando');
      ed.classList.toggle('activo', on); ed.setAttribute('aria-pressed', on ? 'true' : 'false');
      ed.textContent = on ? 'Terminar edición' : 'Editar';
    });
    var cuenta = 0;
    raiz.addEventListener('dragenter', function(e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) { cuenta++; raiz.classList.add('soltando'); } });
    raiz.addEventListener('dragleave', function() { if (--cuenta <= 0) { cuenta = 0; raiz.classList.remove('soltando'); } });
    raiz.addEventListener('dragover', function(e) { e.preventDefault(); });
    raiz.addEventListener('drop', function(e) { e.preventDefault(); cuenta = 0; raiz.classList.remove('soltando'); subir(e.dataTransfer.files); });
  }

  // ---------- Visor: leer el aviso en grande, con zoom (rueda, doble clic, pellizco) y arrastre ----------
  var V = document.getElementById('muVisor'), vImg = document.getElementById('muVImg'), lienzo = document.getElementById('muVLienzo');
  var Z = {i: 0, s: 1, x: 0, y: 0, origen: null, foco: null};
  function aplicar(anim) {
    vImg.style.transition = anim ? 'transform .25s ease' : 'none';
    vImg.style.transform = 'translate(' + Z.x + 'px,' + Z.y + 'px) scale(' + Z.s + ')';
    V.classList.toggle('zoom', Z.s > 1.01);
  }
  function limitar() {
    // que la imagen no se escape del lienzo al moverla
    var w = vImg.offsetWidth * Z.s, h = vImg.offsetHeight * Z.s, cw = lienzo.clientWidth, chh = lienzo.clientHeight;
    var bx = vImg.offsetLeft, by = vImg.offsetTop;
    var minX = Math.min(0, cw - w - bx), maxX = Math.max(0, -bx), minY = Math.min(0, chh - h - by), maxY = Math.max(0, -by);
    if (w <= cw) Z.x = (cw - w) / 2 - bx; else Z.x = Math.max(minX, Math.min(maxX, Z.x));
    if (h <= chh) Z.y = (chh - h) / 2 - by; else Z.y = Math.max(minY, Math.min(maxY, Z.y));
  }
  function zoomEn(nuevo, cx, cy, anim) {
    nuevo = Math.max(1, Math.min(5, nuevo));
    var r = lienzo.getBoundingClientRect();
    var px = cx - r.left - vImg.offsetLeft, py = cy - r.top - vImg.offsetTop;   // punto bajo el cursor, relativo a la imagen sin mover
    Z.x = px - (px - Z.x) * (nuevo / Z.s); Z.y = py - (py - Z.y) * (nuevo / Z.s); Z.s = nuevo;
    if (Z.s === 1) { Z.x = 0; Z.y = 0; }
    limitar(); aplicar(anim);
  }
  function reiniciar() { Z.s = 1; Z.x = 0; Z.y = 0; aplicar(false); }
  function mostrar(i) {
    var a = M.items[i]; if (!a) return;
    Z.i = i; reiniciar();
    vImg.src = a.full; vImg.alt = a.titulo;
    document.getElementById('muVTit').textContent = a.titulo;
    document.getElementById('muVCont').textContent = (a.publicadoEn ? 'Publicado el ' + fechaLarga(a.publicadoEn) + ' · ' : '') + (i + 1) + ' / ' + M.items.length;
    document.getElementById('muVOrig').href = a.full;
    var unico = M.items.length < 2;
    document.getElementById('muVPrev').hidden = unico; document.getElementById('muVNext').hidden = unico;
    var sig = M.items[(i + 1) % M.items.length]; if (sig) { var pre = new Image(); pre.src = sig.full; }
  }
  function abrirVisor(i, desde) {
    Z.foco = document.activeElement; Z.origen = desde;
    V.classList.add('abierto'); document.body.style.overflow = 'hidden';
    mostrar(i);
    // Animación: la imagen "sale" del aviso de la pared hacia el centro
    var ok = function() {
      var o = desde.getBoundingClientRect(), f = vImg.getBoundingClientRect();
      if (f.width && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        vImg.animate([{transform: 'translate(' + (o.left - f.left) + 'px,' + (o.top - f.top) + 'px) scale(' + (o.width / f.width) + ')', opacity: .6},
                      {transform: 'translate(0,0) scale(1)', opacity: 1}], {duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)'});
      }
    };
    if (vImg.complete && vImg.naturalWidth) ok(); else vImg.addEventListener('load', ok, {once: true});
    requestAnimationFrame(function() { V.classList.add('visible'); });
    document.getElementById('muVCerrar').focus();
    var pista = document.getElementById('muVPista'); pista.style.opacity = 1; setTimeout(function() { pista.style.opacity = 0; }, 3500);
  }
  function cerrarVisor() {
    V.classList.remove('visible');
    setTimeout(function() { V.classList.remove('abierto'); vImg.removeAttribute('src'); }, 220);
    document.body.style.overflow = '';
    if (Z.foco && Z.foco.focus) Z.foco.focus({preventScroll: true});
  }
  function paso(d) { mostrar((Z.i + d + M.items.length) % M.items.length); }
  document.getElementById('muVCerrar').addEventListener('click', cerrarVisor);
  document.getElementById('muVPrev').addEventListener('click', function() { paso(-1); });
  document.getElementById('muVNext').addEventListener('click', function() { paso(1); });
  document.getElementById('muVMas').addEventListener('click', function() { var r = lienzo.getBoundingClientRect(); zoomEn(Z.s * 1.5, r.left + r.width / 2, r.top + r.height / 2, true); });
  document.getElementById('muVMenos').addEventListener('click', function() { var r = lienzo.getBoundingClientRect(); zoomEn(Z.s / 1.5, r.left + r.width / 2, r.top + r.height / 2, true); });
  document.getElementById('muVAjustar').addEventListener('click', function() { Z.s = 1; Z.x = 0; Z.y = 0; aplicar(true); });
  lienzo.addEventListener('click', function(e) { if (e.target === lienzo && Z.s === 1) cerrarVisor(); });   // clic fuera de la imagen
  lienzo.addEventListener('wheel', function(e) { e.preventDefault(); zoomEn(Z.s * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX, e.clientY, false); }, {passive: false});
  // Arrastre con el mouse / un dedo, pellizco con dos dedos, y clic simple para acercar donde se toca
  var punteros = {}, ini = null, movido = false, sx = 0;
  vImg.addEventListener('pointerdown', function(e) {
    e.preventDefault(); vImg.setPointerCapture(e.pointerId);
    punteros[e.pointerId] = {x: e.clientX, y: e.clientY}; movido = false; sx = e.clientX;
    var ps = Object.values(punteros);
    ini = ps.length === 2 ? {d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), s: Z.s} : {x: e.clientX - Z.x, y: e.clientY - Z.y};
    V.classList.add('arrastrando');
  });
  vImg.addEventListener('pointermove', function(e) {
    if (!punteros[e.pointerId]) return;
    punteros[e.pointerId] = {x: e.clientX, y: e.clientY};
    var ps = Object.values(punteros);
    if (ps.length === 2 && ini && ini.d) {
      movido = true;
      zoomEn(ini.s * Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) / ini.d, (ps[0].x + ps[1].x) / 2, (ps[0].y + ps[1].y) / 2, false);
    } else if (ps.length === 1 && ini && ini.x !== undefined && Z.s > 1.01) {
      if (Math.abs(e.clientX - ini.x - Z.x) + Math.abs(e.clientY - ini.y - Z.y) > 3) movido = true;
      Z.x = e.clientX - ini.x; Z.y = e.clientY - ini.y; limitar(); aplicar(false);
    }
  });
  function soltar(e) {
    if (!punteros[e.pointerId]) return;
    delete punteros[e.pointerId];
    if (!Object.keys(punteros).length) {
      V.classList.remove('arrastrando');
      // en el celular, deslizar a un lado (sin zoom) pasa al aviso siguiente / anterior
      if (e.type === 'pointerup' && e.pointerType !== 'mouse' && Z.s <= 1.01 && Math.abs(e.clientX - sx) > 60) paso(e.clientX < sx ? 1 : -1);
      else if (!movido && e.type === 'pointerup' && e.pointerType === 'mouse') zoomEn(Z.s > 1.01 ? 1 : 2.4, e.clientX, e.clientY, true);   // clic: acercar / alejar
      ini = null;
    } else { var p = Object.values(punteros)[0]; ini = {x: p.x - Z.x, y: p.y - Z.y}; }
  }
  vImg.addEventListener('pointerup', soltar); vImg.addEventListener('pointercancel', soltar);
  document.addEventListener('keydown', function(e) {
    if (!V.classList.contains('abierto')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarVisor(); }
    else if (e.key === 'ArrowRight') paso(1);
    else if (e.key === 'ArrowLeft') paso(-1);
    else if (e.key === '+' || e.key === '=') document.getElementById('muVMas').click();
    else if (e.key === '-') document.getElementById('muVMenos').click();
    else if (e.key === 'Tab') {   // el foco no se sale del visor
      var f = V.querySelectorAll('button:not([hidden]), a[href]'); if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }, true);
  window.addEventListener('resize', function() { if (V.classList.contains('abierto')) { limitar(); aplicar(false); } });

  cargar();
})();
