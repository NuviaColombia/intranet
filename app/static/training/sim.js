// Training: laboratorio 3D de movimientos (arcos generados por código), animaciones guiadas y visor de modelos 3D.
// Unidades en mm. Ejes: +x = lado IZQUIERDO del paciente (a la derecha de la pantalla en la vista frontal), +y = arriba (apical),
// +z = hacia adelante (facial). Los signos de los parámetros siguen el formato de Training (ver README del contenido).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { h, t, ui, md, S, CFG, api, toast, vaciar } from './lib.js';

// ---------- Parámetros del lenguaje de modificación ----------
const PARAMS = {
  vdo:      { min: -5, max: 5, paso: 0.5, nombre: { es: 'VDO (dimensión vertical)', en: 'VDO (vertical dimension)' }, ayuda: { es: '+ abre la mordida (el arco inferior baja)', en: '+ opens the bite (the lower arch moves down)' } },
  incisal:  { min: -5, max: 5, paso: 0.5, nombre: { es: 'Incisal Edge', en: 'Incisal Edge' }, ayuda: { es: '+ apically (sube) · − incisally (baja)', en: '+ apically (up) · − incisally (down)' } },
  midline:  { min: -3, max: 3, paso: 0.5, nombre: { es: 'Midline', en: 'Midline' }, ayuda: { es: '+ derecha del paciente · − izquierda', en: '+ patient’s right · − left' } },
  cant:     { min: -3, max: 3, paso: 0.5, nombre: { es: 'Occlusal Cant', en: 'Occlusal Cant' }, ayuda: { es: '+ canino izquierdo apically · − occlusally', en: '+ left canine apically · − occlusally' } },
  plano:    { min: -3, max: 3, paso: 0.5, nombre: { es: 'Occlusal Plane', en: 'Occlusal Plane' }, ayuda: { es: '+ molares apically · − occlusally', en: '+ molars apically · − occlusally' } },
  rotacion: { min: -3, max: 3, paso: 0.5, nombre: { es: 'Arch Rotation', en: 'Arch Rotation' }, ayuda: { es: '+ molares a la derecha · − a la izquierda', en: '+ molars to the right · − to the left' } },
  labio:    { min: -3, max: 3, paso: 0.5, nombre: { es: 'Lip Support', en: 'Lip Support' }, ayuda: { es: '+ facially (adelante) · − palatally (atrás)', en: '+ facially (forward) · − palatally (back)' } },
  tamano:   { min: 0, max: 5, paso: 1, nombre: { es: 'Arch Size', en: 'Arch Size' }, ayuda: { es: 'A, AW, B, BW, C, CW', en: 'A, AW, B, BW, C, CW' } },
  grado:    { min: 5, max: 10, paso: 5, nombre: { es: 'Degree', en: 'Degree' }, ayuda: { es: 'Inclinación de los incisivos', en: 'Incisor inclination' } },
};
const ORDEN = ['vdo', 'incisal', 'midline', 'cant', 'plano', 'rotacion', 'labio', 'tamano', 'grado'];
const INICIAL = { vdo: 0, incisal: 0, midline: 0, cant: 0, plano: 0, rotacion: 0, labio: 0, tamano: 0, grado: 5 };
const TAMANOS = ['A', 'AW', 'B', 'BW', 'C', 'CW'];
const COLOR_TAM = ['#e6d3a8', '#e8777b', '#6fc58a', '#a98bf0', '#f0a3c4', '#6aa4f5'];
const ESCALA_TAM = [1, 1, 1.1, 1.1, 1.21, 1.21], ANCHO_EXTRA = [0, 4.5, 0, 4.5, 0, 4.5];

// Frase oficial de la receta (RX). El lenguaje de Nuvia es en inglés en ambos idiomas.
export function fraseRx(k, v) {
  const a = Math.abs(v), n = (x) => String(x).replace(/\.0$/, '');
  if (k === 'tamano') return TAMANOS[Math.round(v)] || '';
  if (k === 'grado') return String(v);
  if (!v) return null;
  switch (k) {
    case 'vdo': return `${v > 0 ? '+' : '−'}${n(a)} mm`;
    case 'incisal': return v < 0 ? `Move incisally ${n(a)}mm (Down)` : `Move apically ${n(a)}mm (Up)`;
    case 'midline': return v > 0 ? `Move right ${n(a)}mm` : `Move left ${n(a)}mm`;
    case 'cant': return v < 0 ? `Move left occlusally ${n(a)}mm (down)` : `Move left apically ${n(a)}mm (up)`;
    case 'plano': return v < 0 ? `Move occlusally ${n(a)}mm (down)` : `Move apically ${n(a)}mm (up)`;
    case 'rotacion': return v > 0 ? `Move right ${n(a)}mm` : `Move left ${n(a)}mm`;
    case 'labio': return v > 0 ? `Move facially ${n(a)}mm (forward)` : `Move palatally ${n(a)}mm (back)`;
    default: return null;
  }
}

// ---------- Geometría de los arcos ----------
const DIENTES = [ // por lado, desde la línea media: ancho, alto de corona, grosor
  { w: 8.5, h: 10.5, g: 7.0, inc: true }, { w: 6.5, h: 9.5, g: 6.2, inc: true }, { w: 7.5, h: 10.5, g: 8.0 },
  { w: 7.0, h: 8.0, g: 9.0 }, { w: 7.0, h: 7.5, g: 9.0 }, { w: 10, h: 7.0, g: 10.5 }, { w: 9.5, h: 6.5, g: 10 }];
const K = 0.0455, Z0 = 24, ESC_DIENTE = 0.93;
const zEn = (x, k, z0) => z0 - k * x * x;
const Z_INC = Z0, Z_PALADAR = 4, Z_MOLAR = -12;

function centrosPorArco(k) {   // posición x de cada diente, caminando sobre la curva por longitud de arco
  const out = []; let x = 0, s = 0, objetivo = 0;
  const acumulado = []; let suma = 0;
  DIENTES.forEach((d) => { acumulado.push(suma + (d.w * ESC_DIENTE) / 2); suma += d.w * ESC_DIENTE; });
  for (const obj of acumulado) {
    objetivo = obj;
    while (s < objetivo) { const dx = 0.05, dz = -2 * k * x * dx; s += Math.hypot(dx, dz); x += dx; }
    out.push(x);
  }
  return out;
}

function materialDiente(color) { return new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.02 }); }

function construirArco(sup, opc) {
  const o = { k: K, z0: Z0, escX: 1, dz: 0, colorDiente: '#f3eee1', colorBase: '#e9b0b0', ...(opc || {}) };
  const g = new THREE.Group(), dientes = [], materiales = [], incisivos = [];
  const centros = centrosPorArco(o.k), signo = sup ? 1 : -1;
  const matD = materialDiente(o.colorDiente); materiales.push(matD);
  const geo = new THREE.CapsuleGeometry(0.5, 1, 6, 14);
  DIENTES.forEach((d, i) => {
    for (const lado of [1, -1]) {
      const x = centros[i] * lado * o.escX, z = zEn(centros[i] * lado, o.k, o.z0) + o.dz;
      const tx = 1, tz = -2 * o.k * (centros[i] * lado);   // tangente
      const nrm = Math.hypot(tx, tz), nx = -tz / nrm, nz = tx / nrm;   // normal hacia afuera (facial)
      const phi = Math.atan2(nx, nz);
      const hd = d.h * ESC_DIENTE, ancho = d.w * ESC_DIENTE;
      const grupo = new THREE.Group(); grupo.position.set(x, signo * hd, z); grupo.rotation.y = phi;   // cuello del diente
      const pivote = new THREE.Group(); grupo.add(pivote);
      const mesh = new THREE.Mesh(geo, matD); mesh.scale.set(ancho, hd / 2, d.g * 0.8); mesh.position.set(0, -signo * hd / 2, 0);
      pivote.add(mesh); g.add(grupo); dientes.push(mesh);
      if (d.inc) incisivos.push({ pivote, hd });
    }
  });
  // base de la prótesis (acrílico) y, en el superior, la mandíbula/maxilar blanco que no se mueve
  const pts = []; for (let x = -HALF() * o.escX; x <= HALF() * o.escX + 0.01; x += 2) pts.push(new THREE.Vector3(x, signo * (11.2), zEn(x / o.escX, o.k, o.z0) + o.dz - 2.2));
  const curva = new THREE.CatmullRomCurve3(pts);
  const matB = new THREE.MeshStandardMaterial({ color: o.colorBase, roughness: 0.55 }); materiales.push(matB);
  const base = new THREE.Mesh(new THREE.TubeGeometry(curva, 60, 4.6, 12, false), matB); g.add(base);
  return { grupo: g, dientes, materiales, matDiente: matD, matBase: matB, incisivos, base };
}
function HALF() { return 27.5; }

function maxilar() {
  const pts = []; for (let x = -26; x <= 26.01; x += 2) pts.push(new THREE.Vector3(x, 19.4, zEn(x, K, Z0) - 3.6));
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 5.2, 12, false),
    new THREE.MeshStandardMaterial({ color: '#f5f6f8', roughness: 0.7, transparent: true, opacity: 0.92 }));
  m.name = 'maxilar';
  return m;
}

const M4 = (fn) => { const m = new THREE.Matrix4(); fn(m); return m; };
function rotarEn(pivote, eje, ang) {   // rotación alrededor de un punto
  const R = new THREE.Matrix4().makeRotationAxis(eje, ang);
  return new THREE.Matrix4().makeTranslation(pivote.x, pivote.y, pivote.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-pivote.x, -pivote.y, -pivote.z));
}

// ---------- Escena del laboratorio ----------
export class Lab {
  constructor(contenedor, opc) {
    this.cont = contenedor; this.opc = { modo: 'sigue', vista: 'frontal', ...(opc || {}) };
    this.P = { ...INICIAL }; this.dirty = true; this.anim = null; this.camAnim = null; this.activa = null;
    this.mostrarFantasma = true; this.mostrarEstatico = false; this.mostrarOclusion = this.opc.modo === 'fijo';
    this.etiquetas = []; this.onCambio = null; this.vivo = true;
    this.ro = new ResizeObserver(() => this.redimensionar());
    this.ro.observe(contenedor);
    this.iniciado = false;
    requestAnimationFrame(() => this.iniciar());
  }
  iniciar() {
    if (this.iniciado || !this.vivo) return;
    const w = this.cont.clientWidth, hh = this.cont.clientHeight;
    if (!w || !hh) { requestAnimationFrame(() => this.iniciar()); return; }
    this.iniciado = true;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.setSize(w, hh); r.domElement.className = 'tr-canvas'; r.domElement.setAttribute('aria-label', '3D');
    this.cont.prepend(r.domElement);
    this.escena = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(32, w / hh, 1, 1000);
    this.escena.add(new THREE.HemisphereLight('#ffffff', '#b9c4d6', 1.05));
    const sol = new THREE.DirectionalLight('#ffffff', 1.15); sol.position.set(40, 90, 80); this.escena.add(sol);
    const luz2 = new THREE.DirectionalLight('#dbe7ff', 0.45); luz2.position.set(-60, 20, -40); this.escena.add(luz2);
    const lampara = new THREE.DirectionalLight('#ffffff', 1.25); this.cam.add(lampara); this.escena.add(this.cam);   // luz que acompaña a la cámara: se ve bien desde cualquier vista
    this.controles = new OrbitControls(this.cam, r.domElement);
    this.controles.enableDamping = true; this.controles.dampingFactor = 0.12; this.controles.target.set(0, 4, 6); this.controles.minDistance = 40; this.controles.maxDistance = 220;
    this.controles.addEventListener('change', () => { this.dirty = true; });
    this.tamGrupo = new THREE.Group(); this.escena.add(this.tamGrupo);
    this.tamGrupo.add(maxilar());
    this.sup = construirArco(true); this.inf = construirArco(false, { escX: 0.94, dz: -2.2, colorDiente: '#ebe5d4', colorBase: '#a8b8d0' });
    this.fan = construirArco(true, { colorDiente: '#6ea8ff', colorBase: '#6ea8ff' });
    this.fan.materiales.forEach((m) => { m.transparent = true; m.opacity = 0.3; m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = 2; m.polygonOffsetUnits = 2; });
    for (const a of [this.sup, this.inf, this.fan]) { a.grupo.matrixAutoUpdate = false; this.tamGrupo.add(a.grupo); }
    // marcadores: punto estático y flecha
    this.marca = new THREE.Group(); this.marca.visible = false;
    this.marca.add(new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 16), new THREE.MeshBasicMaterial({ color: '#ffc400', depthTest: false })));
    const aro = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.2, 32), new THREE.MeshBasicMaterial({ color: '#ffc400', side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.8 })); this.marca.add(aro);
    this.marca.renderOrder = 10; this.marca.traverse((x) => { x.renderOrder = 10; }); this.tamGrupo.add(this.marca);
    this.flecha = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 8, 0xff7a1a, 3, 2); this.flecha.visible = false; this.flecha.traverse((x) => { x.renderOrder = 11; if (x.material) x.material.depthTest = false; });
    this.tamGrupo.add(this.flecha);
    // etiquetas de lado del paciente
    this.capa = h('div', { class: 'tr-capa' }); this.cont.append(this.capa);
    this.lblR = this.etiqueta('R', new THREE.Vector3(-44, 0, 8), 'tr-lbl-lado'); this.lblL = this.etiqueta('L', new THREE.Vector3(44, 0, 8), 'tr-lbl-lado');
    this.lblEst = this.etiqueta(ui('estatico'), new THREE.Vector3(), 'tr-lbl-est'); this.lblEst.el.hidden = true;
    this.estado = h('div', { class: 'tr-estado-ocl', hidden: true, 'aria-live': 'polite' }); this.cont.append(this.estado);
    this.ponerVista(this.opc.vista, false);
    this.aplicar();
    this.bucle = () => { if (!this.vivo) return; requestAnimationFrame(this.bucle); this.paso(); };
    requestAnimationFrame(this.bucle);
  }
  etiqueta(txt, pos, cls) { const el = h('span', { class: 'tr-lbl ' + cls }, txt); this.capa.append(el); const e = { el, pos }; this.etiquetas.push(e); return e; }
  redimensionar() {
    if (!this.iniciado) return;
    const w = this.cont.clientWidth, hh = this.cont.clientHeight; if (!w || !hh) return;
    this.renderer.setSize(w, hh); this.cam.aspect = w / hh; this.cam.updateProjectionMatrix(); this.dirty = true;
  }

  // ----- vistas de cámara -----
  ponerVista(v, animar = true) {
    const vistas = {
      frontal: { pos: [0, 14, 118], up: [0, 1, 0], tgt: [0, 3, 6] },
      perfil: { pos: [-118, 10, 6], up: [0, 1, 0], tgt: [0, 3, 6] },   // desde el lado derecho del paciente: la cara mira a la derecha
      oclusal: { pos: [0, -128, 6], up: [0, 0, 1], tgt: [0, 0, 6] },   // desde abajo: se ve el arco superior (el inferior se oculta)
    };
    this.vista = v; const d = vistas[v] || vistas.frontal;
    if (this.inf) { this.inf.grupo.visible = v !== 'oclusal'; this.dirty = true; }
    if (v === 'libre') { this.lblR.el.hidden = this.lblL.el.hidden = false; return; }
    const destino = { pos: new THREE.Vector3(...d.pos), up: new THREE.Vector3(...d.up), tgt: new THREE.Vector3(...d.tgt) };
    this.lblR.el.hidden = this.lblL.el.hidden = v === 'perfil';
    if (!animar || !this.iniciado) { this.cam.position.copy(destino.pos); this.cam.up.copy(destino.up); this.controles.target.copy(destino.tgt); this.cam.lookAt(destino.tgt); this.dirty = true; return; }
    this.camAnim = { t0: performance.now(), dur: 650, de: { pos: this.cam.position.clone(), up: this.cam.up.clone(), tgt: this.controles.target.clone() }, a: destino };
  }

  // ----- parámetros -----
  poner(k, v, animar) { this.animarA({ [k]: v }, animar ? 250 : 0); this.activa = k; }
  ponerTodo(p, ms) { this.animarA({ ...INICIAL, ...p }, ms); }
  animarA(destino, ms, alTerminar) {
    const de = { ...this.P }, a = { ...this.P, ...destino };
    const cambiados = ORDEN.filter((k) => Math.abs(a[k] - de[k]) > 1e-6);
    if (cambiados.length) this.activa = cambiados.sort((x, y) => Math.abs(a[y] - de[y]) - Math.abs(a[x] - de[x]))[0];
    if (!ms) { this.anim = null; this.P = a; this.aplicar(); if (alTerminar) alTerminar(); return; }
    this.anim = { t0: performance.now(), dur: ms, de, a, fin: alTerminar };
  }
  reiniciar() { this.activa = null; this.animarA({ ...INICIAL }, 450); }
  paso() {
    const ahora = performance.now();
    if (this.anim) {
      const k = Math.min(1, (ahora - this.anim.t0) / this.anim.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      for (const key of ORDEN) this.P[key] = this.anim.de[key] + (this.anim.a[key] - this.anim.de[key]) * e;
      this.aplicar();
      if (k >= 1) { const f = this.anim.fin; this.P = { ...this.anim.a }; this.anim = null; this.aplicar(); if (f) f(); }
    }
    if (this.camAnim) {
      const c = this.camAnim, k = Math.min(1, (ahora - c.t0) / c.dur), e = 1 - Math.pow(1 - k, 3);
      this.cam.position.lerpVectors(c.de.pos, c.a.pos, e); this.cam.up.lerpVectors(c.de.up, c.a.up, e).normalize();
      this.controles.target.lerpVectors(c.de.tgt, c.a.tgt, e); this.cam.lookAt(this.controles.target); this.dirty = true;
      if (k >= 1) this.camAnim = null;
    }
    this.controles.update();
    if (this.dirty) { this.dirty = false; this.renderer.render(this.escena, this.cam); this.ubicarEtiquetas(); }
  }
  ubicarEtiquetas() {
    const w = this.cont.clientWidth, hh = this.cont.clientHeight, v = new THREE.Vector3();
    for (const e of this.etiquetas) {
      if (e.el.hidden) continue;
      v.copy(e.pos); this.tamGrupo.localToWorld(v); v.project(this.cam);
      e.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * hh}px) translate(-50%, -50%)`;
      e.el.style.opacity = v.z < 1 ? 1 : 0;
    }
  }

  // ----- aplicar los parámetros a la escena -----
  aplicar() {
    if (!this.iniciado) return;
    const P = this.P, rad = Math.PI / 180;
    // tamaño del arco: escala continua y color
    const i0 = Math.max(0, Math.min(5, Math.floor(P.tamano))), i1 = Math.min(5, i0 + 1), f = P.tamano - i0;
    const esc = ESCALA_TAM[i0] + (ESCALA_TAM[i1] - ESCALA_TAM[i0]) * f, extra = ANCHO_EXTRA[i0] + (ANCHO_EXTRA[i1] - ANCHO_EXTRA[i0]) * f;
    this.tamGrupo.scale.set(esc * (1 + extra / (54 * esc)), esc, esc);
    const col = new THREE.Color(COLOR_TAM[i0]).lerp(new THREE.Color(COLOR_TAM[i1]), f);
    this.sup.matBase.color.copy(col);
    // cadena de movimientos del superior (cada rotación alrededor de su punto estático)
    const inc = new THREE.Vector3(0, 0, Z_INC), pal = new THREE.Vector3(0, 0, Z_PALADAR);
    const rMid = Math.hypot(Z_INC - Z_PALADAR) || 1;
    let M = new THREE.Matrix4().makeTranslation(0, P.incisal, 0);
    M = rotarEn(pal, new THREE.Vector3(0, 1, 0), -P.midline / rMid).multiply(M);                       // midline: giro alrededor del centro del paladar
    M = rotarEn(inc, new THREE.Vector3(0, 0, 1), P.cant / 17).multiply(M);                            // cant: giro frontal sobre el borde incisal medio
    M = rotarEn(inc, new THREE.Vector3(1, 0, 0), P.plano / (Z_INC - Z_MOLAR)).multiply(M);            // plano oclusal: giro sagital
    M = rotarEn(inc, new THREE.Vector3(0, 1, 0), P.rotacion / (Z_INC - Z_MOLAR)).multiply(M);         // rotación del arco (yaw)
    M = new THREE.Matrix4().makeTranslation(0, 0, P.labio).multiply(M);                                // soporte labial
    this.sup.grupo.matrix.copy(M); this.sup.grupo.matrixWorldNeedsUpdate = true;
    const baja = new THREE.Matrix4().makeTranslation(0, -P.vdo, 0);
    this.inf.grupo.matrix.copy(this.opc.modo === 'fijo' ? baja : M.clone().multiply(baja)); this.inf.grupo.matrixWorldNeedsUpdate = true;
    const cambio = ORDEN.some((k) => k !== 'vdo' && Math.abs(P[k] - INICIAL[k]) > 0.05);
    this.fan.grupo.matrix.identity(); this.fan.grupo.visible = this.mostrarFantasma && cambio;
    this.fan.grupo.matrixWorldNeedsUpdate = true;
    // grado de los incisivos (5° o 10°)
    const tilt = -(P.grado * rad);
    for (const arco of [this.sup, this.fan]) arco.incisivos.forEach((i) => { i.pivote.rotation.x = tilt; });
    // punto estático y flecha del movimiento activo
    this.actualizarGuias();
    this.actualizarOclusion();
    this.dirty = true;
    if (this.onCambio) this.onCambio(this.P);
  }
  actualizarGuias() {
    const k = this.activa, p = this.P, pivotes = { midline: [0, 14, Z_PALADAR], cant: [0, 0, Z_INC], plano: [0, 0, Z_INC], rotacion: [0, 0, Z_INC] };
    const hay = k && pivotes[k] && Math.abs(p[k]) > 0.01 && this.mostrarEstatico;
    this.marca.visible = !!hay; this.lblEst.el.hidden = !hay;
    if (hay) { this.marca.position.set(...pivotes[k]); this.lblEst.pos.set(pivotes[k][0] + 9, pivotes[k][1] + 7, pivotes[k][2]); }
    const dir = { vdo: [0, -1, 0], incisal: [0, 1, 0], labio: [0, 0, 1] }[k];
    const hayF = k && dir && Math.abs(p[k]) > 0.01 && this.mostrarEstatico;
    this.flecha.visible = !!hayF;
    if (hayF) {
      const sg = Math.sign(p[k]) * (k === 'vdo' ? 1 : 1), d = new THREE.Vector3(...dir).multiplyScalar(k === 'vdo' ? 1 : sg);
      this.flecha.position.set(k === 'labio' ? 0 : 34, k === 'vdo' ? -2 : 5, k === 'labio' ? 30 : Z_INC - 6); this.flecha.setDirection(d.normalize()); this.flecha.setLength(10 + Math.abs(p[k]) * 2, 3, 2);
    }
  }
  // Indicador de oclusión (antagonista fijo): contacto / interferencia / sin ocluir
  actualizarOclusion() {
    const rel = this.P.incisal + this.P.vdo;   // 0 = las cúspides se tocan
    this.estado.hidden = !(this.mostrarOclusion && this.opc.modo === 'fijo');
    let tipo = 'ok', txt = ui('contacto');
    if (rel < -0.15) { tipo = 'mal'; txt = `${ui('interferencia')} ${Math.abs(rel).toFixed(1).replace('.0', '')} mm: ${ui('interfTxt')}`; }
    else if (rel > 0.15) { tipo = 'aviso'; txt = `${ui('sinOcluir')} (${rel.toFixed(1).replace('.0', '')} mm): ${ui('espacioTxt')}`; }
    this.estado.className = 'tr-estado-ocl ' + tipo; this.estado.textContent = txt;
    if (this.inf) {
      const rojo = new THREE.Color('#ff5a5a'), base = new THREE.Color('#ebe5d4');
      this.inf.matDiente.color.copy(tipo === 'mal' ? rojo : base);
      this.inf.matDiente.emissive.set(tipo === 'mal' ? '#6b0000' : '#000000');
    }
    this.oclusion = tipo;
  }
  setFantasma(v) { this.mostrarFantasma = v; this.aplicar(); }
  setEstatico(v) { this.mostrarEstatico = v; this.aplicar(); }
  setOclusion(v) { this.mostrarOclusion = v; this.aplicar(); }
  destroy() {
    this.vivo = false; if (this.ro) this.ro.disconnect();
    if (!this.iniciado) return;
    this.controles.dispose();
    this.escena.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}

// ---------- Interfaz: simulador con controles ----------
function filaControl(k, lab, onInput) {
  const sp = PARAMS[k], fila = h('div', { class: 'tr-ctl', data: { k } });
  const val = h('output', { class: 'tr-ctl-val' });
  const nombre = h('label', { class: 'tr-ctl-nom' }, t(sp.nombre), h('small', null, t(sp.ayuda)));
  let ent;
  if (k === 'tamano') {
    ent = h('div', { class: 'tr-seg', role: 'group', 'aria-label': t(sp.nombre) }, TAMANOS.map((n, i) => h('button', { type: 'button', class: 'tr-seg-b', style: { '--c': COLOR_TAM[i] }, onclick: () => onInput(i), data: { v: i } }, n)));
  } else if (k === 'grado') {
    ent = h('div', { class: 'tr-seg', role: 'group', 'aria-label': t(sp.nombre) }, [5, 10].map((n) => h('button', { type: 'button', class: 'tr-seg-b', onclick: () => onInput(n), data: { v: n } }, n + '°')));
  } else {
    ent = h('input', { type: 'range', min: sp.min, max: sp.max, step: sp.paso, value: 0, 'aria-label': t(sp.nombre), oninput: (e) => onInput(parseFloat(e.target.value)) });
  }
  fila.append(h('div', { class: 'tr-ctl-cab' }, nombre, val), ent);
  return { fila, ent, val };
}

function textoValor(k, v) {
  if (k === 'tamano') return TAMANOS[Math.round(v)];
  if (k === 'grado') return Math.round(v) + '°';
  return (v > 0 ? '+' : '') + String(Math.round(v * 10) / 10).replace(/\.0$/, '') + ' mm';
}

export function crearSimulador(opts) {
  const o = { foco: ['todo'], vista: 'frontal', modo: 'sigue', titulo: null, guia: null, reto: null, libre: false, ...(opts || {}) };
  const claves = o.foco.includes('todo') ? ORDEN : ORDEN.filter((k) => o.foco.includes(k));
  const lienzo = h('div', { class: 'tr-lienzo' });
  const lab = new Lab(lienzo, { modo: o.modo, vista: o.vista });
  lab.mostrarEstatico = true;
  const controles = {}, panel = h('div', { class: 'tr-panel-ctl' });
  const rxLista = h('ul', { class: 'tr-rx-lista' }), rx = h('div', { class: 'tr-rx' }, h('div', { class: 'tr-rx-tit' }, '℞ ' + ui('receta')), rxLista);
  const retoCaja = o.reto ? h('div', { class: 'tr-reto' }) : null;

  const refrescar = () => {
    for (const k of claves) {
      const c = controles[k]; if (!c) continue;
      const v = lab.P[k];
      if (k === 'tamano') c.ent.querySelectorAll('.tr-seg-b').forEach((b) => b.classList.toggle('on', +b.dataset.v === Math.round(v)));
      else if (k === 'grado') c.ent.querySelectorAll('.tr-seg-b').forEach((b) => b.classList.toggle('on', +b.dataset.v === Math.round(v)));
      else if (document.activeElement !== c.ent || true) c.ent.value = v;
      c.val.textContent = textoValor(k, v); c.fila.classList.toggle('mod', k === 'tamano' || k === 'grado' ? false : Math.abs(v) > 0.01);
    }
    const lineas = [];
    for (const k of ORDEN) {
      if (!claves.includes(k) || k === 'tamano' || k === 'grado') { if (!claves.includes(k)) continue; }
      const f = fraseRx(k, lab.P[k]);
      if (k === 'tamano' || k === 'grado') { if (Math.round(lab.P[k]) !== INICIAL[k]) lineas.push([t(PARAMS[k].nombre), f]); }
      else if (f) lineas.push([t(PARAMS[k].nombre), f]);
    }
    rxLista.replaceChildren(...(lineas.length ? lineas.map(([a, b]) => h('li', null, h('b', null, a + ': '), b)) : [h('li', { class: 'tr-rx-vacio' }, ui('sinCambios'))]));
    if (retoCaja) pintarReto();
  };
  const onInput = (k) => (v) => { lab.activa = k; lab.animarA({ [k]: v }, k === 'tamano' || k === 'grado' ? 350 : 0); if (k !== 'tamano' && k !== 'grado') { lab.P[k] = v; lab.aplicar(); } refrescar(); };
  lab.onCambio = () => refrescar();
  for (const k of claves) { const c = filaControl(k, null, onInput(k)); controles[k] = c; panel.append(c.fila); }

  function pintarReto() {
    const obj = o.reto.objetivo, tol = o.reto.tolerancia ?? 0.25;
    const estados = Object.keys(obj).map((k) => {
      const ok = (k === 'tamano' || k === 'grado') ? Math.round(lab.P[k]) === obj[k] : Math.abs(lab.P[k] - obj[k]) <= tol + 1e-6;
      return { k, ok };
    });
    const todo = estados.every((e) => e.ok);
    retoCaja.className = 'tr-reto' + (todo ? ' ok' : '');
    retoCaja.replaceChildren(h('div', { class: 'tr-reto-tit' }, (todo ? '🎉 ' + ui('retoOk') : '🎯 ' + ui('reto'))), md(o.reto.enunciado, { sinGlosario: true }),
      h('div', { class: 'tr-reto-chips' }, estados.map((e) => h('span', { class: 'tr-chip ' + (e.ok ? 'ok' : '') }, (e.ok ? '✓ ' : '○ ') + t(PARAMS[e.k].nombre) + ': ' + textoValor(e.k, obj[e.k])))),
      todo ? null : h('div', { class: 'tr-sub' }, ui('retoFalta')));
  }

  const vistas = h('div', { class: 'tr-seg tr-seg-vistas', role: 'group', 'aria-label': ui('simVista') },
    ['frontal', 'perfil', 'oclusal', 'libre'].map((v) => h('button', { type: 'button', class: 'tr-seg-b' + (v === o.vista ? ' on' : ''), onclick: (e) => { lab.ponerVista(v); vistas.querySelectorAll('.tr-seg-b').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, ui(v))));
  const opciones = h('div', { class: 'tr-opts' },
    h('label', null, h('input', { type: 'checkbox', checked: true, onchange: (e) => lab.setFantasma(e.target.checked) }), ui('fantasma')),
    h('label', null, h('input', { type: 'checkbox', checked: true, onchange: (e) => lab.setEstatico(e.target.checked) }), ui('estatico')),
    o.libre ? h('label', null, h('input', { type: 'checkbox', onchange: (e) => { lab.opc.modo = e.target.checked ? 'fijo' : 'sigue'; lab.mostrarOclusion = e.target.checked; lab.aplicar(); } }), ui('antagonistaFijo')) : null,
    h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => { lab.reiniciar(); } }, '↺ ' + ui('reiniciar')));
  const barra = h('div', { class: 'tr-sim-barra' }, vistas, opciones);
  const el = h('div', { class: 'tr-sim' },
    o.titulo ? h('h2', { class: 'tr-paso-tit' }, t(o.titulo)) : null, o.guia ? h('div', { class: 'tr-sim-guia' }, md(o.guia, { maxTerminos: 3 })) : null,
    h('div', { class: 'tr-sim-cuerpo' }, h('div', { class: 'tr-sim-izq' }, lienzo, barra, h('div', { class: 'tr-sub tr-sim-ayuda' }, ui('girar'))), h('div', { class: 'tr-sim-der' }, retoCaja, panel, rx)));
  setTimeout(refrescar, 0);
  return { el, lab, destroy: () => lab.destroy() };
}

export function crearSimuladorPaso(p) {
  return crearSimulador({ foco: p.foco, vista: p.vista || 'frontal', modo: p.modo || 'sigue', titulo: p.titulo, guia: p.guia, reto: p.reto });
}
export function crearLaboratorio() { return crearSimulador({ foco: ['todo'], libre: true, modo: 'sigue' }); }

// ---------- Animación guiada (tour) ----------
export function crearTourPaso(p) {
  const lienzo = h('div', { class: 'tr-lienzo' });
  const lab = new Lab(lienzo, { modo: p.modo || 'sigue', vista: (p.escenas[0] && p.escenas[0].cam) || 'frontal' });
  const sub = h('div', { class: 'tr-tour-sub', 'aria-live': 'polite' }), puntos = h('div', { class: 'tr-tour-puntos' });
  let idx = 0, reproduciendo = false, velocidad = 1, temporizador = null, vivo = true;
  const escenas = p.escenas;
  const btnPlay = h('button', { type: 'button', class: 'tr-btn tr-btn-primario tr-tour-play', 'aria-label': ui('play') }, '▶');
  const rxLinea = h('div', { class: 'tr-tour-rx' });
  const pintarPuntos = () => puntos.replaceChildren(...escenas.map((_, i) => h('button', { type: 'button', class: 'tr-punto' + (i === idx ? ' act' : (i < idx ? ' hecho' : '')), 'aria-label': ui('escena') + ' ' + (i + 1), onclick: () => { parar(); ir(i); } })));
  function ir(i) {
    idx = Math.max(0, Math.min(escenas.length - 1, i)); const e = escenas[idx];
    const res = e.resaltar || [];
    lab.mostrarFantasma = res.includes('fantasma'); lab.mostrarEstatico = res.includes('estatico'); lab.mostrarOclusion = res.includes('oclusion') && lab.opc.modo === 'fijo';
    if (e.cam && e.cam !== lab.vista) lab.ponerVista(e.cam);
    const dur = Math.max(500, (e.seg || 4) * 1000 * 0.55 / velocidad);
    lab.animarA({ ...INICIAL, ...(e.p || {}) }, dur, () => { if (reproduciendo && vivo) temporizador = setTimeout(() => { if (idx < escenas.length - 1) ir(idx + 1); else parar(true); }, (e.seg || 4) * 1000 * 0.45 / velocidad); });
    sub.replaceChildren(h('span', { class: 'tr-tour-n' }, `${idx + 1}/${escenas.length}`), md(e.texto, { sinGlosario: true }));
    const f = Object.keys(e.p || {}).map((k) => { const x = fraseRx(k, e.p[k]); return x && k !== 'tamano' && k !== 'grado' ? `${t(PARAMS[k].nombre)}: ${x}` : null; }).filter(Boolean);
    rxLinea.textContent = f.length ? '℞ ' + f.join('  ·  ') : '';
    pintarPuntos();
  }
  function parar(fin) { reproduciendo = false; clearTimeout(temporizador); btnPlay.textContent = fin ? '↻' : '▶'; btnPlay.setAttribute('aria-label', fin ? ui('repetirTour') : ui('play')); if (fin) btnPlay.dataset.fin = '1'; }
  function reproducir() {
    if (btnPlay.dataset.fin) { delete btnPlay.dataset.fin; idx = 0; ir(0); }
    reproduciendo = true; btnPlay.textContent = '⏸'; btnPlay.setAttribute('aria-label', ui('pausa'));
    if (!lab.anim) { clearTimeout(temporizador); temporizador = setTimeout(() => { if (idx < escenas.length - 1) ir(idx + 1); else parar(true); }, 600); }
  }
  btnPlay.onclick = () => (reproduciendo ? parar() : reproducir());
  const vel = h('select', { 'aria-label': ui('velocidad'), onchange: (e) => { velocidad = parseFloat(e.target.value); } }, [0.5, 1, 1.5].map((v) => h('option', { value: v, selected: v === 1 }, v + '×')));
  const barra = h('div', { class: 'tr-tour-barra' },
    h('button', { type: 'button', class: 'tr-btn tr-btn-chico', 'aria-label': ui('anterior'), onclick: () => { parar(); ir(idx - 1); } }, '⏮'), btnPlay,
    h('button', { type: 'button', class: 'tr-btn tr-btn-chico', 'aria-label': ui('siguiente'), onclick: () => { parar(); ir(idx + 1); } }, '⏭'), puntos, vel);
  const el = h('div', { class: 'tr-sim tr-tour' }, h('h2', { class: 'tr-paso-tit' }, '🎬 ' + t(p.titulo)), h('div', { class: 'tr-lienzo-w' }, lienzo, sub), rxLinea, barra);
  lab.mostrarFantasma = false; setTimeout(() => ir(0), 80); pintarPuntos();
  return { el, destroy: () => { vivo = false; clearTimeout(temporizador); lab.destroy(); } };
}

// ---------- Visor de modelos 3D subidos por los admins ----------
async function cargarModelo(info) {
  const r = await fetch(info.url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error('modelo ' + r.status);
  const buf = await r.arrayBuffer();
  const mat = () => new THREE.MeshStandardMaterial({ color: '#efe9da', roughness: 0.5, metalness: 0.03, side: THREE.DoubleSide });
  if (info.formato === 'glb') {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    return new Promise((ok, mal) => new GLTFLoader().parse(buf, '', (g) => ok(g.scene), mal));
  }
  if (info.formato === 'stl') { const { STLLoader } = await import('three/addons/loaders/STLLoader.js'); const g = new STLLoader().parse(buf); g.computeVertexNormals(); return new THREE.Mesh(g, mat()); }
  if (info.formato === 'ply') {
    const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js'); const g = new PLYLoader().parse(buf); g.computeVertexNormals();
    const m = mat(); if (g.hasAttribute('color')) m.vertexColors = true; return new THREE.Mesh(g, m);
  }
  if (info.formato === 'obj') { const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js'); const o = new OBJLoader().parse(new TextDecoder().decode(buf)); o.traverse((x) => { if (x.isMesh) { x.material = mat(); if (!x.geometry.attributes.normal) x.geometry.computeVertexNormals(); } }); return o; }
  throw new Error('formato');
}

class Visor {
  constructor(cont, info, esAdmin, alGuardar) {
    this.cont = cont; this.info = info; this.esAdmin = esAdmin; this.alGuardar = alGuardar; this.vivo = true; this.dirty = true; this.pines = [];
    this.anot = JSON.parse(JSON.stringify(info.anotaciones || [])); this.modoPin = false; this.recorrido = null;
    const w = cont.clientWidth || 600, hh = cont.clientHeight || 440;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); r.setSize(w, hh); r.localClippingEnabled = true; r.domElement.className = 'tr-canvas'; cont.prepend(r.domElement);
    this.escena = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera(35, w / hh, 0.1, 5000);
    this.escena.add(new THREE.HemisphereLight('#ffffff', '#b9c4d6', 1.1)); const sol = new THREE.DirectionalLight('#ffffff', 1.2); sol.position.set(50, 100, 80); this.escena.add(sol);
    this.escena.add(new THREE.DirectionalLight('#dbe7ff', 0.5).translateX(-60).translateY(20).translateZ(-40));
    this.controles = new OrbitControls(this.cam, r.domElement); this.controles.enableDamping = true; this.controles.addEventListener('change', () => { this.dirty = true; });
    this.plano = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6); this.capa = h('div', { class: 'tr-capa' }); cont.append(this.capa);
    this.ro = new ResizeObserver(() => this.redim()); this.ro.observe(cont);
    this.raycaster = new THREE.Raycaster();
    r.domElement.addEventListener('click', (e) => this.alClic(e));
    this.bucle = () => { if (!this.vivo) return; requestAnimationFrame(this.bucle); this.controles.update(); if (this.camAnim) this.pasoCam(); if (this.dirty) { this.dirty = false; r.render(this.escena, this.cam); this.ubicarPines(); } };
    requestAnimationFrame(this.bucle);
  }
  async cargar() {
    const obj = await cargarModelo(this.info);
    const caja = new THREE.Box3().setFromObject(obj), tam = caja.getSize(new THREE.Vector3()), c = caja.getCenter(new THREE.Vector3());
    const esc = 100 / Math.max(tam.x, tam.y, tam.z, 1e-6); obj.scale.multiplyScalar(esc); obj.position.sub(c.multiplyScalar(esc));
    this.escena.add(obj); this.obj = obj; this.meshes = [];
    obj.traverse((x) => { if (x.isMesh) { this.meshes.push(x); x.material = [].concat(x.material).map((m) => { m = m.clone(); m.clippingPlanes = [this.plano]; m.side = THREE.DoubleSide; return m; }); if (x.material.length === 1) x.material = x.material[0]; } });
    this.alturaMax = new THREE.Box3().setFromObject(obj).max.y; this.alturaMin = new THREE.Box3().setFromObject(obj).min.y;
    this.cam.position.set(0, 20, 170); this.controles.target.set(0, 0, 0); this.cam.lookAt(0, 0, 0); this.vistaInicial = { pos: this.cam.position.clone(), tgt: new THREE.Vector3() };
    this.pintarPines(); this.dirty = true;
  }
  redim() { const w = this.cont.clientWidth, hh = this.cont.clientHeight; if (!w || !hh) return; this.renderer.setSize(w, hh); this.cam.aspect = w / hh; this.cam.updateProjectionMatrix(); this.dirty = true; }
  reiniciarVista() { this.irA(this.vistaInicial.pos, this.vistaInicial.tgt); }
  irA(pos, tgt) { this.camAnim = { t0: performance.now(), dur: 800, de: { pos: this.cam.position.clone(), tgt: this.controles.target.clone() }, a: { pos: pos.clone(), tgt: tgt.clone() } }; }
  pasoCam() { const c = this.camAnim, k = Math.min(1, (performance.now() - c.t0) / c.dur), e = 1 - Math.pow(1 - k, 3); this.cam.position.lerpVectors(c.de.pos, c.a.pos, e); this.controles.target.lerpVectors(c.de.tgt, c.a.tgt, e); this.dirty = true; if (k >= 1) this.camAnim = null; }
  setAlambre(v) { this.meshes.forEach((m) => [].concat(m.material).forEach((x) => { x.wireframe = v; })); this.dirty = true; }
  setCorte(pct) {   // 0 = sin corte; 1..100 = corta desde arriba hacia abajo
    if (pct <= 0) { this.plano.constant = 1e6; } else { const y = this.alturaMax - (this.alturaMax - this.alturaMin) * (pct / 100); this.plano.constant = y; }
    this.dirty = true;
  }
  setFondo(oscuro) { this.cont.classList.toggle('oscuro', oscuro); }
  // pines
  pintarPines() {
    this.pines.forEach((p) => p.el.remove()); this.pines = [];
    this.anot.forEach((a, i) => { const el = h('button', { type: 'button', class: 'tr-pin', 'aria-label': t(a.titulo) || ('Pin ' + (i + 1)), onclick: (ev) => { ev.stopPropagation(); this.abrirPin(i); } }, i + 1); this.capa.append(el); this.pines.push({ el, pos: new THREE.Vector3(...a.p) }); });
    this.dirty = true;
  }
  ubicarPines() {
    const w = this.cont.clientWidth, hh = this.cont.clientHeight, v = new THREE.Vector3();
    for (const p of this.pines) { v.copy(p.pos).project(this.cam); p.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * hh}px) translate(-50%, -50%)`; p.el.style.display = v.z < 1 ? '' : 'none'; }
  }
  abrirPin(i, desdeRecorrido) {
    const a = this.anot[i]; this.cerrarPin();
    const caja = h('div', { class: 'tr-pin-caja' }, h('b', null, `${i + 1}. ${t(a.titulo)}`), md(a.texto, { sinGlosario: true }),
      h('div', { class: 'tr-pin-acc' }, this.esAdmin ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-btn-peligro', onclick: async () => { this.anot.splice(i, 1); await this.guardarPines(); this.cerrarPin(); this.pintarPines(); } }, ui('eliminar')) : null,
        h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => this.cerrarPin() }, ui('cerrar'))));
    this.cont.append(caja); this.pinCaja = caja;
    if (!desdeRecorrido) { const d = new THREE.Vector3(...a.p); this.irA(d.clone().add(new THREE.Vector3(0, 10, 70)), d); }
  }
  cerrarPin() { if (this.pinCaja) { this.pinCaja.remove(); this.pinCaja = null; } }
  async guardarPines() {
    try { const r = await api.post(`/design/api/training/modelos/${this.info.slot}/anotaciones`, { anotaciones: this.anot }); this.anot = r.anotaciones; } catch (e) { toast(ui('errorGenerico'), 'error'); }
  }
  alClic(e) {
    if (!this.modoPin || !this.meshes) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.cam);
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0]; if (!hit) return;
    this.modoPin = false; this.cont.classList.remove('colocando'); if (this.alModoPin) this.alModoPin(false);
    this.pedirTextoPin(hit.point.clone());
  }
  pedirTextoPin(punto) {
    const campo = (rot, tag) => { const e = h(tag, { class: 'tr-in', placeholder: rot, maxlength: tag === 'textarea' ? 400 : 80 }); return e; };
    const tEs = campo(ui('tituloPin') + ' (ES)', 'input'), tEn = campo(ui('tituloPin') + ' (EN)', 'input'), xEs = campo(ui('textoPin') + ' (ES)', 'textarea'), xEn = campo(ui('textoPin') + ' (EN)', 'textarea');
    const fondo = h('div', { class: 'tr-modal-fondo' }); const cerrar = () => fondo.remove();
    fondo.append(h('div', { class: 'tr-modal', role: 'dialog', 'aria-modal': 'true' }, h('h3', null, ui('agregarPin')), tEs, xEs, tEn, xEn,
      h('div', { class: 'tr-modal-acc' }, h('button', { type: 'button', class: 'tr-btn', onclick: cerrar }, ui('cancelar')),
        h('button', { type: 'button', class: 'tr-btn tr-btn-primario', onclick: async () => {
          if (!tEs.value.trim() && !tEn.value.trim()) return;
          this.anot.push({ p: [punto.x, punto.y, punto.z], titulo: { es: tEs.value.trim() || tEn.value.trim(), en: tEn.value.trim() || tEs.value.trim() }, texto: { es: xEs.value.trim() || xEn.value.trim(), en: xEn.value.trim() || xEs.value.trim() } });
          await this.guardarPines(); this.pintarPines(); cerrar();
        } }, ui('guardar')))));
    document.body.append(fondo); tEs.focus();
  }
  tour() {   // recorrido automático por los pines
    if (!this.anot.length) return; clearTimeout(this.recorrido); let i = 0;
    const sig = () => { if (!this.vivo || i >= this.anot.length) { this.cerrarPin(); return; } const a = this.anot[i], d = new THREE.Vector3(...a.p); this.irA(d.clone().add(new THREE.Vector3(0, 10, 75)), d); this.abrirPin(i, true); i++; this.recorrido = setTimeout(sig, 4500); };
    sig();
  }
  destroy() {
    this.vivo = false; clearTimeout(this.recorrido); this.ro.disconnect(); this.controles.dispose();
    this.escena.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}

export function crearModeloPaso(p) {
  const raiz = h('div', { class: 'tr-modelo' }), contenedor = h('div', { class: 'tr-lienzo' });
  let visor = null, destruido = false;
  const cab = h('div', { class: 'tr-modelo-cab' }, h('h2', { class: 'tr-paso-tit' }, '🧩 ' + t(p.titulo)), md(p.descripcion, { maxTerminos: 3 }));
  raiz.append(cab);
  const info = (S.modelos || {})[p.slot];
  const subirBtn = (rot) => {
    const f = h('input', { type: 'file', accept: '.glb,.stl,.obj,.ply', hidden: true, onchange: async () => {
      const arch = f.files[0]; if (!arch) return;
      const fd = new FormData(); fd.append('slot', p.slot); fd.append('archivo', arch);
      toast(ui('subiendo'));
      try { await api.subir('/design/api/training/modelos', fd); toast(ui('subidoOk'), 'ok'); await refrescarModelos(); pintar(); } catch (e) { toast(e.message || ui('errorGenerico'), 'error'); }
    } });
    return h('span', null, f, h('button', { type: 'button', class: 'tr-btn tr-btn-primario', onclick: () => f.click() }, '⬆ ' + rot));
  };
  const cuerpo = h('div', { class: 'tr-modelo-cuerpo' }); raiz.append(cuerpo);
  async function pintar() {
    if (visor) { visor.destroy(); visor = null; }
    vaciar(cuerpo); const m = (S.modelos || {})[p.slot];
    if (!m) {
      cuerpo.append(h('div', { class: 'tr-modelo-vacio' }, h('div', { class: 'tr-modelo-ico' }, '🦷'), h('h3', null, ui('modeloPend')), md(p.pendiente, { sinGlosario: true }),
        CFG.esAdmin ? subirBtn(ui('subirModelo')) : h('div', { class: 'tr-sub' }, ''), CFG.esAdmin ? h('div', { class: 'tr-sub' }, ui('formatos')) : null));
      return;
    }
    const cont = h('div', { class: 'tr-lienzo tr-lienzo-modelo' }, h('div', { class: 'tr-cargando-mini' }, h('div', { class: 'tr-spinner' }), ui('cargandoModelo')));
    cuerpo.append(cont);
    const barra = h('div', { class: 'tr-sim-barra tr-modelo-barra' }); cuerpo.append(barra, h('div', { class: 'tr-sub' }, ui('girar')));
    try {
      const v = visor = new Visor(cont, m, CFG.esAdmin, () => {}); await v.cargar(); if (destruido) { v.destroy(); return; }
      cont.querySelector('.tr-cargando-mini')?.remove();
      const corte = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, 'aria-label': ui('corte'), oninput: (e) => v.setCorte(+e.target.value) });
      const btnPin = h('button', { type: 'button', class: 'tr-btn tr-btn-chico', hidden: !CFG.esAdmin, onclick: () => { v.modoPin = !v.modoPin; cont.classList.toggle('colocando', v.modoPin); btnPin.classList.toggle('on', v.modoPin); if (v.modoPin) toast(ui('clicModelo')); } }, '📍 ' + ui('agregarPin'));
      v.alModoPin = (on) => btnPin.classList.toggle('on', on);
      barra.append(
        h('label', null, h('input', { type: 'checkbox', onchange: (e) => v.setAlambre(e.target.checked) }), ui('alambre')),
        h('label', null, h('input', { type: 'checkbox', onchange: (e) => v.setFondo(e.target.checked) }), ui('fondo') + ' ◐'),
        h('label', { class: 'tr-corte' }, ui('corte'), corte),
        h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => v.reiniciarVista() }, '⌂ ' + ui('reiniciarVista')),
        m.anotaciones && m.anotaciones.length ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico', onclick: () => v.tour() }, '▶ ' + ui('verRecorrido')) : null, btnPin,
        CFG.esAdmin ? subirBtn(ui('reemplazar')) : null,
        CFG.esAdmin ? h('button', { type: 'button', class: 'tr-btn tr-btn-chico tr-btn-peligro', onclick: async () => { if (!confirm(ui('quitar') + '?')) return; try { await api.post(`/design/api/training/modelos/${p.slot}/eliminar`, {}); await refrescarModelos(); pintar(); } catch (e) { toast(e.message, 'error'); } } }, ui('quitar')) : null);
    } catch (e) { console.error(e); cont.replaceChildren(h('div', { class: 'tr-error' }, ui('errorModelo'))); }
  }
  pintar();
  return { el: raiz, destroy: () => { destruido = true; if (visor) visor.destroy(); } };
}

export async function refrescarModelos() {
  try { const l = await api.get('/design/api/training/modelos'); S.modelos = Object.fromEntries(l.map((m) => [m.slot, m])); } catch (e) { S.modelos = S.modelos || {}; }
}
