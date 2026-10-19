/* Generado por scripts/integrar_development.py desde control-proyectos/public. No editar a mano. */
/* Control de Proyectos y Protocolos · dominio y reglas de negocio */
"use strict";
/* =========================================================
   1. DOMINIO: catálogos y reglas de negocio
   ========================================================= */
const STATUSES = [
  {key:'propuesta', label:'Proposal'},
  {key:'aprobado', label:'Approved'},
  {key:'desarrollo', label:'In development'},
  {key:'qa', label:'In testing (QA)'},
  {key:'lanzado', label:'Launched'},
  {key:'pausado', label:'Paused'}
];
const STATUS_HELP = {
  propuesta:'Idea logged. No development time invested yet.',
  aprobado:'Goal, scope and risks defined; the sponsor signed off.',
  desarrollo:'Design and estimate validated; the team is building.',
  qa:'Code reviewed and tested; validating in the test environment.',
  lanzado:'Live in production with rollback, backup and protocol up to date.',
  pausado:'Temporarily on hold. Requires a reason.'
};
const FLOW = ['propuesta','aprobado','desarrollo','qa','lanzado'];
const TYPES = ['Desarrollo','Mejora','Protocolo'];
const PRIORITIES = [{k:'critica',l:'Critical'},{k:'alta',l:'High'},{k:'media',l:'Medium'},{k:'baja',l:'Low'}];
const RISK_STATUS = [{k:'abierto',l:'Open'},{k:'mitigando',l:'Mitigating'},{k:'cerrado',l:'Closed'}];
const PROB_LBL = ['','Very low','Low','Medium','High','Very high'];
const IMP_LBL = ['','Minimal','Minor','Moderate','Major','Severe'];
const CATS = [
  {k:'guia',l:'Guide',c:'var(--primary)',h:'How we do things here: processes and workflows.'},
  {k:'practicas',l:'Best practices',c:'var(--ok)',h:'Technical tips for writing better code.'},
  {k:'recurso',l:'Resource',c:'var(--warn)',h:'Outside material to study: articles, docs, courses.'},
  {k:'anuncio',l:'Announcement',c:'#2563eb',h:'Changes to rules, dates or team decisions.'}
];
const catLabel = k => (CATS.find(c=>c.k===k)||{}).l || k;

const GATES = {
  aprobado:[
    {k:'obj',es:'Objetivo y KPI de éxito definidos',t:'Goal and success KPI defined',h:'Avoids building something without knowing how to tell whether it worked.'},
    {k:'alc',es:'Alcance y criterios de aceptación escritos',t:'Scope and acceptance criteria written',h:'Prevents scope creep: what is in, what is out and how it gets signed off.'},
    {k:'sponsor',es:'Aprobación del solicitante / sponsor',t:'Requester / sponsor approval',h:'Whoever asked for the project agrees before any time is invested.'},
    {k:'auto_risk',es:'Al menos 1 riesgo identificado',t:'At least 1 risk identified',auto:true,h:'Checks itself once you log a risk in the Risks tab.'}
  ],
  desarrollo:[
    {k:'dis',es:'Diseño técnico revisado',t:'Technical design reviewed',h:'A second pair of eyes on the architecture avoids costly rework.'},
    {k:'est',es:'Estimación validada por el equipo',t:'Estimate validated by the team',h:'Realistic dates agreed with the people building it, not imposed.'},
    {k:'dep',es:'Dependencias e impactos identificados',t:'Dependencies and impacts identified',h:'Which other modules, teams or protocols are affected.'}
  ],
  qa:[
    {k:'tests',es:'Pruebas automatizadas pasando',t:'Automated tests passing',ev:true,h:'They catch regressions before they reach production.\nRequires evidence: a screenshot of the test report.'},
    {k:'cr',es:'Code review aprobado',t:'Code review approved',ev:true,h:'Another developer reviewed and approved the code.\nRequires evidence: a screenshot of the approved PR.'},
    {k:'env',es:'Entorno de QA con datos de prueba',t:'QA environment with test data',h:'Realistic (anonymized) data to test real cases.'}
  ],
  lanzado:[
    {k:'rb',es:'Plan de rollback documentado y probado',t:'Rollback plan documented and tested',ev:true,h:'If something breaks in production, how it gets rolled back in minutes.\nRequires evidence: a screenshot or photo of the rollback test.'},
    {k:'proto',es:'Protocolo actualizado y aprobado',t:'Protocol updated and approved',h:'The operating/clinical procedure reflects the new workflow.'},
    {k:'bk',es:'Backup / migración verificada',t:'Backup / migration verified',ev:true,h:'Backup confirmed before touching production data.\nRequires evidence: a screenshot of the backup check.'},
    {k:'com',es:'Comunicación a usuarios afectados',t:'Affected users notified',h:'The people affected know what changes and when.'},
    {k:'auto_crit',es:'Sin riesgos críticos abiertos (puntaje ≥ 15)',t:'No open critical risks (score ≥ 15)',auto:true,h:'Checks itself when no critical risk is open or being mitigated.'}
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
const fmtDate = s => s ? parseD(s).toLocaleDateString('en-US',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const fmtTs = s => new Date(s).toLocaleString('en-US',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
function ago(s){ const d=diffDays(new Date(s),new Date()); return d<=0?'today':d===1?'yesterday':d<30?`${d} days ago`:fmtDate(isoDate(new Date(s))); }
const isOverdue = p => p.status!=='lanzado' && p.status!=='pausado' && parseD(p.dueDate)<today();
function relDue(p){
  if(p.status==='lanzado') return 'Launched';
  const d=diffDays(today(),parseD(p.dueDate));
  return d<0?`Overdue by ${-d} d`: d===0?'Due today': `${d} d left`;
}

/* Motor de salud preventiva */
function health(p){
  if(p.status==='lanzado') return {score:100, level:'ok', label:'Closed', reasons:[]};
  let s=100; const r=[];
  const add=(sev,msg,act,tab)=>r.push({sev,msg,act,tab});
  const t=today(), start=parseD(p.startDate), due=parseD(p.dueDate);
  const left=diffDays(t,due);
  if(p.status!=='pausado'){
    if(left<0){ s-=35; add('alta',`Overdue by ${-left} days`,'Reschedule the date or escalate the blocker','general'); }
    else if(left<=7 && p.progress<80){ s-=12; add('media',`Due in ${left} days at ${p.progress}% progress`,'Review the scope or ask for help','general'); }
    const total=diffDays(start,due);
    if(total>0 && t>start){
      const exp=Math.min(100,Math.round(diffDays(start,t)/total*100));
      const gap=exp-p.progress;
      if(gap>=25){ s-=20; add('alta',`Behind: ${p.progress}% actual vs ${exp}% expected`,'Update progress or adjust the plan','general'); }
      else if(gap>=12){ s-=10; add('media',`Slightly behind: ${p.progress}% actual vs ${exp}% expected`,'Update progress','general'); }
    }
  }
  let pen=0;
  for(const k of p.risks){
    if(k.status==='cerrado') continue;
    const sc=riskScore(k);
    if(sc>=15){
      if(!k.mitigation.trim()){ pen+=18; add('alta',`Critical risk with no mitigation: "${k.title}"`,'Define a mitigation plan','riesgos'); }
      else { pen+=8; add('media',`Active critical risk: "${k.title}"`,'Follow up on the mitigation','riesgos'); }
    } else if(sc>=8 && !k.mitigation.trim()){ pen+=6; add('baja',`Moderate risk with no mitigation: "${k.title}"`,'Add a mitigation plan','riesgos'); }
  }
  s-=Math.min(pen,40);
  if(p.risks.length===0){ s-=10; add('media','No risk analysis logged','Log at least one risk','riesgos'); }
  const stale=diffDays(new Date(p.updatedAt),new Date());
  if(stale>14){ s-=15; add('alta',`No updates for ${stale} days`,'Add a follow-up note','bitacora'); }
  else if(stale>7){ s-=8; add('media',`No updates for ${stale} days`,'Add a follow-up note','bitacora'); }
  for(const g of Object.values(GATES).flat()) if(g.ev && p.checklist[g.k] && !evCount(p,g.k)){ s-=4; add('baja',`Check "${g.t}" marked without evidence`,'Attach a screenshot or photo','evidencias'); }
  const nx=nextStage(p);
  if(nx && p.status!=='pausado' && left>=0 && left<=14){
    const miss=GATES[nx].filter(g=>!gateDone(p,g)).length;
    if(miss){ s-=5; add('baja',`${miss} checks left to move to "${statusLabel(nx)}"`,'Complete the checks','gates'); }
  }
  s=Math.max(0,Math.min(100,s));
  const level = s>=75?'ok':s>=50?'warn':'bad';
  const label = {ok:'Healthy',warn:'Watch',bad:'At risk'}[level];
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

/* ---- Inglés (agregado por integrar_development.py) ---- */
const typeLabel = t => ({Desarrollo:'Development',Mejora:'Improvement',Protocolo:'Protocol'}[t] || t);
const EN_ST = {'Propuesta':'Proposal','Aprobado':'Approved','En desarrollo':'In development','En pruebas (QA)':'In testing (QA)','Lanzado':'Launched','Pausado':'Paused'};
const EN_PRIO = {'Crítica':'Critical','Alta':'High','Media':'Medium','Baja':'Low'};
const EN_TYPE = {'Desarrollo':'Development','Mejora':'Improvement','Protocolo':'Protocol'};
const EN_FIELD = {'Nombre':'Name','Tipo':'Type','Responsable':'Owner','Prioridad':'Priority','Inicio':'Start','Fecha objetivo':'Target date','Avance':'Progress','Protocolo':'Protocol','Descripción':'Description','Apoyo':'Support'};
const EN_RS = {abierto:'open',mitigando:'mitigating',cerrado:'closed'};
const ES_GATE = {}; Object.values(GATES).flat().forEach(g=>{ ES_GATE[g.es]=g.t; });
const stEn = x => EN_ST[x] || x, gateEn = x => ES_GATE[x] || x;
const ST_RX = '(Propuesta|Aprobado|En desarrollo|En pruebas \\(QA\\)|Lanzado|Pausado)';
/* La bitácora se guarda en español: aquí se lee en inglés */
function trLog(m){
  let r;
  if(m==='Proyecto creado en estado "Propuesta"') return 'Project created as "Proposal"';
  if((r=m.match(new RegExp('^Etapa: '+ST_RX+' → '+ST_RX+'(?:\\. Motivo: ([\\s\\S]*))?$')))) return `Stage: ${stEn(r[1])} → ${stEn(r[2])}${r[3]!==undefined?'. Reason: '+r[3]:''}`;
  if((r=m.match(/^Editado: ([\s\S]*)$/))) return 'Edited: '+r[1].split(' · ').map(part=>{ const q=part.match(/^([^:]+): ([\s\S]*)$/); if(!q) return part;
    const v=q[2].split(' → ').map(x=>x==='(texto)'?'(text)':EN_PRIO[x]||EN_TYPE[x]||x).join(' → '); return (EN_FIELD[q[1]]||q[1])+': '+v; }).join(' · ');
  if((r=m.match(/^Control completado: ([\s\S]*)$/))) return 'Check completed: '+gateEn(r[1]);
  if((r=m.match(/^Control desmarcado: ([\s\S]*)$/))) return 'Check unchecked: '+gateEn(r[1]);
  if((r=m.match(/^Riesgo registrado: "([\s\S]*)" \(puntaje (\d+)\)$/))) return `Risk logged: "${r[1]}" (score ${r[2]})`;
  if((r=m.match(/^Riesgo actualizado: "([\s\S]*)" \(P(\d)×I(\d)=(\d+), (\w+)\)$/))) return `Risk updated: "${r[1]}" (P${r[2]}×I${r[3]}=${r[4]}, ${EN_RS[r[5]]||r[5]})`;
  if((r=m.match(/^Riesgo eliminado: "([\s\S]*)"$/))) return `Risk deleted: "${r[1]}"`;
  if((r=m.match(/^Nota: ([\s\S]*)$/))) return 'Note: '+r[1];
  if((r=m.match(/^Publicación vinculada: "([\s\S]*)"$/))) return `Post linked: "${r[1]}"`;
  if((r=m.match(new RegExp('^Evidencia agregada en '+ST_RX+'(?: \\((.+?)\\))?: ([\\s\\S]*)$')))) return `Evidence added in ${stEn(r[1])}${r[2]?' ('+gateEn(r[2])+')':''}: ${r[3]}`;
  if((r=m.match(new RegExp('^Evidencia actualizada: ([\\s\\S]*) → '+ST_RX+'(?: \\((.+)\\))?$')))) return `Evidence updated: ${r[1]} → ${stEn(r[2])}${r[3]?' ('+gateEn(r[3])+')':''}`;
  if((r=m.match(/^Evidencia eliminada: ([\s\S]*)$/))) return 'Evidence deleted: '+r[1];
  return m;
}
