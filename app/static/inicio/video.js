/* Videos de la página de Inicio de Design (solo en el editor):
   - Subida por partes de 4 MB (el servidor nunca tiene el video entero en memoria) con reintentos.
   - "Recortar video": si pesa más del límite, se elige el tramo a subir. El tramo no puede durar más de lo que cabe
     en el límite. Se recorta con ffmpeg.wasm sin volver a comprimir (misma calidad, segundos de espera). */
(function() {
  'use strict';
  var NVI = window.NVI, h = NVI.h, esc = NVI.esc;
  var FF = {
    ffmpeg: 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js',
    worker: 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/814.ffmpeg.js',
    core: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
    wasm: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm'
  };
  var MB = 1048576;
  function mb(n) { return n >= 10 * MB ? Math.round(n / MB) + ' MB' : (n / MB).toFixed(1) + ' MB'; }
  function tiempo(s) { s = Math.max(0, s || 0); var m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1); }

  // ---------- Subida por partes ----------
  function enviar(url, cuerpo, tipo, progreso) {
    return new Promise(function(ok, mal) {
      var x = new XMLHttpRequest(); x.open('POST', url); if (tipo) x.setRequestHeader('Content-Type', tipo);
      if (progreso) x.upload.onprogress = function(e) { if (e.lengthComputable) progreso(e.loaded); };
      x.onload = function() { var d = {}; try { d = JSON.parse(x.responseText); } catch (e) {} if (x.status >= 200 && x.status < 300) ok(d); else { var er = new Error(d.detail || ('Error ' + x.status)); er.status = x.status; mal(er); } };
      x.onerror = function() { var er = new Error('Sin conexión'); er.status = 0; mal(er); }; x.send(cuerpo);
    });
  }
  NVI.subirVideoPorPartes = function(archivo, progreso) {
    var datos = {nombre: archivo.name, mime: archivo.type || '', tamano: archivo.size};
    return enviar('/design/api/inicio/medios/subida', JSON.stringify(datos), 'application/json').then(function(ini) {
      var n = 0, total = ini.partes, P = ini.parte;
      var una = function(intento) {
        var trozo = archivo.slice(n * P, Math.min(archivo.size, (n + 1) * P));
        return enviar('/design/api/inicio/medios/subida/' + ini.subida + '/parte/' + n, trozo, 'application/octet-stream', function(c) { if (progreso) progreso((n * P + c) / archivo.size); })
          .catch(function(e) {   // la conexión se cortó o el servidor tardó: se reintenta esa parte (hasta 4 veces)
            if (intento < 4 && (!e.status || e.status >= 500)) return new Promise(function(r) { setTimeout(r, 1200 * (intento + 1)); }).then(function() { return una(intento + 1); });
            throw e;
          });
      };
      var siguiente = function() { if (n >= total) return null; return una(0).then(function() { n++; return siguiente(); }); };
      return Promise.resolve(siguiente()).then(function() { if (progreso) progreso(1); return enviar('/design/api/inicio/medios/subida/' + ini.subida + '/fin', JSON.stringify(datos), 'application/json'); });
    });
  };

  // ---------- ffmpeg.wasm (se descarga solo la primera vez que alguien recorta) ----------
  var cargado = null;
  function blobURL(url, tipo, progreso) {
    return fetch(url).then(function(r) {
      if (!r.ok) throw new Error('No se pudo descargar el recortador');
      var total = +r.headers.get('content-length') || 0;
      if (!progreso || !r.body || !total) return r.blob();
      var lector = r.body.getReader(), partes = [], recibido = 0;
      var leer = function() { return lector.read().then(function(x) { if (x.done) return new Blob(partes); partes.push(x.value); recibido += x.value.length; progreso(recibido / total); return leer(); }); };
      return leer();
    }).then(function(b) { return URL.createObjectURL(new Blob([b], {type: tipo})); });
  }
  function cargarFfmpeg(progreso) {
    if (cargado) return cargado;
    cargado = new Promise(function(ok, mal) {
      if (window.FFmpegWASM) return ok();
      var s = document.createElement('script'); s.src = FF.ffmpeg; s.onload = function() { ok(); }; s.onerror = function() { mal(new Error('No se pudo cargar el recortador (revisa la conexión)')); }; document.head.appendChild(s);
    }).then(function() {
      return Promise.all([blobURL(FF.core, 'text/javascript'), blobURL(FF.wasm, 'application/wasm', progreso), blobURL(FF.worker, 'text/javascript')]);
    }).then(function(u) {
      var ff = new window.FFmpegWASM.FFmpeg();
      return ff.load({coreURL: u[0], wasmURL: u[1], classWorkerURL: u[2]}).then(function() { return ff; });
    });
    cargado.catch(function() { cargado = null; });
    return cargado;
  }
  var nMontaje = 0;
  function montar(ff, archivo) {
    var dir = '/entrada' + (++nMontaje);
    return ff.createDir(dir).then(function() { return ff.mount('WORKERFS', {files: [archivo]}, dir); }).then(function() {
      return {ruta: dir + '/' + archivo.name, soltar: function() { return ff.unmount(dir).then(function() { return ff.deleteDir(dir); }).catch(function() {}); }};
    });
  }
  NVI.recortarConFfmpeg = function(archivo, ini, fin, progreso, limite) {
    var ext = ((archivo.name.match(/\.[a-z0-9]+$/i) || ['.mp4'])[0]).toLowerCase(), entrada = '', mont = null, salida = 'recorte' + (ext === '.mov' || ext === '.m4v' ? '.mp4' : ext);
    return cargarFfmpeg(function(x) { if (progreso) progreso('Preparando el recortador (solo la primera vez)… ' + Math.round(x * 100) + '%'); }).then(function(ff) {
      if (progreso) progreso('Recortando…');
      return montar(ff, archivo).then(function(m) { mont = m; entrada = m.ruta; }).then(function() {
        // -ss antes de -i: salta directo al punto (rápido); -c copy: sin volver a comprimir (misma calidad)
        var args = ['-ss', ini.toFixed(3), '-i', entrada, '-t', (fin - ini).toFixed(3), '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-avoid_negative_ts', 'make_zero'];
        if (/\.mp4$/.test(salida)) args.push('-movflags', '+faststart');   // así empieza a verse antes de terminar de cargar
        args.push(salida);
        return ff.exec(args);
      }).then(function() { return ff.readFile(salida); }).then(function(d) {
        // sin recomprimir el corte empieza en el fotograma clave anterior: si así pasa del límite, se recomprime
        // exactamente el tramo elegido con el peso justo (más lento, pero siempre cabe)
        if (!limite || d.length <= limite) return d;
        var dur = fin - ini, kbps = Math.max(250, Math.floor((limite * 0.9 * 8 / dur - 128000) / 1000)), webm = /\.webm$/.test(salida);
        var cod = webm ? ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libvorbis', '-b:a', '128k'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'];
        var oir = function(e) { if (progreso) progreso('Ajustando el peso del video… ' + Math.max(0, Math.min(100, Math.round(e.progress * 100))) + '%'); };
        ff.on('progress', oir);
        try { ff.deleteFile(salida); } catch (e) {}
        return ff.exec(['-ss', ini.toFixed(3), '-i', entrada, '-t', dur.toFixed(3), '-map', '0:v:0', '-map', '0:a:0?'].concat(cod, ['-b:v', kbps + 'k', '-maxrate', Math.round(kbps * 1.2) + 'k', '-bufsize', kbps * 2 + 'k', salida]))
          .then(function() { ff.off('progress', oir); return ff.readFile(salida); });
      }).then(function(d) {
        try { ff.deleteFile(salida); } catch (e) {} if (mont) mont.soltar();
        var nombre = archivo.name.replace(/\.[a-z0-9]+$/i, '') + ' (recorte)' + salida.slice(salida.lastIndexOf('.'));
        return new File([d.buffer], nombre, {type: /\.webm$/.test(salida) ? 'video/webm' : /\.og[gv]$/.test(salida) ? 'video/ogg' : 'video/mp4'});
      }).catch(function(er) { if (mont) mont.soltar(); try { ff.deleteFile(salida); } catch (e) {} throw er; });
    });
  };
  // duración: primero con el reproductor del navegador; si no la conoce, se le pregunta a ffmpeg
  function duracion(url, archivo) {
    return new Promise(function(ok) {
      var v = document.createElement('video'); v.preload = 'metadata'; v.muted = true;
      var listo = false, fin = function(d) { if (listo) return; listo = true; ok(d); };
      v.onloadedmetadata = function() { if (isFinite(v.duration) && v.duration > 0) fin(v.duration); else { v.currentTime = 1e7; v.ontimeupdate = function() { v.ontimeupdate = null; fin(isFinite(v.duration) ? v.duration : 0); }; } };
      v.onerror = function() { fin(0); }; setTimeout(function() { fin(0); }, 8000); v.src = url;
    }).then(function(d) {
      if (d) return d;
      return cargarFfmpeg().then(function(ff) {
        var log = '', oir = function(e) { log += e.message + '\n'; }; ff.on('log', oir);
        var mo = null;
        return montar(ff, archivo).then(function(m) { mo = m; return ff.exec(['-i', m.ruta]); }).catch(function() {}).then(function() {
          ff.off('log', oir); if (mo) mo.soltar();
          var m = log.match(/Duration:\s*(\d+):(\d+):([\d.]+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
        });
      });
    });
  }

  // ---------- Ventana "Recortar video" ----------
  NVI.recortarVideo = function(archivo, limite) {
    return new Promise(function(resolver, rechazar) {
      var url = URL.createObjectURL(archivo);
      var bg = h('div', 'nvi-dlg-bg'), d = h('div', 'nvi-dlg nvi-ed-rec'); bg.appendChild(d);
      d.innerHTML = '<h3>Recortar video</h3>' +
        '<p class="nvi-ed-ayuda">"' + esc(archivo.name) + '" pesa <b>' + mb(archivo.size) + '</b> y el máximo es <b>' + mb(limite) + '</b>. Elige el tramo que quieres subir: arrastra la franja azul o sus bordes.</p>' +
        '<div class="nvi-rec-vista"><video playsinline preload="auto"></video><div class="nvi-rec-cargando">Leyendo el video…</div></div>' +
        '<div class="nvi-rec-linea"><div class="nvi-rec-fotos"></div><div class="nvi-rec-tramo"><i data-b="ini"></i><i data-b="fin"></i></div><div class="nvi-rec-cabezal"></div></div>' +
        '<div class="nvi-rec-info"><span class="nvi-rec-txt"></span><span class="nvi-rec-max"></span></div>' +
        '<div class="nvi-rec-estado" hidden></div>' +
        '<div class="nvi-dlg-bot"><button type="button" class="nvi-b2" data-a="ver">▶ Ver el tramo</button><span style="flex:1"></span><button type="button" class="nvi-b2" data-a="cancelar">Cancelar</button><button type="button" class="nvi-b1" data-a="listo" disabled>Recortar y subir</button></div>';
      var v = d.querySelector('video'), linea = d.querySelector('.nvi-rec-linea'), tramo = d.querySelector('.nvi-rec-tramo'), cab = d.querySelector('.nvi-rec-cabezal');
      var txt = d.querySelector('.nvi-rec-txt'), maxTxt = d.querySelector('.nvi-rec-max'), estado = d.querySelector('.nvi-rec-estado'), bListo = d.querySelector('[data-a=listo]');
      var dur = 0, maxDur = 0, ini = 0, fin = 0, ocupado = false, verHasta = null;
      var pintar = function() {
        if (!dur) return;
        tramo.style.left = (ini / dur * 100) + '%'; tramo.style.width = ((fin - ini) / dur * 100) + '%';
        var est = archivo.size * (fin - ini) / dur;
        txt.innerHTML = 'Tramo: <b>' + tiempo(ini) + ' – ' + tiempo(fin) + '</b> (' + tiempo(fin - ini) + ') · tamaño aprox. <b>' + mb(est) + '</b>';
        maxTxt.textContent = 'Máximo ' + tiempo(maxDur);
      };
      var cerrar = function() { v.pause(); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); bg.remove(); };
      v.src = url; v.muted = false;
      duracion(url, archivo).then(function(t) {
        dur = t; d.querySelector('.nvi-rec-cargando').remove();
        if (!dur) { estado.hidden = false; estado.textContent = 'No se pudo leer la duración de este video. Prueba con otro formato (MP4 o WEBM).'; return; }
        // el tramo más largo que cabe en el límite (con un 4 % de margen, porque el peso no es igual en todo el video)
        maxDur = Math.max(1, Math.min(dur, dur * (limite * 0.96) / archivo.size)); ini = 0; fin = maxDur;
        bListo.disabled = false; pintar(); miniaturas();
      });
      v.addEventListener('timeupdate', function() { if (dur) cab.style.left = (v.currentTime / dur * 100) + '%'; if (verHasta != null && v.currentTime >= verHasta) { v.pause(); verHasta = null; } });
      // miniaturas de la línea de tiempo (si el navegador puede leer los cuadros de este formato)
      function miniaturas() {
        var fotos = d.querySelector('.nvi-rec-fotos'), N = 10, w = document.createElement('video'), k = 0;
        w.muted = true; w.preload = 'auto'; w.src = url;
        var una = function() {
          if (k >= N || !bg.isConnected) { w.removeAttribute('src'); w.load(); return; }
          w.currentTime = Math.min(dur - 0.05, (k + 0.5) * dur / N);
        };
        w.addEventListener('seeked', function() {
          try { var c = document.createElement('canvas'); c.width = 160; c.height = 90; c.getContext('2d').drawImage(w, 0, 0, 160, 90); var im = h('div'); im.style.backgroundImage = 'url(' + c.toDataURL('image/jpeg', 0.6) + ')'; fotos.appendChild(im); } catch (e) {}
          k++; una();
        });
        w.addEventListener('loadeddata', una); w.onerror = function() {};
      }
      // arrastrar la franja o sus bordes; clic en la línea: mueve el cabezal
      linea.addEventListener('pointerdown', function(e) {
        if (!dur || ocupado) return; e.preventDefault();
        var R = linea.getBoundingClientRect(), b = e.target.getAttribute && e.target.getAttribute('data-b'), enTramo = e.target === tramo, x0 = e.clientX, i0 = ini, f0 = fin;
        var t = function(x) { return Math.max(0, Math.min(dur, (x - R.left) / R.width * dur)); };
        if (!b && !enTramo) { v.currentTime = t(e.clientX); return; }
        linea.setPointerCapture(e.pointerId);
        var mov = function(ev) {
          var dt = (ev.clientX - x0) / R.width * dur;
          if (b === 'ini') { ini = Math.max(0, Math.max(f0 - maxDur, Math.min(f0 - 1, i0 + dt))); v.currentTime = ini; }
          else if (b === 'fin') { fin = Math.min(dur, Math.min(i0 + maxDur, Math.max(i0 + 1, f0 + dt))); v.currentTime = fin; }
          else { var largo = f0 - i0; ini = Math.max(0, Math.min(dur - largo, i0 + dt)); fin = ini + largo; v.currentTime = ini; }
          pintar();
        };
        var sol = function() { linea.removeEventListener('pointermove', mov); linea.removeEventListener('pointerup', sol); linea.removeEventListener('pointercancel', sol); };
        linea.addEventListener('pointermove', mov); linea.addEventListener('pointerup', sol); linea.addEventListener('pointercancel', sol);
      });
      d.onclick = function(e) {
        var a = e.target.closest('[data-a]'); if (!a || ocupado) return;
        if (a.dataset.a === 'cancelar') { cerrar(); rechazar(new Error('Recorte cancelado')); }
        if (a.dataset.a === 'ver' && dur) { v.currentTime = ini; verHasta = fin; v.play().catch(function() {}); }
        if (a.dataset.a === 'listo' && dur) {
          ocupado = true; v.pause(); bListo.disabled = true; estado.hidden = false; estado.classList.remove('error');
          NVI.recortarConFfmpeg(archivo, ini, fin, function(m) { estado.textContent = m; }, limite).then(function(nuevo) {
            if (nuevo.size > limite) {   // el peso no es parejo en todo el video: se pide acortar un poco más
              ocupado = false; bListo.disabled = false; estado.classList.add('error');
              estado.textContent = 'El recorte quedó de ' + mb(nuevo.size) + ' (máx. ' + mb(limite) + '). Acorta un poco el tramo y vuelve a intentarlo.';
              maxDur = Math.max(1, (fin - ini) * limite * 0.95 / nuevo.size); if (fin - ini > maxDur) fin = ini + maxDur; pintar(); return;
            }
            cerrar(); resolver(nuevo);
          }).catch(function(er) { ocupado = false; bListo.disabled = false; estado.classList.add('error'); estado.textContent = 'No se pudo recortar: ' + (er && er.message || er); });
        }
      };
      document.body.appendChild(bg);
    });
  };
})();
