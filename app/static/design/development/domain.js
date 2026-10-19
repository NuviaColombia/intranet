/* Generado por scripts/integrar_development.py desde control-proyectos/public. No editar a mano. */
/* Control de Proyectos y Protocolos · dominio y reglas de negocio */
"use strict";
/* =========================================================
   1. DOMINIO: catálogos y reglas de negocio
   ========================================================= */
const STATUSES = [
  {key:'propuesta', label:'Propuesta'},
  {key:'aprobado', label:'Aprobado'},
  {key:'desarrollo', label:'En desarrollo'},
  {key:'qa', label:'En pruebas (QA)'},
  {key:'lanzado', label:'Lanzado'},
  {key:'pausado', label:'Pausado'}
];
const STATUS_HELP = {
  propuesta:'Idea registrada. Aún no se invierte tiempo de desarrollo.',
  aprobado:'Objetivo, alcance y riesgos definidos; el sponsor dio el visto bueno.',
  desarrollo:'Diseño y estimación validados; el equipo está construyendo.',
  qa:'Código revisado y probado; validación en entorno de pruebas.',
  lanzado:'En producción con rollback, backup y protocolo actualizados.',
  pausado:'Detenido temporalmente. Requiere motivo.'
};
const FLOW = ['propuesta','aprobado','desarrollo','qa','lanzado'];
const TYPES = ['Desarrollo','Mejora','Protocolo'];
const PRIORITIES = [{k:'critica',l:'Crítica'},{k:'alta',l:'Alta'},{k:'media',l:'Media'},{k:'baja',l:'Baja'}];
const RISK_STATUS = [{k:'abierto',l:'Abierto'},{k:'mitigando',l:'Mitigando'},{k:'cerrado',l:'Cerrado'}];
const PROB_LBL = ['','Muy baja','Baja','Media','Alta','Muy alta'];
const IMP_LBL = ['','Mínimo','Menor','Moderado','Mayor','Severo'];
const CATS = [
  {k:'guia',l:'Guía',c:'var(--primary)',h:'Cómo hacemos las cosas aquí: procesos y flujos.'},
  {k:'practicas',l:'Buenas prácticas',c:'var(--ok)',h:'Recomendaciones técnicas para escribir mejor código.'},
  {k:'recurso',l:'Recurso',c:'var(--warn)',h:'Material externo para estudiar: artículos, docs, cursos.'},
  {k:'anuncio',l:'Anuncio',c:'#2563eb',h:'Cambios de reglas, fechas o decisiones del equipo.'}
];
const catLabel = k => (CATS.find(c=>c.k===k)||{}).l || k;

const GATES = {
  aprobado:[
    {k:'obj',t:'Objetivo y KPI de éxito definidos',h:'Evita construir algo sin saber cómo medir si funcionó.'},
    {k:'alc',t:'Alcance y criterios de aceptación escritos',h:'Previene el crecimiento descontrolado del alcance: qué entra, qué no y cómo se acepta.'},
    {k:'sponsor',t:'Aprobación del solicitante / sponsor',h:'Quien pidió el proyecto está de acuerdo antes de invertir tiempo.'},
    {k:'auto_risk',t:'Al menos 1 riesgo identificado',auto:true,h:'Se marca solo cuando registras un riesgo en la pestaña Riesgos.'}
  ],
  desarrollo:[
    {k:'dis',t:'Diseño técnico revisado',h:'Un segundo par de ojos sobre la arquitectura evita retrabajos costosos.'},
    {k:'est',t:'Estimación validada por el equipo',h:'Fechas realistas acordadas con quien construye, no impuestas.'},
    {k:'dep',t:'Dependencias e impactos identificados',h:'Qué otros módulos, equipos o protocolos se ven afectados.'}
  ],
  qa:[
    {k:'tests',t:'Pruebas automatizadas pasando',ev:true,h:'Atrapan regresiones antes de llegar a producción.\nRequiere evidencia: captura del reporte de pruebas.'},
    {k:'cr',t:'Code review aprobado',ev:true,h:'Otro desarrollador revisó y aprobó el código.\nRequiere evidencia: captura del PR aprobado.'},
    {k:'env',t:'Entorno de QA con datos de prueba',h:'Datos realistas (anonimizados) para probar casos reales.'}
  ],
  lanzado:[
    {k:'rb',t:'Plan de rollback documentado y probado',ev:true,h:'Si algo falla en producción, cómo se revierte en minutos.\nRequiere evidencia: captura o foto de la prueba de rollback.'},
    {k:'proto',t:'Protocolo actualizado y aprobado',h:'El procedimiento operativo/clínico refleja el nuevo flujo.'},
    {k:'bk',t:'Backup / migración verificada',ev:true,h:'Respaldo comprobado antes de tocar datos productivos.\nRequiere evidencia: captura de la verificación del backup.'},
    {k:'com',t:'Comunicación a usuarios afectados',h:'Las personas afectadas saben qué cambia y cuándo.'},
    {k:'auto_crit',t:'Sin riesgos críticos abiertos (puntaje ≥ 15)',auto:true,h:'Se marca solo cuando no hay riesgos críticos abiertos o en mitigación.'}
  ]
};

const statusLabel = k => (STATUSES.find(s=>s.key===k)||{}).label || k;
const prioLabel = k => (PRIORITIES.find(p=>p.k===k)||{}).l || k;
const riskScore = r => r.prob * r.impact;
const riskLevel = s => s>=15 ? 'bad' : s>=8 ? 'warn' : 'ok';
const nextStage = p => { const i=FLOW.indexOf(p.status); return i>=0 && i<FLOW.length-1 ? FLOW[i+1] : null; };
const gateByKey = k => Object.values(GATES).flat().find(g=>g.k===k);
const gateTitle = k => (gateByKey(k)||{}).t || '';
const stageOfGate = k => Object.keys(GATES).find(s=>GATES[s].some(g=>g.k===k));
const evCount = (p,k) => (p.evidence||[]).filter(e=>e.gate===k).length;
const fmtSize = n => n<1048576 ? Math.max(1,Math.round(n/1024))+' KB' : (n/1048576).toFixed(1)+' MB';

function gateDone(p, g){
  if(g.k==='auto_risk') return p.risks.length>0;
  if(g.k==='auto_crit') return !p.risks.some(r=>r.status!=='cerrado' && riskScore(r)>=15);
  return !!p.checklist[g.k];
}
function missingGates(p, target){
  if(target==='pausado' || target==='propuesta') return [];
  const idx = FLOW.indexOf(target); const out=[];
  for(let i=1;i<=idx;i++) for(const g of GATES[FLOW[i]]) if(!gateDone(p,g)) out.push(`${statusLabel(FLOW[i])}: ${g.t}`);
  return out;
}
function needsReason(from, to){
  if(to==='pausado') return true;
  if(from==='pausado') return false;
  return FLOW.indexOf(to) < FLOW.indexOf(from);
}

/* Fechas */
const DAY = 864e5;
const today = () => { const d=new Date(); d.setHours(0,0,0,0); return d; };
const parseD = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
const diffDays = (a,b) => Math.round((b-a)/DAY);
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const addDays = n => isoDate(new Date(today().getTime()+n*DAY));
const fmtDate = s => s ? parseD(s).toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const fmtTs = s => new Date(s).toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
function ago(s){ const d=diffDays(new Date(s),new Date()); return d<=0?'hoy':d===1?'ayer':d<30?`hace ${d} días`:fmtDate(isoDate(new Date(s))); }
const isOverdue = p => p.status!=='lanzado' && p.status!=='pausado' && parseD(p.dueDate)<today();
function relDue(p){
  if(p.status==='lanzado') return 'Lanzado';
  const d=diffDays(today(),parseD(p.dueDate));
  return d<0?`Vencido hace ${-d} d`: d===0?'Vence hoy': `Faltan ${d} d`;
}

/* Motor de salud preventiva */
function health(p){
  if(p.status==='lanzado') return {score:100, level:'ok', label:'Cerrado', reasons:[]};
  let s=100; const r=[];
  const add=(sev,msg,act,tab)=>r.push({sev,msg,act,tab});
  const t=today(), start=parseD(p.startDate), due=parseD(p.dueDate);
  const left=diffDays(t,due);
  if(p.status!=='pausado'){
    if(left<0){ s-=35; add('alta',`Vencido hace ${-left} días`,'Reprograma la fecha o escala el bloqueo','general'); }
    else if(left<=7 && p.progress<80){ s-=12; add('media',`Vence en ${left} días con ${p.progress}% de avance`,'Revisa el alcance o pide apoyo','general'); }
    const total=diffDays(start,due);
    if(total>0 && t>start){
      const exp=Math.min(100,Math.round(diffDays(start,t)/total*100));
      const gap=exp-p.progress;
      if(gap>=25){ s-=20; add('alta',`Atraso: ${p.progress}% real vs ${exp}% esperado`,'Actualiza el avance o ajusta el plan','general'); }
      else if(gap>=12){ s-=10; add('media',`Ligero atraso: ${p.progress}% real vs ${exp}% esperado`,'Actualiza el avance','general'); }
    }
  }
  let pen=0;
  for(const k of p.risks){
    if(k.status==='cerrado') continue;
    const sc=riskScore(k);
    if(sc>=15){
      if(!k.mitigation.trim()){ pen+=18; add('alta',`Riesgo crítico sin mitigación: "${k.title}"`,'Define un plan de mitigación','riesgos'); }
      else { pen+=8; add('media',`Riesgo crítico activo: "${k.title}"`,'Da seguimiento a la mitigación','riesgos'); }
    } else if(sc>=8 && !k.mitigation.trim()){ pen+=6; add('baja',`Riesgo moderado sin mitigación: "${k.title}"`,'Agrega un plan de mitigación','riesgos'); }
  }
  s-=Math.min(pen,40);
  if(p.risks.length===0){ s-=10; add('media','Sin análisis de riesgos registrado','Registra al menos un riesgo','riesgos'); }
  const stale=diffDays(new Date(p.updatedAt),new Date());
  if(stale>14){ s-=15; add('alta',`Sin actualización hace ${stale} días`,'Agrega una nota de seguimiento','bitacora'); }
  else if(stale>7){ s-=8; add('media',`Sin actualización hace ${stale} días`,'Agrega una nota de seguimiento','bitacora'); }
  for(const g of Object.values(GATES).flat()) if(g.ev && p.checklist[g.k] && !evCount(p,g.k)){ s-=4; add('baja',`Control "${g.t}" marcado sin evidencia`,'Adjunta una captura o foto','evidencias'); }
  const nx=nextStage(p);
  if(nx && p.status!=='pausado' && left>=0 && left<=14){
    const miss=GATES[nx].filter(g=>!gateDone(p,g)).length;
    if(miss){ s-=5; add('baja',`Faltan ${miss} controles para pasar a "${statusLabel(nx)}"`,'Completa los controles','gates'); }
  }
  s=Math.max(0,Math.min(100,s));
  const level = s>=75?'ok':s>=50?'warn':'bad';
  const label = {ok:'Saludable',warn:'En observación',bad:'En riesgo'}[level];
  const order={alta:0,media:1,baja:2}; r.sort((a,b)=>order[a.sev]-order[b.sev]);
  return {score:s, level, label, reasons:r};
}


/* ---- Utilidades compartidas por la API y la interfaz ---- */
class ApiError extends Error{ constructor(status,msg,details){ super(msg); this.status=status; this.details=details||[]; } }
const CURRENT_USER = window.CP_USER_NAME || '';  // la plataforma puede definir window.CP_USER_NAME
const uid = () => Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
const clone = v => JSON.parse(JSON.stringify(v));
const validUrl = u => { try{ const x=new URL(u); return x.protocol==='http:'||x.protocol==='https:'; }catch(e){ return false; } };
const hostOf = u => { try{ return new URL(u).hostname.replace(/^www\./,''); }catch(e){ return u; } };
