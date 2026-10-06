/* Nuvia Office: campo "Fecha de hoy". En las plantillas las fechas escritas se convierten en un campo
   <span data-campo="hoy" data-formato="{d} de {mmmm} de {aaaa}">…</span> que siempre muestra la fecha del día
   (en Word, en PowerPoint, en el PDF y en el .docx). */
(function() {
  'use strict';
  var NV = window.NV, F = NV.fechas = {};
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  F.MESES = MESES;
  function mayus(s, como) {
    if (como === 'MAY') return s.toUpperCase();
    if (como === 'Cap') return s.charAt(0).toUpperCase() + s.slice(1);
    return s;
  }
  function estiloDe(txt) { return txt === txt.toUpperCase() && txt !== txt.toLowerCase() ? 'MAY' : txt.charAt(0) === txt.charAt(0).toUpperCase() && txt.charAt(0) !== txt.charAt(0).toLowerCase() ? 'Cap' : 'min'; }
  var pad = function(n) { return ('0' + n).slice(-2); };
  // Formato → texto. Marcas: {d} {dd} {m} {mm} {mes} {mesc} {month} {aaaa} {aa} {dia} {day}; con sufijo :MAY o :Cap
  F.formatear = function(formato, fecha) {
    fecha = fecha || new Date();
    return String(formato || '{d} de {mes} de {aaaa}').replace(/\{(\w+)(?::(MAY|Cap|min))?\}/g, function(m, k, c) {
      var d = fecha.getDate(), mo = fecha.getMonth(), y = fecha.getFullYear();
      switch (k) {
        case 'd': return String(d); case 'dd': return pad(d);
        case 'm': return String(mo + 1); case 'mm': return pad(mo + 1);
        case 'mes': return mayus(MESES[mo], c); case 'mesc': return mayus(MESES_C[mo], c); case 'month': return mayus(MONTHS[mo], c || 'Cap');
        case 'aaaa': return String(y); case 'aa': return String(y).slice(-2);
        case 'dia': return mayus(DIAS[fecha.getDay()], c); case 'day': return mayus(DAYS[fecha.getDay()], c || 'Cap');
      }
      return m;
    });
  };
  F.FORMATOS = [  // para "Fecha y hora" (insertar a mano)
    '{dd}/{mm}/{aaaa}', '{dia:Cap}, {d} de {mes} de {aaaa}', '{d} de {mes} de {aaaa}', '{d} de {mes:Cap} de {aaaa}', '{mes:Cap} {d} de {aaaa}',
    '{aaaa}-{mm}-{dd}', '{d}-{mesc}-{aaaa}', '{mes:Cap} de {aaaa}', '{month} {d}, {aaaa}'
  ];
  F.span = function(formato, fecha) {
    return '<span data-campo="hoy" data-formato="' + NV.esc(formato) + '" class="nv-campo-fecha">' + NV.esc(F.formatear(formato, fecha)) + '</span>';
  };
  // Actualiza todos los campos de fecha dentro de un elemento (o de un texto HTML) a la fecha de hoy.
  F.actualizar = function(raiz, fecha) {
    var n = 0;
    Array.prototype.forEach.call(raiz.querySelectorAll('[data-campo="hoy"]'), function(s) {
      var t = F.formatear(s.getAttribute('data-formato'), fecha);
      if (s.textContent !== t) { s.textContent = t; n++; }
    });
    return n;
  };
  F.actualizarHtml = function(html, fecha) {
    if (!html || html.indexOf('data-campo="hoy"') < 0) return html;
    var d = document.createElement('div'); d.innerHTML = html; F.actualizar(d, fecha); return d.innerHTML;
  };

  // ---------- Detección de fechas escritas ----------
  var mesRe = '(' + MESES.concat(MESES_C, MONTHS, ['setiembre']).map(function(x) { return x; }).join('|') + ')';
  var diaRe = '(' + DIAS.concat(['miercoles', 'sabado'], DAYS).join('|') + ')';
  var PATRONES = [
    // [lunes, ]5 de octubre de 2026   /   5 de octubre del 2026
    {re: new RegExp('(?:' + diaRe + ',?\\s+)?(\\d{1,2})\\s+de\\s+' + mesRe + '\\s+(?:de|del)\\s+(\\d{4})', 'gi'), f: function(m) {
      return (m[1] ? '{dia:' + estiloDe(m[1]) + '}' + m[0].slice(m[1].length, m[0].indexOf(m[2], m[1].length)) : '') + (m[2].length === 2 && m[2][0] === '0' ? '{dd}' : '{d}') +
        ' de {' + tipoMes(m[3]) + ':' + estiloDe(m[3]) + '} ' + (/del/i.test(m[0]) ? 'del' : 'de') + ' {aaaa}';
    }, ok: function(m) { return mesN(m[3]) >= 0 && +m[2] >= 1 && +m[2] <= 31; }},
    // octubre 5 de 2026  /  October 5, 2026
    {re: new RegExp(mesRe + '\\s+(\\d{1,2}),?\\s+(de\\s+)?(\\d{4})', 'gi'), f: function(m) {
      return '{' + tipoMes(m[1]) + ':' + estiloDe(m[1]) + '} {d}' + (m[0].indexOf(',') >= 0 ? ',' : '') + ' ' + (m[3] ? 'de ' : '') + '{aaaa}';
    }, ok: function(m) { return mesN(m[1]) >= 0 && +m[2] >= 1 && +m[2] <= 31; }},
    // 5 October 2026 / 5 oct 2026
    {re: new RegExp('\\b(\\d{1,2})\\s+' + mesRe + '\\.?\\s+(\\d{4})', 'gi'), f: function(m) {
      return '{d} {' + tipoMes(m[2]) + ':' + estiloDe(m[2]) + '} {aaaa}';
    }, ok: function(m) { return mesN(m[2]) >= 0 && +m[1] >= 1 && +m[1] <= 31; }},
    // 2026-10-05
    {re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, f: function() { return '{aaaa}-{mm}-{dd}'; }, ok: function(m) { return +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31; }},
    // 05/10/2026, 5-10-2026, 05.10.26 (día primero, como en Colombia)
    {re: /\b(\d{1,2})([/.\-])(\d{1,2})\2(\d{4}|\d{2})\b/g, f: function(m) {
      return (m[1].length === 2 ? '{dd}' : '{d}') + m[2] + (m[3].length === 2 ? '{mm}' : '{m}') + m[2] + (m[4].length === 4 ? '{aaaa}' : '{aa}');
    }, ok: function(m) { return +m[1] >= 1 && +m[1] <= 31 && +m[3] >= 1 && +m[3] <= 12; }}
  ];
  function mesN(t) {
    t = t.toLowerCase(); if (t === 'setiembre') return 8;
    var i = MESES.indexOf(t); if (i >= 0) return i; i = MESES_C.indexOf(t.replace('.', '')); if (i >= 0) return i; return MONTHS.indexOf(t);
  }
  function tipoMes(t) { t = t.toLowerCase(); return MONTHS.indexOf(t) >= 0 && MESES.indexOf(t) < 0 ? 'month' : (MESES_C.indexOf(t) >= 0 ? 'mesc' : 'mes'); }
  // Busca fechas en el texto de un elemento. Devuelve [{texto, formato, nodo, inicio, fin}].
  F.buscar = function(raiz) {
    var res = [], w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {acceptNode: function(n) {
      return n.parentNode && n.parentNode.closest && n.parentNode.closest('[data-campo]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }}), n;
    while ((n = w.nextNode())) {
      var ocupado = [];
      PATRONES.forEach(function(p) {
        p.re.lastIndex = 0; var m;
        while ((m = p.re.exec(n.data))) {
          var ini = m.index, fin = ini + m[0].length;
          if (!p.ok(m) || ocupado.some(function(o) { return ini < o[1] && fin > o[0]; })) continue;
          ocupado.push([ini, fin]);
          res.push({texto: m[0], formato: p.f(m), nodo: n, inicio: ini, fin: fin});
        }
      });
    }
    return res;
  };
  // Convierte las fechas elegidas en campos. "elegidas" = índices de F.buscar (por defecto todas).
  F.convertir = function(raiz, encontradas, elegidas) {
    var porNodo = new Map();
    encontradas.forEach(function(f, i) { if (elegidas && elegidas.indexOf(i) < 0) return; if (!porNodo.has(f.nodo)) porNodo.set(f.nodo, []); porNodo.get(f.nodo).push(f); });
    var n = 0;
    porNodo.forEach(function(lista, nodo) {
      lista.sort(function(a, b) { return b.inicio - a.inicio; });  // de atrás hacia adelante
      lista.forEach(function(f) {
        var despues = nodo.splitText(f.fin), medio = nodo.splitText(f.inicio);
        var s = document.createElement('span'); s.setAttribute('data-campo', 'hoy'); s.setAttribute('data-formato', f.formato); s.className = 'nv-campo-fecha';
        s.textContent = F.formatear(f.formato);
        medio.parentNode.replaceChild(s, medio);
        n++; void despues;
      });
    });
    return n;
  };
  // Diálogo: muestra las fechas encontradas para elegir cuáles quedan como "Fecha de hoy".
  F.elegir = function(textos) {  // textos: [{texto, contexto}]
    if (!textos.length) return Promise.resolve([]);
    var h = '<p style="margin-top:0;line-height:1.5;font-size:13.5px">Se encontraron estas fechas en la plantilla. Las marcadas se mostrarán siempre con la <b>fecha del día</b> en que se use la plantilla (con el mismo formato).</p>' +
      '<div style="max-height:300px;overflow:auto;border:1px solid #e1dfdd;border-radius:6px;padding:4px 10px">' + textos.map(function(t, i) {
        return '<label class="nv-chk" style="align-items:flex-start"><input type="checkbox" data-i="' + i + '" checked style="margin-top:3px"><span><b>' + NV.esc(t.texto) + '</b>' +
          (t.contexto ? '<br><small style="color:#605e5c">…' + NV.esc(t.contexto) + '…</small>' : '') + '</span></label>';
      }).join('') + '</div>';
    return NV.dialogo({titulo: 'Fechas de la plantilla', html: h, ancho: 520, botones: [
      {texto: 'Aceptar', prim: true, accion: function(d) { return NV.$$('input[data-i]', d).filter(function(c) { return c.checked; }).map(function(c) { return +c.dataset.i; }); }},
      {texto: 'Ninguna', valor: []}]}).then(function(v) { return v || []; });
  };
  F.contexto = function(f) { var t = f.nodo.data; return t.slice(Math.max(0, f.inicio - 30), Math.min(t.length, f.fin + 30)).replace(/\s+/g, ' '); };
  // Formato de fecha de Word (campo DATE \@ "…") a partir del formato de Nuvia.
  F.formatoWord = function(formato) {
    var partes = [], i = 0, re = /\{(\w+)(?::(\w+))?\}/g, m, lit = function(s) { if (s) partes.push("'" + s.replace(/'/g, "''") + "'"); };
    while ((m = re.exec(formato))) {
      lit(formato.slice(i, m.index)); i = re.lastIndex;
      partes.push({d: 'd', dd: 'dd', m: 'M', mm: 'MM', mes: 'MMMM', mesc: 'MMM', month: 'MMMM', aaaa: 'yyyy', aa: 'yy', dia: 'dddd', day: 'dddd'}[m[1]] || '');
    }
    lit(formato.slice(i));
    return partes.join('');
  };
})();
