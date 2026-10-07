/* Efectos de celebración de la página de Inicio de Design: confeti 3D, globos, fuegos artificiales y brillos.
   Se dibujan en un <canvas> con requestAnimationFrame. Se pausan cuando no están en pantalla o la pestaña está oculta,
   y no se muestran a quien pidió "reducir movimiento" en su equipo. */
(function() {
  'use strict';
  var NVI = window.NVI = window.NVI || {};
  var FX = NVI.fx = {};
  var COLORES = ['#2f98d5', '#ffd166', '#e8b64c', '#ff5a7a', '#36c58f', '#ff9f1c', '#a855f7', '#ffffff', '#7dd3fc'];
  var GLOBOS = ['#ff4d6d', '#2f98d5', '#e8b64c', '#36c58f', '#a855f7', '#ff9f1c', '#f472b6'];
  FX.reducido = function() { try { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  var azar = function(a, b) { return a + Math.random() * (b - a); };
  var uno = function(l) { return l[Math.floor(Math.random() * l.length)]; };

  // ---------- Partículas ----------
  // Confeti: papelitos (rectángulos, círculos y cintas) que giran en 3D, aletean y caen con resistencia del aire
  function confeti(x, y, vx, vy, colores) {
    var col = uno(colores || COLORES);
    return {t: 'c', x: x, y: y, vx: vx, vy: vy, c: col, c2: sombra(col), w: azar(6, 11), h: azar(9, 16), forma: uno(['r', 'r', 'r', 'o', 'cinta']),
      giro: azar(0, Math.PI * 2), vgiro: azar(-0.12, 0.12), voltea: azar(0, Math.PI * 2), vvoltea: azar(0.05, 0.16), aleteo: azar(0, Math.PI * 2), vida: 1};
  }
  function globo(W, H, x, desdeAbajo) {
    var r = azar(18, 34);
    return {t: 'g', x: x != null ? x : azar(0, W), y: desdeAbajo === false ? azar(0, H) : H + r * 3 + azar(0, H * 0.4), r: r, vy: -azar(0.5, 1.25) * (r / 26), c: uno(GLOBOS),
      fase: azar(0, Math.PI * 2), vaiven: azar(0.25, 0.7), vida: 1};
  }
  function brillo(W, H) { return {t: 'b', x: azar(0, W), y: azar(0, H), r: azar(3, 8), fase: azar(0, Math.PI * 2), vf: azar(0.04, 0.09), c: uno(['#ffe8a3', '#ffffff', '#e8b64c', '#bfe3f7']), vida: 1}; }
  // cohete: sube hasta una altura dentro del área (entre el 15 % y el 45 % desde arriba) y ahí explota
  function cohete(W, H) { var sube = H + 10 - H * azar(0.15, 0.45); return {t: 'k', x: azar(W * 0.15, W * 0.85), y: H + 10, vx: azar(-0.5, 0.5), vy: -Math.sqrt(2 * 0.12 * sube), c: uno(COLORES), vida: 1, cola: []}; }
  function chispa(x, y, c) { var a = azar(0, Math.PI * 2), v = azar(1.2, 4.6); return {t: 's', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: c, vida: 1, decae: azar(0.012, 0.022), cola: []}; }

  function dibujar(ctx, p) {
    if (p.t === 'c') {
      var esc = Math.cos(p.voltea);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.giro); ctx.scale(1, esc); ctx.globalAlpha = Math.max(0, Math.min(1, p.vida));
      // la cara de atrás se ve un poco más oscura, como papel real
      ctx.fillStyle = esc < 0 ? p.c2 : p.c;
      if (p.forma === 'o') { ctx.beginPath(); ctx.arc(0, 0, p.w * 0.55, 0, Math.PI * 2); ctx.fill(); }
      else if (p.forma === 'cinta') { ctx.beginPath(); ctx.moveTo(-p.w, -p.h * 0.2); ctx.bezierCurveTo(-p.w * 0.3, -p.h, p.w * 0.3, p.h, p.w, p.h * 0.2); ctx.lineWidth = 3; ctx.strokeStyle = ctx.fillStyle; ctx.stroke(); }
      else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    } else if (p.t === 'g') {
      var bx = p.x + Math.sin(p.fase) * 10 * p.vaiven, r = p.r;
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, p.vida));
      // hilo que se mece
      ctx.beginPath(); ctx.moveTo(bx, p.y + r * 1.18); ctx.quadraticCurveTo(bx + Math.sin(p.fase + 1.4) * 12, p.y + r * 2.1, bx + Math.sin(p.fase + 0.6) * 6, p.y + r * 3.1);
      ctx.strokeStyle = 'rgba(80,80,100,.55)'; ctx.lineWidth = 1.1; ctx.stroke();
      // cuerpo con luz y sombra
      var g = ctx.createRadialGradient(bx - r * 0.35, p.y - r * 0.45, r * 0.1, bx, p.y, r * 1.25);
      g.addColorStop(0, 'rgba(255,255,255,.85)'); g.addColorStop(0.18, p.c); g.addColorStop(1, sombra(p.c));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(bx, p.y, r * 0.86, r, 0, 0, Math.PI * 2); ctx.fill();
      // nudo
      ctx.fillStyle = sombra(p.c); ctx.beginPath(); ctx.moveTo(bx - 4, p.y + r * 1.2); ctx.lineTo(bx + 4, p.y + r * 1.2); ctx.lineTo(bx, p.y + r * 0.96); ctx.closePath(); ctx.fill();
      // reflejo
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(bx - r * 0.38, p.y - r * 0.4, r * 0.13, r * 0.26, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (p.t === 'b') {
      var s = (Math.sin(p.fase) + 1) / 2, rr = p.r * (0.4 + s * 0.8);
      ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = s * Math.min(1, p.vida); ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(0, -rr * 2); ctx.quadraticCurveTo(0, 0, rr * 2, 0); ctx.quadraticCurveTo(0, 0, 0, rr * 2); ctx.quadraticCurveTo(0, 0, -rr * 2, 0); ctx.quadraticCurveTo(0, 0, 0, -rr * 2); ctx.fill();
      ctx.restore();
    } else if (p.t === 'k' || p.t === 's') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < p.cola.length; i++) { var q = p.cola[i], a = (i + 1) / p.cola.length; ctx.globalAlpha = a * p.vida * 0.6; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(q[0], q[1], p.t === 'k' ? 2 : 1.6 * a, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = p.vida; ctx.fillStyle = p.t === 'k' ? '#fff8e0' : p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.t === 'k' ? 2.6 : 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  function sombra(hex) { var n = parseInt(hex.slice(1), 16), f = hex === '#ffffff' ? 0.82 : 0.62; return 'rgb(' + Math.round((n >> 16) * f) + ',' + Math.round((n >> 8 & 255) * f) + ',' + Math.round((n & 255) * f) + ')'; }

  function mover(p, W, H, dt, nuevas) {
    if (p.t === 'c') {
      p.aleteo += 0.06 * dt; p.vx *= Math.pow(0.985, dt); p.vy = p.vy * Math.pow(0.985, dt) + 0.07 * dt;
      if (p.vy > 2.6) p.vy = 2.6;   // velocidad final, como el papel en el aire
      p.x += (p.vx + Math.sin(p.aleteo) * 0.6) * dt; p.y += p.vy * dt; p.giro += p.vgiro * dt; p.voltea += p.vvoltea * dt;
      if (p.y > H + 30) p.vida = 0;
    } else if (p.t === 'g') {
      p.fase += 0.02 * dt; p.y += p.vy * dt; if (p.y < -p.r * 4) p.vida = 0;
    } else if (p.t === 'b') {
      p.fase += p.vf * dt; if (p.fin) p.vida -= 0.01 * dt;
    } else if (p.t === 'k') {
      p.cola.push([p.x, p.y]); if (p.cola.length > 10) p.cola.shift();
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.12 * dt;
      if (p.vy >= -1.2) { p.vida = 0; var n = 70 + Math.floor(Math.random() * 40), c2 = Math.random() < 0.3 ? uno(COLORES) : p.c; for (var i = 0; i < n; i++) nuevas.push(chispa(p.x, p.y, i % 3 ? p.c : c2)); }
    } else if (p.t === 's') {
      p.cola.push([p.x, p.y]); if (p.cola.length > 6) p.cola.shift();
      p.vx *= Math.pow(0.97, dt); p.vy = p.vy * Math.pow(0.97, dt) + 0.045 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vida -= p.decae * dt;
    }
  }

  // ---------- Escena: un canvas con su ciclo de animación ----------
  // tipo: confeti | globos | fuegos | brillos | mixto. modo: 'continuo' (no para) o 'rafaga' (una vez y termina)
  FX.escena = function(canvas, tipo, modo, opc) {
    opc = opc || {};
    var ctx = canvas.getContext('2d'), W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1), parts = [], vivo = true, visible = true, raf = 0, t0 = 0, inicio = performance.now();
    var dur = opc.duracion || 5200, cont = modo === 'continuo';
    var medir = function() { var r = canvas.getBoundingClientRect(); W = r.width; H = r.height; canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr)); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    medir();
    var densidad = Math.max(0.4, Math.min(1.6, W * H / (1200 * 600)));
    var siembra = function() {
      if (tipo === 'confeti' || tipo === 'mixto') {
        if (cont) for (var i = 0; i < 70 * densidad; i++) parts.push(confeti(azar(0, W), azar(-H, H), azar(-0.4, 0.4), azar(0.6, 2)));
        else {  // dos cañones desde las esquinas de abajo, como en una fiesta
          for (var j = 0; j < 160 * densidad; j++) { var izq = j % 2 === 0, ang = azar(55, 80) * Math.PI / 180, v = azar(9, 17) * Math.sqrt(H / 700 + 0.3);
            parts.push(confeti(izq ? W * 0.02 : W * 0.98, H + 5, (izq ? 1 : -1) * Math.cos(ang) * v * 0.55, -Math.sin(ang) * v)); }
        }
      }
      if (tipo === 'globos' || tipo === 'mixto') for (var g = 0; g < (cont ? 9 : 22) * densidad; g++) parts.push(globo(W, H, null, cont ? (g % 2 === 0 ? false : true) : true));
      if (tipo === 'brillos') for (var b = 0; b < 28 * densidad; b++) parts.push(brillo(W, H));
    };
    if (opc.rafagaEn) {  // explosión desde un punto (ej. una foto)
      var o = opc.rafagaEn;
      for (var k = 0; k < (opc.cantidad || 90); k++) { var a = azar(-Math.PI, 0), vv = azar(4, 11); parts.push(confeti(o.x, o.y, Math.cos(a) * vv, Math.sin(a) * vv - 2)); }
    } else siembra();
    var ultimoCohete = 0;
    var paso = function(t) {
      if (!vivo) return;
      raf = requestAnimationFrame(paso);
      if (!visible || document.hidden) { t0 = t; return; }
      var dt = t0 ? Math.min(3, (t - t0) / 16.67) : 1; t0 = t;
      var edad = t - inicio, nuevas = [];
      // en continuo se van agregando para que nunca se acabe
      if (cont) {
        if ((tipo === 'confeti' || tipo === 'mixto') && parts.length < 90 * densidad) parts.push(confeti(azar(0, W), -20, azar(-0.4, 0.4), azar(0.5, 1.5)));
        if ((tipo === 'globos' || tipo === 'mixto') && parts.filter(function(p) { return p.t === 'g'; }).length < 9 * densidad && Math.random() < 0.02 * dt) parts.push(globo(W, H));
      }
      if (tipo === 'fuegos' && (cont || edad < dur - 1500) && t - ultimoCohete > (cont ? 750 : 380) * azar(0.6, 1.4)) { ultimoCohete = t; parts.push(cohete(W, H)); }
      if (tipo === 'brillos' && !cont && edad > dur - 800) parts.forEach(function(p) { p.fin = true; });
      ctx.clearRect(0, 0, W, H);
      parts.forEach(function(p) { mover(p, W, H, dt, nuevas); });
      parts = parts.filter(function(p) { return p.vida > 0; }).concat(nuevas);
      if (!cont && edad > dur - 900) { var f = Math.max(0, (dur - edad) / 900); canvas.style.opacity = f; }
      parts.forEach(function(p) { dibujar(ctx, p); });
      if (!cont && (edad > dur || (!parts.length && edad > 600))) parar();
    };
    var io = 'IntersectionObserver' in window ? new IntersectionObserver(function(es) { visible = es[0].isIntersecting; }) : null; if (io) io.observe(canvas);
    var ro = 'ResizeObserver' in window ? new ResizeObserver(function() { medir(); }) : null; if (ro) ro.observe(canvas);
    var parar = function() { vivo = false; cancelAnimationFrame(raf); if (io) io.disconnect(); if (ro) ro.disconnect(); if (opc.alTerminar) opc.alTerminar(); };
    // si el canvas sale de la página (se volvió a dibujar), se detiene solo
    var vigila = setInterval(function() { if (!canvas.isConnected) { clearInterval(vigila); parar(); } }, 2000);
    raf = requestAnimationFrame(paso);
    return {parar: parar};
  };

  // Capa de efecto continuo dentro de una sección
  FX.TIPOS_SECCION = {confeti3d: 'confeti', globos: 'globos', fuegos: 'fuegos', brillos: 'brillos', fiesta: 'mixto'};
  FX.capa = function(tipo) {
    var c = document.createElement('canvas'); c.className = 'nvi-fx'; c.setAttribute('aria-hidden', 'true');
    if (FX.reducido()) return c;
    requestAnimationFrame(function() { if (c.isConnected) FX.escena(c, tipo, 'continuo'); else setTimeout(function() { if (c.isConnected) FX.escena(c, tipo, 'continuo'); }, 300); });
    return c;
  };

  // Celebración de pantalla completa (al abrir la página): dura unos segundos y desaparece
  FX.celebrar = function(tipo) {
    if (FX.reducido() || !tipo) return;
    var c = document.createElement('canvas'); c.className = 'nvi-fx-pantalla'; c.setAttribute('aria-hidden', 'true'); document.body.appendChild(c);
    FX.escena(c, tipo === 'fiesta' ? 'mixto' : tipo, 'rafaga', {duracion: tipo === 'fuegos' ? 6500 : tipo === 'globos' ? 9000 : 5200, alTerminar: function() { c.remove(); }});
  };

  // Efectos sobre una foto: confeti que sale de la foto, globos que salen de detrás o brillos alrededor
  FX.foto = function(marco, tipo) {
    if (FX.reducido()) return;
    var c = document.createElement('canvas'); c.className = 'nvi-fx-foto nvi-fx-foto-' + tipo; c.setAttribute('aria-hidden', 'true'); marco.appendChild(c);
    var escena = null, ultimo = 0;
    var lanzar = function() {
      var t = performance.now(); if (t - ultimo < 2500) return; ultimo = t;
      if (escena) escena.parar();
      var r = c.getBoundingClientRect();
      if (tipo === 'confeti') escena = FX.escena(c, 'confeti', 'rafaga', {rafagaEn: {x: r.width / 2, y: r.height * 0.55}, cantidad: 110, duracion: 3800});
      else if (tipo === 'globos') escena = FX.escena(c, 'globos', 'rafaga', {duracion: 8000});
      c.style.opacity = 1;
    };
    if (tipo === 'brillos') { requestAnimationFrame(function() { FX.escena(c, 'brillos', 'continuo'); }); return; }
    // al aparecer en pantalla y cada vez que se pasa el mouse
    if ('IntersectionObserver' in window) { var io = new IntersectionObserver(function(es) { if (es[0].isIntersecting) { io.disconnect(); setTimeout(lanzar, 350); } }, {threshold: 0.5}); io.observe(marco); }
    marco.addEventListener('mouseenter', lanzar);
  };
})();
