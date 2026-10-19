/* Generado por scripts/integrar_development.py desde control-proyectos/public. No editar a mano. */
/* Control de Proyectos y Protocolos · interfaz (frontend) */
"use strict";
/* =========================================================
   3. FRONTEND
   ========================================================= */
const peopleOpts = sel => `<option value="">Choose a person…</option>`+state.people.map(x=>`<option value="${esc(x.id)}" ${String(sel)===x.id?'selected':''}>${esc(x.name)}</option>`).join('');
const supChip=(id,name)=>`<span class="supchip"><input type="hidden" name="supportIds" value="${esc(id)}">${esc(name)}<button type="button" data-sup-rm aria-label="Remove ${esc(name)}">✕</button></span>`;
const supportPicker=sel=>`<div class="sup">${(sel||[]).map(x=>supChip(x.id,x.name)).join('')}<select class="sup-add" data-sup-add aria-label="Add a support person"><option value="">+ Add support…</option>${state.people.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>`;
const who=o=>esc(o.owner)+((o.support||[]).length?`<span class="sup-n" data-tip="${esc('Support:\n'+o.support.map(x=>'• '+x.name).join('\n'))}">+${o.support.length}</span>`:'');
const state = {people:[],
  view:'resumen', projects:[], posts:[], help:true, alertSev:'', animate:true,
  filters:{q:'',status:'',type:'',health:''}, sort:{key:'health',dir:1},
  detailId:null, detailTab:'general', editRiskId:null, dirty:false, justGate:null,
  postFilters:{q:'',cat:'',unread:false,project:''}, expanded:new Set(), flashPost:null, justUseful:null,
  postEditId:null, postDirty:false, draftLinks:[],
  staged:[], evFilter:{stage:'',gate:''}, pendingStage:null, pendingGate:null, lb:null
};
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const app = $('#app'), dlg = $('#dlg'), dlgPost = $('#dlgPost'), dlgImg = $('#dlgImg');
const CP_ROOT = document.querySelector('.cpapp');
const topHost = () => [...document.querySelectorAll('.cpapp dialog[open]')].pop() || CP_ROOT;
const info = t => `<span class="info" tabindex="0" data-tip="${esc(t)}">?</span>`;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const initials = n => n.split(/\s+/).filter(w=>/^[A-ZÁÉÍÓÚÑ]/.test(w)).slice(0,2).map(w=>w[0]).join('') || n.slice(0,2).toUpperCase();
let pointer={x:innerWidth/2,y:innerHeight/2};
document.addEventListener('pointerdown',e=>{pointer={x:e.clientX,y:e.clientY};},true);

/* Formato simple y seguro: **negrita**, `código`, listas con "- " */
function md(text){
  const lines=esc(text).split('\n'); let html='',inList=false,para=[];
  const inline=s=>s.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/`([^`]+)`/g,'<code>$1</code>');
  const flush=()=>{ if(para.length){ html+='<p>'+inline(para.join('<br>'))+'</p>'; para=[]; } };
  for(const l of lines){
    if(/^\s*-\s+/.test(l)){ flush(); if(!inList){ html+='<ul>'; inList=true; } html+='<li>'+inline(l.replace(/^\s*-\s+/,''))+'</li>'; }
    else { if(inList){ html+='</ul>'; inList=false; } if(!l.trim()) flush(); else para.push(l); }
  }
  if(inList) html+='</ul>'; flush(); return html;
}

/* ---------- Tooltips ---------- */
const tip=document.createElement('div'); tip.className='tip'; tip.setAttribute('role','tooltip');
let tipEl=null;
function showTip(el){
  if(tipEl===el && tip.isConnected) return; tipEl=el;
  const host=topHost(); if(tip.parentNode!==host) host.appendChild(tip);
  tip.textContent=el.dataset.tip; tip.style.display='block'; tip.classList.remove('on');
  const r=el.getBoundingClientRect(), tr=tip.getBoundingClientRect();
  let top=r.top-tr.height-9; if(top<6) top=r.bottom+9;
  const left=Math.max(8,Math.min(r.left+r.width/2-tr.width/2, innerWidth-tr.width-8));
  tip.style.top=top+'px'; tip.style.left=left+'px';
  requestAnimationFrame(()=>tip.classList.add('on'));
}
const hideTip=()=>{ tipEl=null; tip.classList.remove('on'); tip.style.display='none'; };
document.addEventListener('mouseover',e=>{ const el=e.target.closest('[data-tip]'); el?showTip(el):hideTip(); });
document.addEventListener('focusin',e=>{ const el=e.target.closest('[data-tip]'); el?showTip(el):hideTip(); });
document.addEventListener('scroll',hideTip,true);
document.addEventListener('dragstart',hideTip);

/* ---------- Efecto 3D en indicadores ---------- */
let tilted=null;
document.addEventListener('pointermove',e=>{
  if(reduced()) return;
  const el=e.target.closest('.tilt');
  if(tilted && tilted!==el){ tilted.style.transform=''; tilted=null; }
  if(!el) return; tilted=el;
  const r=el.getBoundingClientRect(); const x=(e.clientX-r.left)/r.width-.5, y=(e.clientY-r.top)/r.height-.5;
  el.style.transform=`perspective(700px) rotateY(${x*7}deg) rotateX(${-y*7}deg) translateY(-3px)`;
});

/* ---------- Confeti ---------- */
function confetti(x,y,n=36){
  if(reduced()) return;
  const host=topHost(); const colors=['#1d4ed8','#93c5fd','#15803d','#60a5fa','#3b82f6','#0f1b3d'];
  for(let i=0;i<n;i++){
    const s=document.createElement('span'); s.className='confetti';
    s.style.background=colors[i%colors.length]; s.style.left=x+'px'; s.style.top=y+'px'; host.appendChild(s);
    const a=Math.random()*Math.PI*2, v=90+Math.random()*190;
    const dx=Math.cos(a)*v, dy=Math.sin(a)*v-150;
    s.animate([{transform:'translate(0,0) rotate(0)',opacity:1},{transform:`translate(${dx}px,${dy+280}px) rotate(${Math.random()*720}deg)`,opacity:0}],
      {duration:1100+Math.random()*600,easing:'cubic-bezier(.2,.7,.4,1)'}).onfinish=()=>s.remove();
  }
}

/* ---------- Avisos ---------- */
function toast(msg,type='i',details){
  const el=document.createElement('div'); el.className='toast '+type; el.setAttribute('role','status');
  el.innerHTML=`<div>${esc(msg)}</div>${details&&details.length?`<ul>${details.map(d=>`<li>${esc(d)}</li>`).join('')}</ul>`:''}`;
  const host=topHost(); let box=host.querySelector(':scope > .toast-host');
  if(!box){ box=document.createElement('div'); box.className='toast-host'; host.appendChild(box); }
  box.appendChild(el); while(box.children.length>3) box.firstElementChild.remove();
  setTimeout(()=>{ if(!el.isConnected) return; el.animate([{opacity:1},{opacity:0,transform:'translateX(30px)'}],{duration:250}).onfinish=()=>el.remove(); }, details&&details.length?7000:3200);
}
async function call(fn, okMsg){
  try{ const r=await fn(); if(okMsg) toast(okMsg,'s'); await refresh(); return r; }
  catch(e){ if(e instanceof ApiError) toast(e.message,'e',e.details); else { console.error(e); toast('Unexpected error','e'); } return null; }
}
async function refresh(){
  if(!state.people.length) state.people=await api.people();
  state.projects=await api.list(); state.posts=await api.listPosts();
  render(); if(dlg.open && state.detailId) renderDetail(); if(dlgImg.open && state.lb) renderLightbox();
}

/* ---------- Confirmación / motivo ---------- */
function ask({title,msg='',input=false,okText='Confirm',danger=false}){
  return new Promise(res=>{
    const d=$('#dlgAsk');
    $('#askTitle').textContent=title; $('#askMsg').textContent=msg; $('#askMsg').style.display=msg?'':'none';
    $('#askInputWrap').style.display=input?'':'none'; $('#askInput').value=''; $('#askErr').textContent='';
    const ok=$('#askOk'); ok.textContent=okText; ok.className='btn '+(danger?'danger-fill':'primary');
    d.returnValue=''; hideTip(); d.showModal(); if(input) $('#askInput').focus();
    d.addEventListener('close',()=>res(d.returnValue==='ok' ? (input?$('#askInput').value.trim():true) : null),{once:true});
  });
}
$('#askOk').addEventListener('click',e=>{
  if($('#askInputWrap').style.display!=='none' && $('#askInput').value.trim().length<5){
    e.preventDefault(); $('#askErr').textContent=''; requestAnimationFrame(()=>{$('#askErr').textContent='Write a reason of at least 5 characters.';}); $('#askInput').focus();
  }
});
async function confirmDiscard(flag='dirty'){
  const staged = flag==='dirty' && state.staged.length>0;
  if(!state[flag] && !staged) return true;
  const msg = staged && !state[flag] ? `You have ${state.staged.length} ${state.staged.length>1?'images':'image'} not saved as evidence. Discard ${state.staged.length>1?'them':'it'}?` : 'You have unsaved changes in this form. Discard them?';
  const ok=await ask({title:'Unsaved changes',msg,okText:'Discard',danger:true});
  if(ok){ state[flag]=false; if(flag==='dirty') state.staged=[]; return true; } return false;
}

/* ---------- Componentes ---------- */
function healthTip(h){
  if(h.label==='Closed') return 'Project launched and closed.';
  const head=`Health ${h.score}/100 · ${h.label}\n≥75 healthy · 50–74 watch · <50 at risk`;
  return head + (h.reasons.length ? '\n\n'+h.reasons.map(r=>'• '+r.msg).join('\n') : '\n\nNo alerts: on track.');
}
const hBadge = h => `<span class="badge b-${h.level}" data-tip="${esc(healthTip(h))}">${h.score} · ${h.label}</span>`;
const sBadge = s => `<span class="badge ${s==='lanzado'?'b-ok':s==='pausado'?'b-neutral':'b-primary'}" data-tip="${esc(STATUS_HELP[s])}">${esc(statusLabel(s))}</span>`;
const pBadge = p => `<span class="badge ${p==='critica'?'b-bad':p==='alta'?'b-warn':'b-neutral'}">${esc(prioLabel(p))}</span>`;
const prog = v => `<div class="prog" data-tip="Reported progress: ${v}%"><span style="width:${v}%"></span></div>`;
const riskTip = r => `Probability ${r.prob} (${PROB_LBL[r.prob]}) × Impact ${r.impact} (${IMP_LBL[r.impact]}) = ${riskScore(r)}\n≥15 critical · 8–14 moderate · <8 low`;
function ring(score,size,color){
  const r=(size-8)/2, c=+(2*Math.PI*r).toFixed(1), off=+(c*(1-score/100)).toFixed(1), m=size/2;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle class="bgc" cx="${m}" cy="${m}" r="${r}"/><circle class="v" cx="${m}" cy="${m}" r="${r}" stroke="${color}" transform="rotate(-90 ${m} ${m})" style="stroke-dasharray:${c};stroke-dashoffset:${off};--c:${c}"/></svg>`;
}
const lvlColor = l => ({ok:'var(--ok)',warn:'var(--warn)',bad:'var(--bad)'}[l]);
function countUp(){
  if(reduced()) return;
  app.querySelectorAll('[data-count]').forEach(el=>{
    const to=+el.dataset.count, t0=performance.now(), d=900;
    const step=t=>{ const k=Math.min(1,(t-t0)/d); el.textContent=Math.round(to*(1-Math.pow(1-k,3))); if(k<1) requestAnimationFrame(step); };
    el.textContent='0'; requestAnimationFrame(step);
  });
}
function moveInd(){
  const a=$('#tabs button.active'), ind=$('#tabInd'); if(!a) return;
  ind.style.width=a.offsetWidth+'px'; ind.style.transform=`translateX(${a.offsetLeft}px)`;
  const pill=$('#tabs'); if(pill.scrollWidth>pill.clientWidth) pill.scrollTo({left:a.offsetLeft-pill.clientWidth/2+a.offsetWidth/2,behavior:reduced()?'auto':'smooth'});
}
addEventListener('resize',moveInd);
if(document.fonts) document.fonts.ready.then(moveInd);

let enterTimer;
function render(){
  hideTip();
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  const unread=state.posts.filter(p=>!p.read).length; $('#unreadBadge').textContent=unread||'';
  moveInd();
  const animate=state.animate; state.animate=false;
  if(animate){ app.classList.remove('enter'); void app.offsetWidth; app.classList.add('enter'); clearTimeout(enterTimer); enterTimer=setTimeout(()=>app.classList.remove('enter'),1600); }
  ({resumen:renderSummary, proyectos:renderTable, kanban:renderKanban, riesgos:renderRisks, posts:renderPosts, tecnico:renderTech})[state.view]();
  if(animate) countUp();
}
function go(view){ state.view=view; state.animate=true; render(); scrollTo({top:0,behavior:reduced()?'auto':'smooth'}); }

/* ---------- Resumen ---------- */
function renderSummary(){
  const ps=state.projects, active=ps.filter(p=>p.status!=='lanzado');
  const hs=active.map(p=>({p,h:health(p)}));
  const overdue=active.filter(isOverdue).length;
  const atRisk=hs.filter(x=>x.h.level==='bad').length;
  const openRisks=ps.flatMap(p=>p.risks.filter(r=>r.status!=='cerrado'));
  const crit=openRisks.filter(r=>riskScore(r)>=15).length;
  const avg=hs.length?Math.round(hs.reduce((a,x)=>a+x.h.score,0)/hs.length):100;
  const avgLvl=avg>=75?'ok':avg>=50?'warn':'bad';
  const all=hs.flatMap(({p,h})=>h.reasons.map(r=>({...r,p}))).sort((a,b)=>({alta:0,media:1,baja:2}[a.sev]-{alta:0,media:1,baja:2}[b.sev]));
  const alerts=state.alertSev?all.filter(a=>a.sev===state.alertSev):all;
  const cnt=k=>all.filter(a=>a.sev===k).length;
  const counts=STATUSES.map(s=>({s,n:ps.filter(p=>p.status===s.key).length})); const max=Math.max(1,...counts.map(c=>c.n));
  const unread=state.posts.filter(p=>!p.read).sort((a,b)=>(b.pinned-a.pinned)||(b.createdAt>a.createdAt?1:-1));
  let i=0;
  app.innerHTML=`
  ${state.help?`<div class="help rise" style="--i:${i++}"><div class="help-head"><b>How it works</b><button class="btn sm" data-action="hide-help">Got it, hide</button></div>
    <div class="steps">
      <div><span class="n">1</span><b>Create the project</b><br><span class="muted">Set the owner, dates and the protocol it affects.</span></div>
      <div><span class="n">2</span><b>Identify risks</b><br><span class="muted">What could go wrong and how to prevent it. Required for approval.</span></div>
      <div><span class="n">3</span><b>Meet the checks</b><br><span class="muted">Each stage has its checklist; until it's done, the system won't let you move on.</span></div>
      <div><span class="n">4</span><b>Learn in Posts</b><br><span class="muted">Guides, best practices and resources for the team.</span></div>
    </div></div>`:''}
  <div class="grid kpis">
    ${kpi(`<span data-count="${active.length}">${active.length}</span>`,'Active projects','Projects not launched yet (paused ones included).','kpi-active',i++)}
    <button class="card kpi tilt dark rise" style="--i:${i++}" data-action="kpi-health" data-tip="${esc('Average health score of active projects.\nBased on: due dates, progress vs. time, risks, inactivity and pending checks.\n\nClick for details.')}">
      <div class="row">${ring(avg,64,avgLvl==='ok'?'var(--lime)':lvlColor(avgLvl))}<div><div class="v" style="color:${avgLvl==='ok'?'var(--lime)':lvlColor(avgLvl)}"><span data-count="${avg}">${avg}</span></div><div class="l">Average health</div></div></div><span class="go">→</span></button>
    ${kpi(`<span style="color:var(--${atRisk?'bad':'ok'})" data-count="${atRisk}">${atRisk}</span>`,'Projects at risk','Projects with health below 50. They need attention this week.','kpi-risk',i++)}
    ${kpi(`<span style="color:var(--${overdue?'bad':'ok'})" data-count="${overdue}">${overdue}</span>`,'Overdue','Active projects past their target date.','kpi-overdue',i++)}
    ${kpi(`<span data-count="${openRisks.length}">${openRisks.length}</span> <span class="small muted" style="font-family:Inter,sans-serif;font-weight:600">(${crit} critical)</span>`,'Open risks','Risks that are open or being mitigated. Critical = score ≥ 15.','kpi-risks',i++)}
  </div>
  <div class="grid two" style="margin-top:16px">
    <div class="card rise" style="--i:${i++}">
      <h3>Early warnings ${info('Problems detected automatically before they escalate. Click an alert to go straight to fixing it.')}</h3>
      <div class="chips">
        ${[['','All',all.length],['alta','High',cnt('alta')],['media','Medium',cnt('media')],['baja','Low',cnt('baja')]].map(([k,l,n])=>`<button class="chip ${state.alertSev===k?'on':''}" data-sev="${k}">${l} (${n})</button>`).join('')}
      </div>
      ${alerts.length?alerts.map((a,j)=>`
        <button class="alert rise" style="--i:${Math.min(j,10)}" data-open="${a.p.id}" data-tab="${a.tab}">
          <span class="dot d-${a.sev}" data-tip="${({alta:'High',media:'Medium',baja:'Low'})[a.sev]} severity"></span>
          <div><div class="t">${esc(a.p.code)} · ${esc(a.p.name)}</div><div class="m">${esc(a.msg)}</div><div class="act">${esc(a.act)}</div></div>
        </button>`).join('')
      :'<div class="empty">No alerts in this category. Everything is under control.</div>'}
    </div>
    <div class="grid" style="align-content:start">
      <div class="card rise" style="--i:${i++}"><h3>To read ${info('Posts you haven’t read yet in the Posts tab.')}<span class="badge b-primary" style="margin-left:auto">${unread.length} unread</span></h3>
        ${unread.length?unread.slice(0,3).map(p=>`<button class="readitem" data-goto-post="${p.id}"><span class="tag cat-${p.category}">${esc(catLabel(p.category))}</span><span class="t">${esc(p.title)}</span></button>`).join('')+`<button class="link small" data-action="go-posts" style="margin-top:6px">See all posts →</button>`
        :'<div class="muted small">You’re all caught up on your reading.</div>'}
      </div>
      <div class="card rise" style="--i:${i++}"><h3>Open risk matrix ${info('Each cell counts risks by probability (rows) and impact (columns). Ideally, everything sits in the bottom left.')}</h3>${heatmap(openRisks)}</div>
      <div class="card bars rise" style="--i:${i++}"><h3>Projects by stage</h3>
        ${counts.map(c=>`<div class="row"><span data-tip="${esc(STATUS_HELP[c.s.key])}">${esc(c.s.label)}</span><div class="bar"><span style="width:${c.n/max*100}%"></span></div><b>${c.n}</b></div>`).join('')}
      </div>
    </div>
  </div>`;
}
const kpi=(v,l,t,act,i)=>`<button class="card kpi tilt rise" style="--i:${i}" data-action="${act}" data-tip="${esc(t+'\n\nClick for details.')}"><div class="v">${v}</div><div class="l">${l}</div><span class="go">→</span></button>`;
function heatmap(risks){
  let k=0;
  const cell=(pr,im)=>{const n=risks.filter(r=>r.prob===pr&&r.impact===im).length; const sc=pr*im; const lv=riskLevel(sc);
    return `<div class="c" style="--i:${k++};background:var(--${lv}-weak);color:var(--${lv});${n?`box-shadow:inset 0 0 0 2px var(--${lv})`:''}" data-tip="Probability ${pr} (${PROB_LBL[pr]}) × Impact ${im} (${IMP_LBL[im]}) = ${sc}\n${n} risk(s)">${n||''}</div>`;};
  let h='<div class="heat">';
  for(let pr=5;pr>=1;pr--){ h+=`<div class="lbl">P${pr}</div>`; for(let im=1;im<=5;im++) h+=cell(pr,im); }
  h+='<div></div>'+[1,2,3,4,5].map(i=>`<div class="lbl">I${i}</div>`).join('')+'</div>';
  return h+`<div class="mtx-legend"><span><i class="sw" style="background:var(--bad)"></i>Critical ≥15</span><span><i class="sw" style="background:var(--warn)"></i>Moderate 8–14</span><span><i class="sw" style="background:var(--ok)"></i>Low &lt;8</span><span>P = probability · I = impact</span></div>`;
}

/* ---------- Filtros ---------- */
function filtered(){
  const f=state.filters, q=f.q.toLowerCase();
  return state.projects.filter(p=>{
    if(q && !(`${p.code} ${p.name} ${p.owner} ${(p.support||[]).map(x=>x.name).join(' ')} ${p.protocol}`.toLowerCase().includes(q))) return false;
    if(f.status && p.status!==f.status) return false;
    if(f.type && p.type!==f.type) return false;
    if(f.health==='overdue') return isOverdue(p);
    if(f.health && health(p).level!==f.health) return false;
    return true;
  });
}
const anyFilter = () => Object.values(state.filters).some(Boolean);
function filtersBar(){
  const f=state.filters;
  return `<div class="filters rise">
    <input id="fq" placeholder="Search by code, name, owner or protocol…  ( / )" value="${esc(f.q)}" aria-label="Search">
    <select id="fs" aria-label="Stage"><option value="">All stages</option>${STATUSES.map(s=>`<option value="${s.key}" ${f.status===s.key?'selected':''}>${s.label}</option>`).join('')}</select>
    <select id="ft" aria-label="Type"><option value="">All types</option>${TYPES.map(t=>`<option value="${t}" ${f.type===t?'selected':''}>${typeLabel(t)}</option>`).join('')}</select>
    <select id="fh" aria-label="Health"><option value="">Any health</option>${[['ok','Healthy'],['warn','Watch'],['bad','At risk'],['overdue','Overdue only']].map(([k,l])=>`<option value="${k}" ${f.health===k?'selected':''}>${l}</option>`).join('')}</select>
    ${anyFilter()?'<button class="btn" data-action="clear-filters">Clear filters</button>':''}
  </div>`;
}
function bindFilters(){
  $('#fq').addEventListener('input',e=>{state.filters.q=e.target.value; const pos=e.target.selectionStart; render(); const n=$('#fq'); n.focus(); n.setSelectionRange(pos,pos);});
  $('#fs').addEventListener('change',e=>{state.filters.status=e.target.value;render();});
  $('#ft').addEventListener('change',e=>{state.filters.type=e.target.value;render();});
  $('#fh').addEventListener('change',e=>{state.filters.health=e.target.value;render();});
}

/* ---------- Tabla ---------- */
const SORTERS = {
  code:p=>p.code, name:p=>p.name.toLowerCase(), type:p=>p.type, status:p=>STATUSES.findIndex(s=>s.key===p.status),
  priority:p=>PRIORITIES.findIndex(x=>x.k===p.priority), owner:p=>p.owner.toLowerCase(), progress:p=>p.progress,
  dueDate:p=>p.dueDate, risks:p=>p.risks.filter(r=>r.status!=='cerrado').length, health:p=>health(p).score
};
function renderTable(){
  const all=filtered(); const {key,dir}=state.sort;
  const rows=[...all].sort((a,b)=>{const x=SORTERS[key](a),y=SORTERS[key](b); return (x<y?-1:x>y?1:0)*dir;});
  const th=(k,l,t)=>`<th class="sortable ${key===k?'sorted':''}" data-sort="${k}" ${t?`data-tip="${esc(t)}"`:''} aria-sort="${key===k?(dir>0?'ascending':'descending'):'none'}">${l}<span class="ar">${key===k?(dir>0?'▲':'▼'):'↕'}</span></th>`;
  app.innerHTML=filtersBar()+`<div class="count">${rows.length} of ${state.projects.length} projects · click a column to sort · click a row to open</div>
  <div class="table-wrap rise" style="--i:1"><table>
    <thead><tr>${th('code','Code')}${th('name','Project')}${th('type','Type')}${th('status','Stage')}${th('priority','Priority')}${th('owner','Owner')}${th('progress','Progress')}${th('dueDate','Target date')}${th('risks','Risks','Risks that are open or being mitigated')}${th('health','Health','Score 0–100. Hover over a value to see the diagnosis.')}</tr></thead>
    <tbody>${rows.length?rows.map((p,j)=>{const h=health(p); const open=p.risks.filter(r=>r.status!=='cerrado');
      const crit=open.filter(r=>riskScore(r)>=15);
      return `<tr class="click rise" style="--i:${j+2}" data-open="${p.id}" tabindex="0">
        <td class="muted">${esc(p.code)}</td><td><b>${esc(p.name)}</b>${p.protocol?`<div class="small muted">${esc(p.protocol)}</div>`:''}</td>
        <td>${esc(typeLabel(p.type))}</td><td>${sBadge(p.status)}</td><td>${pBadge(p.priority)}</td><td>${who(p)}</td>
        <td>${prog(p.progress)}<span class="small muted">${p.progress}%</span></td>
        <td style="${isOverdue(p)?'color:var(--bad);font-weight:600':''}">${fmtDate(p.dueDate)}<div class="small muted">${relDue(p)}</div></td>
        <td>${open.length}${crit.length?` <span class="badge b-bad" data-tip="${esc(crit.map(r=>'• '+r.title).join('\n'))}">${crit.length} critical</span>`:''}</td>
        <td>${hBadge(h)}</td></tr>`;}).join(''):`<tr><td colspan="10" class="empty">No projects match these filters. <button class="link" data-action="clear-filters">Clear filters</button></td></tr>`}</tbody></table></div>`;
  bindFilters();
}

/* ---------- Tablero ---------- */
function renderKanban(){
  const rows=filtered();
  app.innerHTML=filtersBar()+`<p class="muted small" style="margin-top:0">Drag a card to change its stage. While you drag, allowed columns glow green and blocked ones fade out.</p>
  <div class="kanban">${STATUSES.map((s,ci)=>{const items=rows.filter(p=>p.status===s.key);
    return `<div class="col rise" style="--i:${ci}" data-col="${s.key}"><h4><span data-tip="${esc(STATUS_HELP[s.key])}">${s.label}</span><span class="badge b-neutral">${items.length}</span></h4>
      ${items.map(p=>{const h=health(p); const nx=nextStage(p); let pend='';
        if(nx && p.status!=='pausado'){ const miss=GATES[nx].filter(g=>!gateDone(p,g));
          pend = miss.length
            ? `<span class="pend lock" data-tip="${esc(`Still needed to move to ${statusLabel(nx)}:\n`+miss.map(g=>'• '+g.t).join('\n'))}">${miss.length} check${miss.length>1?'s':''} pending</span>`
            : `<span class="pend ready" data-tip="All checks done. You can drag it to ${esc(statusLabel(nx))}.">Ready for ${esc(statusLabel(nx))}</span>`; }
        return `<div class="kcard h-${h.level}" draggable="true" data-drag="${p.id}" data-open="${p.id}" tabindex="0">
        <div class="small muted">${esc(p.code)} · ${esc(typeLabel(p.type))}${p.evidence.length?` · <span data-tip="Attached evidence">${p.evidence.length} evid.</span>`:''}</div><div class="n">${esc(p.name)}</div>
        ${prog(p.progress)}<div class="foot small"><span class="muted">${who(p)}</span>${hBadge(h)}</div>${pend}</div>`;}).join('') || '<div class="small muted" style="text-align:center;padding:16px 0">No projects</div>'}
    </div>`;}).join('')}</div>`;
  bindFilters();
  app.querySelectorAll('[data-drag]').forEach(el=>{
    el.addEventListener('dragstart',e=>{
      e.dataTransfer.setData('text/plain',el.dataset.drag); el.classList.add('dragging');
      const p=state.projects.find(x=>x.id===el.dataset.drag);
      app.querySelectorAll('.col').forEach(c=>{ const to=c.dataset.col; if(to===p.status) return;
        c.classList.add(missingGates(p,to).length?'blocked':'allowed'); });
    });
    el.addEventListener('dragend',()=>{ el.classList.remove('dragging'); app.querySelectorAll('.col').forEach(c=>c.classList.remove('allowed','blocked','over')); });
  });
  app.querySelectorAll('.col').forEach(col=>{
    col.addEventListener('dragover',e=>{e.preventDefault();col.classList.add('over');});
    col.addEventListener('dragleave',()=>col.classList.remove('over'));
    col.addEventListener('drop',e=>{e.preventDefault();col.classList.remove('over'); pointer={x:e.clientX,y:e.clientY}; moveTo(e.dataTransfer.getData('text/plain'),col.dataset.col);});
  });
}
async function moveTo(id,to){
  const p=state.projects.find(x=>x.id===id); if(!p||p.status===to) return;
  if(dlg.open && !(await confirmDiscard())) return;
  const missing=missingGates(p,to);
  if(missing.length){ toast(`Can’t move to "${statusLabel(to)}": checks missing`,'e',missing); return; }
  let reason='';
  if(needsReason(p.status,to)){
    reason=await ask({title:`${to==='pausado'?'Pause':'Move back to "'+statusLabel(to)+'"'}: ${p.name}`,
      msg:to==='pausado'?'Pausing stops date alerts. Say why it’s paused and what’s needed to resume.':'Moving back a stage is an important signal; the reason is saved in the log.',
      input:true, okText:to==='pausado'?'Pause project':'Move back'});
    if(reason===null) return;
  }
  const forward = p.status!=='pausado' && FLOW.indexOf(to)>FLOW.indexOf(p.status);
  const at={...pointer};
  const r=await call(()=>api.changeStatus(id,to,reason),`${p.code} is now in "${statusLabel(to)}"`);
  if(r && forward) confetti(at.x,at.y,to==='lanzado'?80:36);
}

/* ---------- Registro de riesgos ---------- */
function renderRisks(){
  const all=state.projects.flatMap(p=>p.risks.map(r=>({...r,p}))).sort((a,b)=>(a.status==='cerrado')-(b.status==='cerrado')||riskScore(b)-riskScore(a));
  app.innerHTML=`<div class="count rise">${all.length} risks · sorted by status and score · click a row to open the project</div>
  <div class="table-wrap rise" style="--i:1"><table>
    <thead><tr><th data-tip="Probability × Impact (1–25)">Score</th><th>Risk</th><th>Project</th><th data-tip="Probability (1–5)">P</th><th data-tip="Impact (1–5)">I</th><th>Mitigation</th><th>Owner</th><th>Status</th></tr></thead>
    <tbody>${all.length?all.map((r,j)=>{const sc=riskScore(r);return `<tr class="click rise" style="--i:${j+2}" data-open="${r.p.id}" data-tab="riesgos" tabindex="0">
      <td><span class="badge b-${riskLevel(sc)}" data-tip="${esc(riskTip(r))}">${sc}</span></td><td><b>${esc(r.title)}</b></td>
      <td class="small">${esc(r.p.code)} · ${esc(r.p.name)}</td><td data-tip="${PROB_LBL[r.prob]}">${r.prob}</td><td data-tip="${IMP_LBL[r.impact]}">${r.impact}</td>
      <td class="small">${r.mitigation?esc(r.mitigation):'<span style="color:var(--bad);font-weight:600">No plan</span>'}</td>
      <td>${who(r)}</td><td><span class="badge ${r.status==='cerrado'?'b-ok':r.status==='mitigando'?'b-warn':'b-bad'}">${esc((RISK_STATUS.find(s=>s.k===r.status)||{}).l)}</span></td></tr>`;}).join('')
    :'<tr><td colspan="8" class="empty">No risks logged</td></tr>'}</tbody></table></div>`;
}

/* ---------- Posts ---------- */
function postsFiltered(){
  const f=state.postFilters, q=f.q.toLowerCase();
  return state.posts.filter(p=>{
    if(f.cat && p.category!==f.cat) return false;
    if(f.unread && p.read) return false;
    if(f.project && p.projectId!==f.project) return false;
    if(q && !(`${p.title} ${p.body} ${p.author} ${p.links.map(l=>l.label).join(' ')}`.toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b)=>(b.pinned-a.pinned)||(a.createdAt<b.createdAt?1:-1));
}
function postCard(p,i){
  const open=state.expanded.has(p.id);
  const long=p.body.length>280 || p.body.split('\n').length>6;
  const proj=p.projectId?state.projects.find(x=>x.id===p.projectId):null;
  return `<article class="post rise ${p.pinned?'pinned':''} ${state.flashPost===p.id?'flash':''}" style="--i:${i}" id="post-${p.id}">
    <div class="phead"><span class="tag cat-${p.category}" data-tip="${esc((CATS.find(c=>c.k===p.category)||{}).h||'')}">${esc(catLabel(p.category))}</span>
      ${p.pinned?'<span class="tag pin" data-tip="Pinned post: it shows first">Pinned</span>':''}
      ${!p.read?'<span class="newdot" data-tip="Unread"></span>':''}
      <span class="when" data-tip="${esc(fmtTs(p.createdAt))}">${ago(p.createdAt)}</span></div>
    <h3>${esc(p.title)}</h3>
    <div class="pbody ${long&&!open?'fade':''}">${md(p.body)}</div>
    ${long?`<button class="link more" data-expand="${p.id}">${open?'Show less ↑':'Read more ↓'}</button>`:''}
    ${p.links.length?`<div class="plinks">${p.links.map(l=>`<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" data-linkpost="${p.id}" data-tip="${esc('Opens in a new tab:\n'+l.url)}"><span class="lk">↗</span><span><b>${esc(l.label)}</b><small>${esc(hostOf(l.url))}</small></span></a>`).join('')}</div>`:''}
    ${proj?`<button class="projchip" data-open="${proj.id}" data-tip="Open the linked project">${esc(proj.code)} · ${esc(proj.name)}</button>`:''}
    <div class="pfoot">
      <span class="author"><span class="av">${esc(initials(p.author))}</span>${esc(p.author)}</span>
      <button class="pbtn ${p.read?'on':''}" data-read="${p.id}" data-tip="${p.read?'Mark as unread':'Mark it as read. Opening a link marks it too.'}">${p.read?'✓ Read':'Mark as read'}</button>
      <button class="pbtn useful ${p.usefulMine?'on':''} ${state.justUseful===p.id?'pop':''}" data-useful="${p.id}" data-tip="Mark it if it helped; it shows which content works">Useful · ${p.useful}</button>
      <button class="pbtn" data-post-edit="${p.id}" data-tip="Edit post">Edit</button>
      <button class="pbtn" data-post-del="${p.id}" data-tip="Delete post">Delete</button>
    </div>
  </article>`;
}
function renderPosts(){
  const f=state.postFilters, all=state.posts, list=postsFiltered();
  const read=all.filter(p=>p.read).length, pct=all.length?Math.round(read/all.length*100):100;
  const projIds=[...new Set(all.map(p=>p.projectId).filter(Boolean))];
  app.innerHTML=`<div class="posts-layout">
    <aside class="side">
      <button class="btn primary block rise" data-action="new-post" data-tip="Share a guide, resource or announcement with the team">+ New post</button>
      <div class="card rise" style="--i:1"><h3>Your reading progress ${info('Share of posts you’ve read. The goal is 100% before each new stage.')}</h3>
        <div class="readprog">${ring(pct,58,'var(--primary)')}<div><b>${read}/${all.length}</b><div class="small muted">${pct===100?'All caught up!':`${all.length-read} to read`}</div></div></div></div>
      <div class="card rise" style="--i:2">
        <input class="field" id="pq" placeholder="Search posts…  ( / )" value="${esc(f.q)}" style="width:100%;margin-bottom:10px" aria-label="Search posts">
        <button class="catbtn ${!f.cat?'on':''}" data-pcat="">All <span>${all.length}</span></button>
        ${CATS.map(c=>`<button class="catbtn ${f.cat===c.k?'on':''}" data-pcat="${c.k}" data-tip="${esc(c.h)}"><span><i class="sw" style="background:${c.c}"></i>${c.l}</span><span>${all.filter(p=>p.category===c.k).length}</span></button>`).join('')}
        <label class="switch">Unread only <input type="checkbox" id="punread" ${f.unread?'checked':''}></label>
        ${projIds.length?`<select class="field" id="pproj" style="width:100%;margin-top:10px" aria-label="Filter by project"><option value="">All projects</option>${projIds.map(id=>{const p=state.projects.find(x=>x.id===id); return p?`<option value="${id}" ${f.project===id?'selected':''}>${esc(p.code)} · ${esc(p.name)}</option>`:'';}).join('')}</select>`:''}
      </div>
    </aside>
    <section>
      <div class="count">${list.length} post${list.length===1?'':'s'} · pinned posts show first</div>
      ${list.length?`<div class="feed">${list.map((p,i)=>postCard(p,i+2)).join('')}</div>`
        :`<div class="card empty">No posts match these filters.<br><button class="link" data-action="clear-post-filters" style="margin-top:6px">Clear filters</button></div>`}
    </section></div>`;
  $('#pq').addEventListener('input',e=>{ state.postFilters.q=e.target.value; const pos=e.target.selectionStart; render(); const n=$('#pq'); n.focus(); n.setSelectionRange(pos,pos); });
  $('#punread').addEventListener('change',e=>{ state.postFilters.unread=e.target.checked; render(); });
  const pp=$('#pproj'); if(pp) pp.addEventListener('change',e=>{ state.postFilters.project=e.target.value; render(); });
  if(state.flashPost){ const el=document.getElementById('post-'+state.flashPost); if(el) el.scrollIntoView({behavior:reduced()?'auto':'smooth',block:'center'}); const id=state.flashPost; setTimeout(()=>{ if(state.flashPost===id) state.flashPost=null; },1900); }
  state.justUseful=null;
}
async function goToPost(id){
  if(dlg.open){ if(!(await confirmDiscard())) return; dlg.close(); }
  state.postFilters={q:'',cat:'',unread:false,project:''}; state.expanded.add(id); state.flashPost=id; state.view='posts'; state.animate=true; render();
}

/* Editor de publicaciones */
function openPostEditor(id){
  const p=id?state.posts.find(x=>x.id===id):null;
  state.postEditId=id||null; state.postDirty=false;
  state.draftLinks=p&&p.links.length?clone(p.links):[{label:'',url:''}];
  dlgPost.innerHTML=`<div class="dh"><div class="dh-top"><div><div class="small muted">${p?'Editing post':'Share knowledge with the team'}</div><h2>${p?esc(p.title):'New post'}</h2></div>
    <button class="x" data-action="close-post" aria-label="Close">✕</button></div></div>
    <div class="db"><form id="postForm" novalidate><div class="fg">
      <label class="f full"><span class="lt">Title *</span><input name="title" value="${esc(p?p.title:'')}" placeholder="e.g. How to write a good rollback plan"></label>
      <label class="f"><span class="lt">Category * ${info(CATS.map(c=>c.l+': '+c.h).join('\n'))}</span><select name="category">${CATS.map(c=>`<option value="${c.k}" ${p&&p.category===c.k?'selected':''}>${c.l}</option>`).join('')}</select></label>
      <label class="f"><span class="lt">Related project ${info('Optional. Link the post to a project: it shows up on the project page so the team can find it.')}</span><select name="projectId"><option value="">None (general)</option>${state.projects.map(x=>`<option value="${x.id}" ${p&&p.projectId===x.id?'selected':''}>${esc(x.code)} · ${esc(x.name)}</option>`).join('')}</select></label>
      <label class="f full"><span class="lt">Content * ${info('Quick formatting:\n**text** → bold\n`code` → code\n- at the start of a line → list\nBlank line → new paragraph')}</span><textarea name="body" rows="7" placeholder="Explain the topic in your own words. Use - for lists and **bold** to highlight.">${esc(p?p.body:'')}</textarea></label>
      <div class="full"><div class="small muted" style="font-weight:600;margin-bottom:6px;display:flex;gap:6px;align-items:center">Links ${info('Docs, articles or videos to dig deeper. They must start with http:// or https://. With no title, the domain is used.')}</div>
        <div id="linksEd"></div><button type="button" class="btn sm" data-action="add-link">+ Add link</button></div>
      <label class="f inline full"><input type="checkbox" name="pinned" ${p&&p.pinned?'checked':''}> Pin to top ${info('Pinned posts show first, on a dark background. Use it for the essentials.')}</label>
      <div class="full"><div class="small muted" style="font-weight:600;margin-bottom:6px">Preview</div><div class="preview"><div class="pbody" id="pv"></div></div></div>
    </div><div class="err" id="postErr" role="alert"></div>
    <div class="formfoot"><span class="dirty" id="postDirtyFlag">● Unsaved changes</span>
      <button type="button" class="btn" data-action="close-post">Cancel</button><button class="btn primary">${p?'Save changes':'Publish'}</button></div></form></div>`;
  renderLinksEd(); updatePreview();
  hideTip(); dlgPost.showModal(); dlgPost.querySelector('[name=title]').focus();
}
function renderLinksEd(newIdx){
  $('#linksEd').innerHTML=state.draftLinks.map((l,i)=>`<div class="linkrow ${i===newIdx?'new':''}">
    <input placeholder="Link title" value="${esc(l.label)}" data-li="${i}" data-lf="label" aria-label="Link title ${i+1}">
    <input placeholder="https://…" value="${esc(l.url)}" data-li="${i}" data-lf="url" class="${l.url&&!validUrl(l.url)?'bad':''}" aria-label="Link URL ${i+1}">
    <button type="button" class="btn sm" data-link-rm="${i}" data-tip="Remove link">✕</button></div>`).join('');
}
function updatePreview(){ const f=$('#postForm'); if(f) $('#pv').innerHTML=md(f.body.value); }

/* ---------- Técnico ---------- */
function renderTech(){
  app.innerHTML=`<div class="grid two">
  <div class="card rise"><h3>Modelo de datos sugerido (PostgreSQL)</h3><pre class="code">CREATE TABLE projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT UNIQUE NOT NULL,           -- PRJ-001
  name         TEXT NOT NULL CHECK (length(name) >= 3),
  type         TEXT NOT NULL CHECK (type IN ('Desarrollo','Mejora','Protocolo')),
  owner_id     UUID NOT NULL REFERENCES users(id),
  priority     TEXT NOT NULL CHECK (priority IN ('critica','alta','media','baja')),
  status       TEXT NOT NULL DEFAULT 'propuesta',
  start_date   DATE NOT NULL,
  due_date     DATE NOT NULL CHECK (due_date >= start_date),
  progress     SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  protocol_id  UUID REFERENCES protocols(id),
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  version      INT NOT NULL DEFAULT 1           -- bloqueo optimista
);

CREATE TABLE project_gates (
  project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,
  gate_key     TEXT NOT NULL,
  done         BOOLEAN NOT NULL DEFAULT false,
  done_by      UUID REFERENCES users(id),
  done_at      TIMESTAMPTZ,
  evidence_url TEXT,
  PRIMARY KEY (project_id, gate_key)
);

CREATE TABLE risks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  probability  SMALLINT NOT NULL CHECK (probability BETWEEN 1 AND 5),
  impact       SMALLINT NOT NULL CHECK (impact BETWEEN 1 AND 5),
  score        SMALLINT GENERATED ALWAYS AS (probability * impact) STORED,
  mitigation   TEXT,
  owner_id     UUID REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'abierto',
  CONSTRAINT critical_needs_plan
    CHECK (probability * impact < 15 OR coalesce(mitigation,'') <> '')
);

CREATE TABLE project_events (      -- auditoría inmutable
  id          BIGSERIAL PRIMARY KEY,
  project_id  UUID NOT NULL REFERENCES projects(id),
  actor_id    UUID NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_evidence (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,                 -- etapa a la que pertenece
  gate_key    TEXT,                          -- control que demuestra
  caption     TEXT NOT NULL CHECK (length(caption) >= 3),
  storage_key TEXT NOT NULL,                 -- ruta en S3/GCS (no base64 en BD)
  mime        TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp','image/gif')),
  bytes       INT  NOT NULL CHECK (bytes <= 4194304),
  sha256      TEXT NOT NULL,                 -- integridad y duplicados
  uploaded_by UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL CHECK (length(title) >= 3),
  body        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('guia','practicas','recurso','anuncio')),
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  pinned      BOOLEAN NOT NULL DEFAULT false,
  author_id   UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE post_links (
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  label   TEXT NOT NULL,
  url     TEXT NOT NULL CHECK (url ~ '^https?://')
);
CREATE TABLE post_reads (           -- quién leyó qué
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);</pre></div>
  <div class="grid" style="align-content:start">
  <div class="card rise" style="--i:1"><h3>Endpoints REST</h3><pre class="code">GET    /api/projects?status=&type=&health=&q=
POST   /api/projects
PATCH  /api/projects/:id            (If-Match: version)
POST   /api/projects/:id/transitions  { to, reason }
         409 → { missing_gates: [...] }
PUT    /api/projects/:id/gates/:key   { done, evidence_url }
POST   /api/projects/:id/risks
PATCH  /api/projects/:id/risks/:riskId
DELETE /api/projects/:id/risks/:riskId  (solo cerrados)
POST   /api/projects/:id/notes
GET    /api/alerts                    (job diario + webhook)

POST   /api/projects/:id/evidence     (multipart / URL firmada)
PATCH  /api/projects/:id/evidence/:evId  { stage, gate, caption }
DELETE /api/projects/:id/evidence/:evId
         409 si deja un control marcado sin evidencia
GET    /api/evidence/:evId/file       (URL firmada, expira 5 min)

GET    /api/posts?category=&project=&unread=
POST   /api/posts
PATCH  /api/posts/:id
DELETE /api/posts/:id
PUT    /api/posts/:id/read      DELETE → no leído
PUT    /api/posts/:id/useful
GET    /api/posts/:id/readers   (seguimiento de lectura)</pre></div>
  <div class="card rise" style="--i:2"><h3>Reglas de prevención implementadas</h3>
  <ul style="margin:0;padding-left:18px">
    <li>Máquina de estados con <b>gates obligatorios</b> (HTTP 409 si faltan).</li>
    <li>Retroceder o pausar exige <b>motivo</b> que queda en la bitácora.</li>
    <li>No se puede <b>desmarcar</b> un control de una etapa ya superada.</li>
    <li>Riesgos críticos (P×I ≥ 15) <b>requieren mitigación</b> y bloquean el lanzamiento.</li>
    <li>Solo se eliminan riesgos cerrados y proyectos en Propuesta/Pausado.</li>
    <li><b>Puntaje de salud</b> automático con acción sugerida.</li>
    <li>Controles críticos (pruebas, code review, rollback, backup) <b>exigen evidencia</b> para marcarse; su única evidencia no se puede borrar.</li>
    <li>Imágenes re-codificadas en el navegador: se reducen a 1600 px y se elimina la metadata EXIF (ej. GPS).</li>
    <li>Posts: URLs validadas (solo http/https), contenido escapado contra XSS y enlaces con <code>rel="noopener"</code>.</li>
    <li>Auditoría de cada cambio (quién, cuándo, antes → después).</li>
  </ul></div>
  <div class="card rise" style="--i:3"><h3>Atajos de teclado</h3>
    <div class="small"><kbd>N</kbd> nuevo (proyecto o post según la pestaña) · <kbd>/</kbd> buscar · <kbd>Esc</kbd> cerrar ventana · <kbd>Enter</kbd> abrir fila seleccionada</div></div>
  </div></div>`;
}

/* ---------- Detalle de proyecto ---------- */
function openDetail(id,tab='general'){
  state.detailId=id; state.detailTab=tab; state.editRiskId=null; state.dirty=false; state.staged=[]; state.evFilter={stage:'',gate:''}; state.pendingStage=state.pendingGate=null; renderDetail();
  if(!dlg.open){ dlg.classList.add('opening'); dlg.showModal(); setTimeout(()=>dlg.classList.remove('opening'),1300); }
}
function projectForm(p){
  const v=p||{name:'',type:'Desarrollo',owner:'',ownerId:'',priority:'media',startDate:addDays(0),dueDate:addDays(30),progress:0,protocol:'',description:''};
  const L=(t,h)=>`<span class="lt">${t}${h?' '+info(h):''}</span>`;
  return `<form id="projectForm" data-id="${p?p.id:''}" novalidate><div class="fg">
    <label class="f full">${L('Project name *','Short and clear, for example "WhatsApp reminders".')}<input name="name" value="${esc(v.name)}" placeholder="What will be built or improved?"></label>
    <label class="f">${L('Type *','Development: new functionality.\nImprovement: makes something existing better.\nProtocol: changes an operating or clinical procedure (needs a linked protocol).')}<select name="type">${TYPES.map(t=>`<option value="${t}" ${v.type===t?'selected':''}>${typeLabel(t)}</option>`).join('')}</select></label>
    <label class="f">${L('Priority *','Critical: affects patients or operations today.\nHigh: business impact this quarter.\nMedium / Low: nice to have, not urgent.')}<select name="priority">${PRIORITIES.map(x=>`<option value="${x.k}" ${v.priority===x.k?'selected':''}>${x.l}</option>`).join('')}</select></label>
    <label class="f">${L('Owner *','The main person accountable for progress. Everyone else goes under "Support".')}<select name="ownerId">${peopleOpts(v.ownerId)}</select></label>
    <label class="f">${L('Linked protocol','Code and name of the protocol this project creates or changes. Required for Protocol projects.')}<input name="protocol" value="${esc(v.protocol)}" placeholder="e.g. PR-AGD-02 Scheduling"></label>
    <div class="f full">${L('Support','Other people working on the project with the owner.')}${supportPicker(v.support)}</div>
    <label class="f">${L('Start date *','Used to work out the expected progress to date.')}<input type="date" name="startDate" value="${esc(v.startDate)}"></label>
    <label class="f">${L('Target date *','The committed launch date. If it passes, the project goes on high alert.')}<input type="date" name="dueDate" value="${esc(v.dueDate)}"></label>
    ${p?`<label class="f">${L('Progress (%)','Update it at least once a week. If it falls behind the expected progress, the system warns you.')}<input type="number" name="progress" min="0" max="100" step="5" value="${v.progress}" ${p.status==='lanzado'?'disabled':''}></label>`:''}
    <label class="f full">${L('Description / goal','What problem does it solve and how will success be measured?')}<textarea name="description" placeholder="Problem, goal and success KPI">${esc(v.description)}</textarea></label>
  </div><div class="err" id="formErr" role="alert"></div>
  <div class="formfoot"><span class="dirty" id="dirtyFlag">● Unsaved changes</span>
    ${p&&['propuesta','pausado'].includes(p.status)?'<button type="button" class="btn danger" data-action="delete" data-tip="Only projects in Proposal or Paused can be deleted">Delete</button>':''}
    <button type="button" class="btn" data-action="close">${p?'Close':'Cancel'}</button><button class="btn primary">${p?'Save changes':'Create and log risks →'}</button></div></form>`;
}
function renderDetail(){
  const keep=[...dlg.querySelectorAll(':scope > .toast-host')];
  renderDetailInner();
  keep.forEach(k=>dlg.appendChild(k));
  state.justGate=null;
}
function stepper(p){
  const cur=FLOW.indexOf(p.status);
  return `<ol class="stepper">${FLOW.map((k,i)=>{const cls=cur<0?'':i<cur?'done':i===cur?'current':'';
    const n=p.evidence.filter(e=>e.stage===k).length;
    return `<li class="${cls}" data-tip="${esc(statusLabel(k)+': '+STATUS_HELP[k]+'\n'+(n?n+' evidence item'+(n>1?'s':'')+' in this stage':'No evidence in this stage'))}"><span class="n">${i<cur?'✓':i+1}</span>${statusLabel(k)}${n?`<span class="evn">${n} evid.</span>`:''}</li>`;}).join('')}</ol>`;
}
function nextBar(p){
  const others=STATUSES.filter(s=>s.key!==p.status);
  const more=`<div class="more"><select id="statusSel" aria-label="Move to another stage">${others.map(s=>`<option value="${s.key}">${s.label}</option>`).join('')}</select>
    <button class="btn sm" data-action="apply-status" data-tip="Move to any stage. Moving forward needs the checks; moving back or pausing needs a reason.">Move</button></div>`;
  if(p.status==='lanzado') return `<div class="next neutral"><div class="txt"><b>Project launched.</b> It can only move back with a reason.</div>${more}</div>`;
  if(p.status==='pausado') return `<div class="next neutral"><div class="txt"><b>Project paused.</b> Pick the stage it goes back to in order to resume it.</div>${more}</div>`;
  const nx=nextStage(p); const miss=GATES[nx].filter(g=>!gateDone(p,g));
  if(!miss.length) return `<div class="next ready"><div class="txt"><b>Next step:</b> all checks are done to move to <b>${statusLabel(nx)}</b>.</div>
    <button class="btn ink go" data-action="advance" data-to="${nx}">Move to ${statusLabel(nx)} →</button>${more}</div>`;
  return `<div class="next lock"><div class="txt"><b>Next step:</b> complete ${miss.length} check${miss.length>1?'s':''} to move to <b>${statusLabel(nx)}</b>.</div>
    <button class="btn primary sm" data-subtab="gates">See pending checks</button>
    <button class="btn sm" aria-disabled="true" data-tip="${esc('Blocked. Missing:\n'+miss.map(g=>'• '+g.t).join('\n'))}">Move to ${statusLabel(nx)}</button>${more}</div>`;
}
function renderDetailInner(){
  if(!state.detailId){
    dlg.innerHTML=`<div class="dh"><div class="dh-top"><div><div class="small muted">Step 1 of 2 · next you’ll log the risks</div><h2>New project</h2></div>
      <button class="x" data-action="close" aria-label="Close">✕</button></div></div><div class="db">${projectForm(null)}</div>`; return;
  }
  const p=state.projects.find(x=>x.id===state.detailId); if(!p){ dlg.close(); return; }
  const h=health(p), t=state.detailTab;
  const openR=p.risks.filter(r=>r.status!=='cerrado');
  const critNoPlan=openR.some(r=>riskScore(r)>=15&&!r.mitigation);
  const nx=nextStage(p); const pendNext=nx&&p.status!=='pausado'?GATES[nx].filter(g=>!gateDone(p,g)).length:0;
  const related=state.posts.filter(x=>x.projectId===p.id);
  const evMissing=Object.values(GATES).flat().some(g=>g.ev&&p.checklist[g.k]&&!evCount(p,g.k));
  const tabs=[['general','General',h.reasons.length?`<span class="badge b-${h.level}" style="margin-left:4px">${h.reasons.length}</span>`:''],
              ['gates','Quality checks',pendNext?`<span class="badge b-warn" style="margin-left:4px">${pendNext}</span>`:''],
              ['riesgos',`Risks (${openR.length})`,critNoPlan||!p.risks.length?'<span class="pip"></span>':''],
              ['evidencias',`Evidence (${p.evidence.length})`,evMissing?'<span class="pip"></span>':''],
              ['bitacora','Log','']];
  let body='';
  if(t==='general'){
    body=`${h.reasons.length?`<div class="diag" style="background:var(--${h.level}-weak)"><b>Early diagnosis</b> ${info('Automatic findings. Each one links straight to the tab where you fix it.')}<ul>${h.reasons.map(r=>`<li><span class="dot d-${r.sev}"></span><span>${esc(r.msg)}</span>${r.tab!=='general'?`<button class="link act" data-subtab="${r.tab}">${esc(r.act)} →</button>`:`<span class="act small muted">${esc(r.act)}</span>`}</li>`).join('')}</ul></div>`:''}${projectForm(p)}
    <div class="related"><div style="font:600 14px var(--display);margin-bottom:6px;display:flex;gap:6px;align-items:center">Project reading ${info('Posts linked to this project. Great for anyone joining to catch up.')}</div>
      ${related.length?related.map(x=>`<button class="readitem" data-goto-post="${x.id}"><span class="tag cat-${x.category}">${esc(catLabel(x.category))}</span><span class="t">${esc(x.title)}</span>${x.read?'':'<span class="newdot" style="margin-left:auto;margin-top:5px"></span>'}</button>`).join('')
      :`<div class="small muted">No linked posts yet. <button class="link" data-action="new-post-for" data-project="${p.id}">Create one →</button></div>`}</div>`;
  } else if(t==='gates'){
    const cur=FLOW.indexOf(p.status);
    body=`<p class="muted small" style="margin-top:0">Each stage requires its checks before you can enter it. Hover over a check to see why it matters. Automatic checks are worked out by the system.</p>`+
    Object.keys(GATES).map(stage=>{const gs=GATES[stage]; const done=gs.filter(g=>gateDone(p,g)).length; const si=FLOW.indexOf(stage); const passed=cur>=si; const isNext=stage===nx&&p.status!=='pausado';
      return `<div class="gate ${isNext?'nextg':''}"><h4><span>To enter: ${statusLabel(stage)} ${isNext?'<span class="badge b-primary">Next</span>':''}</span>
        <span class="badge ${done===gs.length?'b-ok':passed?'b-warn':'b-neutral'}">${done}/${gs.length}${passed?' · passed':''}</span></h4>
        <div class="prog"><span style="width:${done/gs.length*100}%;${done===gs.length?'background:var(--ok)':''}"></span></div>
      ${gs.map(g=>{const d=gateDone(p,g); return g.auto
        ?`<label class="auto" data-tip="${esc(g.h)}"><input type="checkbox" ${d?'checked':''} disabled> ${esc(g.t)} <span class="badge b-neutral">automatic</span>${!d&&g.k==='auto_risk'?' <button type="button" class="link small" data-subtab="riesgos">Log a risk →</button>':''}</label>`
        :`<div class="grow"><label class="${passed&&d?'locked':''}" data-tip="${esc(g.h+(passed&&d?'\n\nLocked: this stage has already been passed.':''))}"><input type="checkbox" class="${state.justGate===g.k?'just':''}" data-gate="${g.k}" ${d?'checked':''} ${passed&&d?'disabled':''}> ${esc(g.t)}${g.ev?` <span class="badge ${evCount(p,g.k)?'b-ok':'b-primary'}" data-tip="To check this, attach at least one piece of evidence linked to it.">Requires evidence</span>`:''}</label>${evTools(p,g,stage)}</div>`;}).join('')}</div>`;}).join('');
  } else if(t==='riesgos'){
    const er=p.risks.find(r=>r.id===state.editRiskId);
    const opt=(arr,sel)=>[1,2,3,4,5].map(n=>`<option value="${n}" ${sel===n?'selected':''}>${n} · ${arr[n]}</option>`).join('');
    body=`<div class="table-wrap" style="margin-bottom:14px"><table><thead><tr><th data-tip="Probability × Impact">Score</th><th>Risk</th><th>Mitigation</th><th>Owner</th><th>Status</th><th></th></tr></thead><tbody>
      ${p.risks.length?p.risks.map(r=>{const sc=riskScore(r);return `<tr><td><span class="badge b-${riskLevel(sc)}" data-tip="${esc(riskTip(r))}">${sc}</span></td>
        <td>${esc(r.title)}</td><td class="small">${r.mitigation?esc(r.mitigation):'<span style="color:var(--bad);font-weight:600">No plan</span>'}</td><td>${who(r)}</td>
        <td>${esc((RISK_STATUS.find(s=>s.k===r.status)||{}).l)}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-risk-edit="${r.id}">Edit</button> <button class="btn sm danger" data-risk-del="${r.id}" data-tip="${r.status==='cerrado'?'Delete this risk':'Only closed risks can be deleted. Edit it and set it to Closed.'}">Delete</button></td></tr>`;}).join('')
      :'<tr><td colspan="6" class="empty">No risks yet. Logging at least one is required to approve the project.<br><span class="small">Think about: integrations, data, staff adoption, vendors, compliance.</span></td></tr>'}</tbody></table></div>
      <div class="card"><h3>${er?'Edit risk':'Log a risk'}</h3>
      <form id="riskForm" novalidate><input type="hidden" name="riskId" value="${er?er.id:''}"><div class="fg">
        <label class="f full"><span class="lt">Risk description * ${info('Write it as "If X happens, then Y". E.g. "If the CRM API goes down, call records are lost".')}</span><input name="title" value="${esc(er?er.title:'')}" placeholder="What could go wrong?"></label>
        <label class="f"><span class="lt">Probability * ${info('How likely is it to happen during the project?')}</span><select name="prob">${opt(PROB_LBL,er?er.prob:3)}</select></label>
        <label class="f"><span class="lt">Impact * ${info('If it happens, how serious is it for patients, operations or the business?')}</span><select name="impact">${opt(IMP_LBL,er?er.impact:3)}</select></label>
        <label class="f"><span class="lt">Owner * ${info('Who keeps an eye on this risk and carries out the mitigation.')}</span><select name="ownerId">${peopleOpts(er?er.ownerId:p.ownerId)}</select></label>
        <label class="f"><span class="lt">Status ${info('Open: identified.\nMitigating: the plan is underway.\nClosed: no longer applies or is under control.')}</span><select name="status">${RISK_STATUS.map(s=>`<option value="${s.k}" ${er&&er.status===s.k?'selected':''}>${s.l}</option>`).join('')}</select></label>
        <div class="f full"><span class="lt">Support ${info('Other people who help watch or mitigate this risk.')}</span>${supportPicker(er?er.support:[])}</div>
        <label class="f full"><span class="lt">Mitigation / prevention plan ${info('A concrete action that lowers the probability or the impact. Required if the score is ≥ 15.')}</span><textarea name="mitigation" placeholder="A concrete action to lower probability or impact">${esc(er?er.mitigation:'')}</textarea></label>
      </div><div class="small" id="riskScore" style="margin-top:10px"></div><div class="err" id="riskErr" role="alert"></div>
      <div class="formfoot">${er?'<button type="button" class="btn" data-action="risk-cancel">Cancel editing</button>':''}<button class="btn primary">${er?'Save risk':'Add risk'}</button></div></form></div>`;
  } else if(t==='evidencias'){
    body=evidenceTab(p);
  } else {
    const ico={create:'b-primary',status:'b-primary',evidence:'b-primary',gate:'b-ok',risk:'b-warn',edit:'b-neutral',note:'b-neutral',info:'b-neutral'};
    const lbl={create:'Created',evidence:'Evidence',status:'Stage',gate:'Check',risk:'Risk',edit:'Edit',note:'Note',info:'Info'};
    body=`<form id="noteForm" style="display:flex;gap:8px;margin-bottom:12px"><input class="field" name="note" placeholder="Log a decision, progress update or blocker…" style="flex:1" aria-label="New note"><button class="btn primary" data-tip="Adding a note also counts as a project update">Add</button></form>
    <ul class="log">${[...p.log].reverse().map(l=>`<li><span class="badge ${ico[l.kind]||'b-neutral'}" style="height:fit-content">${lbl[l.kind]||'Info'}</span><div><div>${esc(trLog(l.msg))}</div><div class="small muted">${fmtTs(l.ts)} · ${esc(l.user)}</div></div></li>`).join('')}</ul>`;
  }
  dlg.innerHTML=`<div class="dh">
      <div class="dh-top"><div style="position:relative;flex:none" data-tip="${esc(healthTip(h))}">${ring(h.score,58,lvlColor(h.level))}<b style="position:absolute;inset:0;display:grid;place-items:center;font:700 15px var(--display)">${h.score}</b></div>
        <div><div class="small muted">${esc(p.code)} · ${esc(typeLabel(p.type))} · ${pBadge(p.priority)} · ${who(p)} · ${relDue(p)}</div><h2>${esc(p.name)}</h2>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${sBadge(p.status)} ${hBadge(h)}</div></div>
        <button class="x" data-action="close" aria-label="Close">✕</button></div>
      ${stepper(p)}${nextBar(p)}
    </div>
    <div class="subtabs" role="tablist">${tabs.map(([k,l,x])=>`<button role="tab" aria-selected="${t===k}" data-subtab="${k}" class="${t===k?'active':''}">${l}${x}</button>`).join('')}</div>
    <div class="db">${body}</div>`;
  if(t==='riesgos') updateRiskPreview();
}
/* ---------- Evidencias ---------- */
function evTools(p,g,stage){
  const n=evCount(p,g.k);
  return `<span class="evtools">${n?`<button type="button" class="evc has" data-ev-gate="${g.k}" data-stage="${stage}" data-tip="See this check’s evidence">${n} evid.</button>`:''}<button type="button" class="evc" data-ev-attach="${g.k}" data-stage="${stage}" data-tip="Attach a screenshot or photo to this check">+ Evidence</button></span>`;
}
const gateOpts=(stage,sel)=>`<option value="">No specific check</option>`+(GATES[stage]||[]).filter(g=>!g.auto).map(g=>`<option value="${g.k}" ${sel===g.k?'selected':''}>${esc(g.t)}${g.ev?' (requires evidence)':''}</option>`).join('');
const stageOpts=sel=>FLOW.map(s=>`<option value="${s}" ${sel===s?'selected':''}>${statusLabel(s)}</option>`).join('');
function evidenceTab(p){
  const evs=p.evidence, f=state.evFilter;
  const list=evs.filter(e=>(!f.stage||e.stage===f.stage)&&(!f.gate||e.gate===f.gate));
  const grid=arr=>`<div class="evgrid">${arr.map((e,i)=>`<button type="button" class="evthumb" style="--i:${i}" data-ev-open="${e.id}" data-tip="${esc(e.caption+'\n'+statusLabel(e.stage)+(e.gate?' · '+gateTitle(e.gate):'')+'\nClick to enlarge')}"><img src="${e.dataUrl}" alt="${esc(e.caption)}" loading="lazy">${e.gate?`<span class="gchip">${esc(gateTitle(e.gate))}</span>`:''}<span class="cap">${esc(e.caption)}</span></button>`).join('')}</div>`;
  const missing=Object.values(GATES).flat().filter(g=>g.ev&&p.checklist[g.k]&&!evCount(p,g.k));
  return `${missing.length?`<div class="diag" style="background:var(--warn-weak)"><b>Checks marked without evidence</b> ${info('These checks were marked before evidence was required. Attach a screenshot or photo to back them up.')}<ul>${missing.map(g=>`<li><span class="dot d-media"></span><span>${esc(g.t)}</span><button type="button" class="link act" data-ev-attach="${g.k}" data-stage="${stageOfGate(g.k)}">Attach now →</button></li>`).join('')}</ul></div>`:''}
  <div class="dropzone" data-action="pick-ev" tabindex="0" role="button" aria-label="Add images as evidence">
    <div class="dz-ic">+</div>
    <div class="dz-t"><b>Drag images here, paste them with Ctrl+V or click</b><div class="small muted">PNG, JPG, WEBP or GIF · optimized to 1 MB max with metadata removed (e.g. GPS location) · up to 20 per project</div></div>
    <div class="dz-actions"><button type="button" class="btn sm" data-action="pick-ev">Choose files</button><button type="button" class="btn sm" data-action="cam-ev" data-tip="On a phone it opens the camera right away">Take photo</button></div>
  </div>
  <input type="file" id="evFile" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
  <input type="file" id="evCam" accept="image/*" capture="environment" hidden>
  <div class="warnline small">Privacy: don’t upload photos where a patient can be identified or screenshots with personal data showing.</div>
  ${state.staged.length?`<div class="staging"><div class="st-head"><b>To save (${state.staged.length})</b><span class="small muted">Describe what each image shows and assign it to a stage and, if it applies, to a check.</span></div>
    ${state.staged.map((s,i)=>`<div class="stg"><img src="${s.dataUrl}" alt="">
      <div class="stg-f"><input class="field" data-stg="${i}" data-sf="caption" placeholder="What does this image show? *" value="${esc(s.caption)}" aria-label="Description">
        <div class="stg-row"><select class="field" data-stg="${i}" data-sf="stage" aria-label="Stage">${stageOpts(s.stage)}</select><select class="field" data-stg="${i}" data-sf="gate" aria-label="Check">${gateOpts(s.stage,s.gate)}</select></div>
        <div class="small muted">${esc(s.name)} · ${s.w}×${s.h} · ${fmtSize(s.size)}</div></div>
      <button type="button" class="x sm" data-stg-rm="${i}" data-tip="Remove this image">✕</button></div>`).join('')}
    <div class="err" id="evErr" role="alert"></div>
    <div class="formfoot"><button type="button" class="btn" data-action="discard-staged">Discard</button><button type="button" class="btn primary" data-action="save-staged">Save ${state.staged.length} evidence item${state.staged.length>1?'s':''}</button></div></div>`:''}
  <div class="chips" style="margin-top:18px">${[['','All',evs.length],...FLOW.map(s=>[s,statusLabel(s),evs.filter(e=>e.stage===s).length])].map(([k,l,n])=>`<button type="button" class="chip ${f.stage===k&&!f.gate?'on':''}" data-ev-stage="${k}">${l} (${n})</button>`).join('')}
    ${f.gate?`<button type="button" class="chip on" data-ev-stage="" data-tip="Remove filter">Check: ${esc(gateTitle(f.gate))} ✕</button>`:''}</div>
  ${list.length?(f.stage||f.gate?grid(list):FLOW.filter(s=>list.some(e=>e.stage===s)).map(s=>`<div class="evsec"><h4>${statusLabel(s)} <span class="badge b-neutral">${list.filter(e=>e.stage===s).length}</span></h4>${grid(list.filter(e=>e.stage===s))}</div>`).join(''))
    :`<div class="empty">${evs.length?'No evidence matches this filter.':'No evidence yet. Upload screenshots of tests, approved PRs or photos of the operation and the protocol in use.'}</div>`}`;
}
const loadImg = src => new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=src; });
async function processImage(file){
  const name=file.name||'pasted-screenshot.png';
  if(!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) throw new Error(`${name}: format not allowed (use PNG, JPG, WEBP or GIF)`);
  if(file.size>15*1048576) throw new Error(`${name}: over 15 MB`);
  const url=URL.createObjectURL(file);
  try{
    let img; try{ img=await loadImg(url); }catch(e){ throw new Error(`${name}: the image couldn’t be read`); }
    const max=1600, k=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const w=Math.max(1,Math.round(img.naturalWidth*k)), h=Math.max(1,Math.round(img.naturalHeight*k));
    const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d');
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0,w,h);
    const enc=q=>{ let u=c.toDataURL('image/webp',q); if(!u.startsWith('data:image/webp')) u=c.toDataURL('image/jpeg',q); return u; };
    const bytesOf=u=>Math.round((u.length-u.indexOf(',')-1)*.75);
    let dataUrl=enc(.82);
    for(const q of [.7,.6,.5]){ if(bytesOf(dataUrl)<=1048576) break; dataUrl=enc(q); }
    if(bytesOf(dataUrl)>1048576) throw new Error(`${name}: still over 1 MB after optimizing; crop it or use a smaller screenshot`);
    return {dataUrl,w,h,size:bytesOf(dataUrl),name};
  } finally { URL.revokeObjectURL(url); }
}
async function handleFiles(files){
  files=[...files].filter(Boolean); if(!files.length) return;
  if(!state.detailId){ toast('Save the project first so you can attach evidence','e'); return; }
  const p=state.projects.find(x=>x.id===state.detailId); if(!p) return;
  const stage=state.pendingStage || (FLOW.includes(p.status)?p.status:'propuesta'), gate=state.pendingGate||'';
  state.pendingStage=state.pendingGate=null;
  const errs=[]; let ok=0;
  for(const f of files){ try{ const r=await processImage(f); state.staged.push({...r,stage,gate,caption:gate?gateTitle(gate):''}); ok++; }catch(e){ errs.push(e.message); } }
  state.detailTab='evidencias'; renderDetail();
  if(errs.length) toast('Some images weren’t added','e',errs);
  if(ok) toast(`${ok} ${ok>1?'images':'image'} ready: check the description and save`,'i');
}
function openLightbox(evId){
  const p=state.projects.find(x=>x.id===state.detailId); if(!p) return; const f=state.evFilter;
  const ids=FLOW.flatMap(s=>p.evidence.filter(e=>e.stage===s&&(!f.stage||e.stage===f.stage)&&(!f.gate||e.gate===f.gate))).map(e=>e.id);
  state.lb={ids,idx:Math.max(0,ids.indexOf(evId))}; renderLightbox(); hideTip(); if(!dlgImg.open) dlgImg.showModal();
}
function renderLightbox(){
  const p=state.projects.find(x=>x.id===state.detailId);
  if(!p||!state.lb){ if(dlgImg.open) dlgImg.close(); return; }
  state.lb.ids=state.lb.ids.filter(id=>p.evidence.some(e=>e.id===id));
  if(!state.lb.ids.length){ dlgImg.close(); return; }
  state.lb.idx=Math.min(Math.max(0,state.lb.idx),state.lb.ids.length-1);
  const {ids,idx}=state.lb; const e=p.evidence.find(x=>x.id===ids[idx]);
  const ext=((e.mime||'image/png').split('/')[1]||'png').replace('jpeg','jpg');
  const keep=[...dlgImg.querySelectorAll(':scope > .toast-host')];
  dlgImg.innerHTML=`<div class="lb"><div class="lb-view"><img class="lb-img" src="${e.dataUrl}" alt="${esc(e.caption)}">
      ${ids.length>1?`<button class="lb-nav prev" data-lb="-1" aria-label="Previous" data-tip="Previous (←)">‹</button><button class="lb-nav next" data-lb="1" aria-label="Next" data-tip="Next (→)">›</button>`:''}
      <div class="lb-count">${idx+1} / ${ids.length}</div></div>
    <aside class="lb-side">
      <div class="dh-top"><div><div class="small muted">${esc(p.code)} · Evidence</div><h2 style="font-size:17px">${esc(e.caption)}</h2></div><button class="x" data-action="close-lb" aria-label="Close">✕</button></div>
      <div class="lb-meta"><div><span class="muted">Stage</span><b>${statusLabel(e.stage)}</b></div><div><span class="muted">Check</span><b>${e.gate?esc(gateTitle(e.gate)):'—'}</b></div>
        <div><span class="muted">Uploaded by</span><b>${esc(e.by)}</b></div><div><span class="muted">Date</span><b>${fmtTs(e.at)}</b></div>
        <div style="grid-column:1/-1"><span class="muted">File</span><b>${e.w}×${e.h} · ${fmtSize(e.size)}</b></div></div>
      <form id="evEditForm" data-ev="${e.id}" novalidate><div class="fg">
        <label class="f"><span class="lt">Description</span><textarea name="caption" rows="2">${esc(e.caption)}</textarea></label>
        <label class="f"><span class="lt">Stage</span><select name="stage">${stageOpts(e.stage)}</select></label>
        <label class="f"><span class="lt">Check it proves</span><select name="gate">${gateOpts(e.stage,e.gate)}</select></label>
      </div><div class="err" id="evEditErr" role="alert"></div>
      <div class="formfoot" style="margin-top:10px"><button class="btn primary sm">Save changes</button></div></form>
      <div class="lb-actions"><a class="btn sm" href="${e.dataUrl}" download="${esc(p.code)}-${e.stage}-${idx+1}.${ext}">Download</a><button class="btn sm danger" data-action="del-ev">Delete</button></div>
      <div class="small muted">Use ← → to browse · Esc to close</div>
    </aside></div>`;
  keep.forEach(k=>dlgImg.appendChild(k));
}

function updateRiskPreview(){
  const f=$('#riskForm'); if(!f) return;
  const sc=f.prob.value*f.impact.value; const lv=riskLevel(sc);
  $('#riskScore').innerHTML=`Resulting score: <span class="badge b-${lv}">${sc} · ${lv==='bad'?'Critical':lv==='warn'?'Moderate':'Low'}</span> ${sc>=15?'<span style="color:var(--bad)">The mitigation plan is required, and it blocks the launch while the risk stays open.</span>':''}`;
}
function newProject(){ state.detailId=null; state.dirty=false; renderDetail(); dlg.classList.add('opening'); dlg.showModal(); setTimeout(()=>dlg.classList.remove('opening'),1300); dlg.querySelector('[name=name]').focus(); }

/* ---------- Eventos (delegación) ---------- */
document.addEventListener('click', async e=>{
  const t=e.target;
  const suprm=t.closest('[data-sup-rm]'); if(suprm){ const fm=suprm.closest('form'); suprm.closest('.supchip').remove();
    if(fm&&fm.id==='projectForm'){ state.dirty=true; const fl=$('#dirtyFlag'); if(fl) fl.classList.add('on'); } return; }
  const tab=t.closest('#tabs button'); if(tab){ if(tab.dataset.view!==state.view) go(tab.dataset.view); return; }
  const sv=t.closest('[data-sev]'); if(sv){ state.alertSev=sv.dataset.sev; render(); return; }
  const so=t.closest('[data-sort]'); if(so){ const k=so.dataset.sort; state.sort = state.sort.key===k?{key:k,dir:-state.sort.dir}:{key:k,dir:1}; render(); return; }
  const sub=t.closest('[data-subtab]'); if(sub){ if(sub.dataset.subtab===state.detailTab) return; if(!(await confirmDiscard())) return; state.detailTab=sub.dataset.subtab; state.editRiskId=null; renderDetail(); return; }
  const pc=t.closest('[data-pcat]'); if(pc){ state.postFilters.cat=pc.dataset.pcat; state.animate=true; render(); return; }
  const ex=t.closest('[data-expand]'); if(ex){ const id=ex.dataset.expand; state.expanded.has(id)?state.expanded.delete(id):state.expanded.add(id); render(); return; }
  const rd0=t.closest('[data-read]'); if(rd0){ const p=state.posts.find(x=>x.id===rd0.dataset.read); const at={...pointer};
    await call(()=>api.toggleRead(p.id), p.read?'Marked as unread':'Marked as read');
    if(!p.read && state.posts.every(x=>x.read)){ confetti(at.x,at.y,60); toast('You’re all caught up on your reading!','s'); }
    return; }
  const us=t.closest('[data-useful]'); if(us){ state.justUseful=us.dataset.useful; await call(()=>api.toggleUseful(us.dataset.useful)); return; }
  const pe=t.closest('[data-post-edit]'); if(pe){ openPostEditor(pe.dataset.postEdit); return; }
  const pd=t.closest('[data-post-del]'); if(pd){ const p=state.posts.find(x=>x.id===pd.dataset.postDel);
    if(await ask({title:'Delete post',msg:`"${p.title}" will be deleted for the whole team.`,okText:'Delete',danger:true})) await call(()=>api.deletePost(p.id),'Post deleted');
    return; }
  const gp=t.closest('[data-goto-post]'); if(gp){ goToPost(gp.dataset.gotoPost); return; }
  const lr=t.closest('[data-link-rm]'); if(lr){ state.draftLinks.splice(+lr.dataset.linkRm,1); if(!state.draftLinks.length) state.draftLinks.push({label:'',url:''}); state.postDirty=true; $('#postDirtyFlag').classList.add('on'); renderLinksEd(); return; }
  const lk=t.closest('a[data-linkpost]'); if(lk){ const p=state.posts.find(x=>x.id===lk.dataset.linkpost); if(p&&!p.read){ api.markRead(p.id).then(()=>refresh()); toast('Marked as read since you opened the link','s'); } return; }
  const evs=t.closest('[data-ev-stage]'); if(evs){ state.evFilter={stage:evs.dataset.evStage,gate:''}; renderDetail(); return; }
  const evg=t.closest('[data-ev-gate]'); if(evg){ state.evFilter={stage:evg.dataset.stage,gate:evg.dataset.evGate}; state.detailTab='evidencias'; renderDetail(); return; }
  const eva=t.closest('[data-ev-attach]'); if(eva){ state.detailTab='evidencias'; renderDetail(); state.pendingStage=eva.dataset.stage; state.pendingGate=eva.dataset.evAttach; $('#evFile').click(); return; }
  const evo=t.closest('[data-ev-open]'); if(evo){ openLightbox(evo.dataset.evOpen); return; }
  const srm=t.closest('[data-stg-rm]'); if(srm){ state.staged.splice(+srm.dataset.stgRm,1); renderDetail(); return; }
  const lbn=t.closest('[data-lb]'); if(lbn){ const n=state.lb.ids.length; state.lb.idx=(state.lb.idx+ +lbn.dataset.lb+n)%n; renderLightbox(); return; }
  const act=t.closest('[data-action]');
  if(act){
    const a=act.dataset.action;
    const goF=(view,f={})=>{ state.filters={q:'',status:'',type:'',health:'',...f}; go(view); };
    if(a==='new'){ state.view==='posts'?openPostEditor():newProject(); }
    else if(a==='new-post'){ openPostEditor(); }
    else if(a==='new-post-for'){ if(!(await confirmDiscard())) return; const pid=act.dataset.project; dlg.close(); openPostEditor(); dlgPost.querySelector('[name=projectId]').value=pid; }
    else if(a==='close'){ if(await confirmDiscard()) dlg.close(); }
    else if(a==='close-post'){ if(await confirmDiscard('postDirty')) dlgPost.close(); }
    else if(a==='add-link'){ if(state.draftLinks.length>=10){ toast('Up to 10 links per post','e'); return; } state.draftLinks.push({label:'',url:''}); renderLinksEd(state.draftLinks.length-1); const ins=$('#linksEd').querySelectorAll('input'); ins[ins.length-2].focus(); }
    else if(a==='help'){ state.help=true; go('resumen'); }
    else if(a==='hide-help'){ state.help=false; render(); }
    else if(a==='go-posts'){ go('posts'); }
    else if(a==='clear-filters'){ state.filters={q:'',status:'',type:'',health:''}; render(); }
    else if(a==='clear-post-filters'){ state.postFilters={q:'',cat:'',unread:false,project:''}; render(); }
    else if(a==='kpi-active'){ goF('proyectos'); }
    else if(a==='kpi-health'){ state.sort={key:'health',dir:1}; goF('proyectos'); }
    else if(a==='kpi-risk'){ goF('proyectos',{health:'bad'}); }
    else if(a==='kpi-overdue'){ goF('proyectos',{health:'overdue'}); }
    else if(a==='kpi-risks'){ go('riesgos'); }
    else if(a==='export'){ const data=await api.exportAll(); const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
      const u=URL.createObjectURL(blob); const l=document.createElement('a'); l.href=u; l.download=`projects-${isoDate(new Date())}.json`; document.body.appendChild(l); l.click(); l.remove(); setTimeout(()=>URL.revokeObjectURL(u),1000); toast('Backup downloaded','s'); }
    else if(a==='reset'){ if(await ask({title:'Restaurar datos de demostración',msg:'Se reemplazarán todos los proyectos y posts actuales por los de ejemplo. Exporta primero si quieres conservarlos.',okText:'Restaurar',danger:true})){ seed(); state.animate=true; await refresh(); toast('Datos de demostración restaurados','s'); } }
    else if(a==='advance'){ await moveTo(state.detailId,act.dataset.to); }
    else if(a==='apply-status'){ await moveTo(state.detailId,$('#statusSel').value); }
    else if(a==='delete'){ const p=state.projects.find(x=>x.id===state.detailId);
      if(await ask({title:`Delete ${p.code}`,msg:`"${p.name}" will be permanently deleted along with its risks and log.`,okText:'Delete',danger:true})){
        state.dirty=false; const r=await call(()=>api.remove(state.detailId),'Project deleted'); if(r) dlg.close(); } }
    else if(a==='pick-ev'){ $('#evFile').click(); }
    else if(a==='cam-ev'){ $('#evCam').click(); }
    else if(a==='discard-staged'){ state.staged=[]; renderDetail(); }
    else if(a==='save-staged'){
      const items=state.staged.map(s=>({stage:s.stage,gate:s.gate,caption:s.caption,dataUrl:s.dataUrl,w:s.w,h:s.h,size:s.size,name:s.name}));
      try{
        await api.addEvidence(state.detailId,items); state.staged=[];
        const p=state.projects.find(x=>x.id===state.detailId);
        const ready=[...new Set(items.filter(i=>i.gate&&gateByKey(i.gate).ev&&!p.checklist[i.gate]).map(i=>gateTitle(i.gate)))];
        toast(`${items.length} evidence item${items.length>1?'s':''} saved`,'s');
        await refresh();
        if(ready.length) toast('You can now check these in Quality checks:','i',ready);
      }catch(err){ if(err instanceof ApiError){ const el=$('#evErr'); el.innerHTML=''; requestAnimationFrame(()=>{ el.innerHTML=err.details.map(esc).join('<br>')||esc(err.message); }); } else throw err; }
    }
    else if(a==='close-lb'){ dlgImg.close(); }
    else if(a==='del-ev'){
      const p=state.projects.find(x=>x.id===state.detailId); const ev=p.evidence.find(x=>x.id===state.lb.ids[state.lb.idx]);
      if(await ask({title:'Delete evidence',msg:`"${ev.caption}" will be removed from the project. The change is recorded in the log.`,okText:'Delete',danger:true}))
        await call(()=>api.deleteEvidence(state.detailId,ev.id),'Evidence deleted');
    }
    else if(a==='risk-cancel'){ state.editRiskId=null; renderDetail(); }
    return;
  }
  const re=t.closest('[data-risk-edit]'); if(re){ state.editRiskId=re.dataset.riskEdit; renderDetail(); $('#riskForm [name=title]').focus(); return; }
  const rd=t.closest('[data-risk-del]'); if(rd){
    const p=state.projects.find(x=>x.id===state.detailId); const r=p.risks.find(x=>x.id===rd.dataset.riskDel);
    if(r.status!=='cerrado'){ toast('Only closed risks can be deleted. Edit it and set it to "Closed" first.','e'); return; }
    if(await ask({title:'Delete risk',msg:`"${r.title}"`,okText:'Delete',danger:true})) await call(()=>api.deleteRisk(state.detailId,r.id),'Risk deleted');
    return; }
  const op=t.closest('[data-open]'); if(op && !dlg.open){ openDetail(op.dataset.open, op.dataset.tab||'general'); }
});
document.addEventListener('keydown', e=>{
  const typing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if(dlgImg.open && !$('#dlgAsk').open && !typing && (e.key==='ArrowLeft'||e.key==='ArrowRight') && state.lb && state.lb.ids.length>1){
    const n=state.lb.ids.length; state.lb.idx=(state.lb.idx+(e.key==='ArrowRight'?1:-1)+n)%n; renderLightbox(); return; }
  if((e.key==='Enter'||e.key===' ') && document.activeElement.classList && document.activeElement.classList.contains('dropzone')){ e.preventDefault(); $('#evFile').click(); return; }
  const anyDlg=dlg.open||dlgPost.open||dlgImg.open||$('#dlgAsk').open;
  if(e.key==='Enter' && !typing && document.activeElement.dataset.open && !anyDlg){ openDetail(document.activeElement.dataset.open, document.activeElement.dataset.tab||'general'); return; }
  if(typing || anyDlg || e.metaKey || e.ctrlKey || e.altKey) return;
  if(e.key==='/' && ($('#fq')||$('#pq'))){ e.preventDefault(); ($('#fq')||$('#pq')).focus(); }
  else if(e.key==='n' || e.key==='N'){ e.preventDefault(); state.view==='posts'?openPostEditor():newProject(); }
});
document.addEventListener('input', e=>{
  if(e.target.dataset.stg!==undefined && e.target.dataset.sf==='caption'){ state.staged[+e.target.dataset.stg].caption=e.target.value; return; }
  if(e.target.closest('#projectForm')){ state.dirty=true; const f=$('#dirtyFlag'); if(f) f.classList.add('on'); }
  if(e.target.closest('#postForm')){
    state.postDirty=true; $('#postDirtyFlag').classList.add('on');
    const li=e.target.dataset.li;
    if(li!==undefined){ state.draftLinks[+li][e.target.dataset.lf]=e.target.value; if(e.target.dataset.lf==='url') e.target.classList.toggle('bad', !!e.target.value && !validUrl(e.target.value)); }
    if(e.target.name==='body') updatePreview();
  }
});
document.addEventListener('change', async e=>{
  if(e.target.matches('[data-sup-add]')){ const s=e.target, id=s.value; s.value='';
    const box=s.closest('.sup'); const x=state.people.find(q=>q.id===id);
    if(x && ![...box.querySelectorAll('[name=supportIds]')].some(i=>i.value===id)) s.insertAdjacentHTML('beforebegin',supChip(x.id,x.name)); }
  if(e.target.id==='evFile'||e.target.id==='evCam'){ const fl=[...e.target.files]; e.target.value=''; handleFiles(fl); return; }
  if(e.target.dataset.stg!==undefined){ const s=state.staged[+e.target.dataset.stg], f=e.target.dataset.sf; s[f]=e.target.value; if(f==='stage'){ s.gate=''; renderDetail(); } return; }
  if(e.target.closest('#evEditForm') && e.target.name==='stage'){ e.target.form.gate.innerHTML=gateOpts(e.target.value,''); return; }
  if(e.target.closest('#projectForm')){ state.dirty=true; const f=$('#dirtyFlag'); if(f) f.classList.add('on'); }
  if(e.target.closest('#postForm')){ state.postDirty=true; $('#postDirtyFlag').classList.add('on'); }
  const g=e.target.closest('[data-gate]');
  if(g){ state.justGate=g.checked?g.dataset.gate:null; const ok=await call(()=>api.setGate(state.detailId,g.dataset.gate,g.checked)); if(!ok) renderDetail(); }
  if(e.target.closest('#riskForm') && ['prob','impact'].includes(e.target.name)) updateRiskPreview();
});
document.addEventListener('submit', async e=>{
  const f=e.target; const fid=f.getAttribute('id');
  const showErr=(sel,err)=>{ const el=$(sel); el.innerHTML=''; requestAnimationFrame(()=>{ el.innerHTML=err.details.length?err.details.map(esc).join('<br>'):esc(err.message); }); };
  if(fid==='projectForm'){
    e.preventDefault();
    const data=Object.fromEntries(new FormData(f)); data.supportIds=new FormData(f).getAll('supportIds');
    const id=f.dataset.id;
    if(id){ const p=state.projects.find(x=>x.id===id); if(!('progress' in data)) data.progress=p.progress; }
    else data.progress=0;
    try{
      const r= id ? await api.update(id,data) : await api.create(data);
      state.dirty=false;
      toast(id?'Changes saved':`Project ${r.code} created`,'s');
      state.projects=await api.list(); render();
      if(!id){ openDetail(r.id,'riesgos'); toast('Step 2: log the project’s risks','i'); } else renderDetail();
    }catch(err){ if(err instanceof ApiError) showErr('#formErr',err); else throw err; }
  }
  if(fid==='riskForm'){
    e.preventDefault();
    const data=Object.fromEntries(new FormData(f)); data.supportIds=new FormData(f).getAll('supportIds'); if(data.riskId) data.id=data.riskId; delete data.riskId;
    try{ await api.saveRisk(state.detailId,data); state.editRiskId=null; toast('Risk saved','s'); await refresh(); }
    catch(err){ if(err instanceof ApiError) showErr('#riskErr',err); else throw err; }
  }
  if(fid==='noteForm'){
    e.preventDefault();
    await call(()=>api.addNote(state.detailId,f.note.value),'Note added');
  }
  if(fid==='evEditForm'){
    e.preventDefault();
    const fd=Object.fromEntries(new FormData(f));
    try{ await api.updateEvidence(state.detailId,f.dataset.ev,fd); toast('Evidence updated','s'); await refresh(); }
    catch(err){ if(err instanceof ApiError) showErr('#evEditErr',err); else throw err; }
  }
  if(fid==='postForm'){
    e.preventDefault();
    const fd=Object.fromEntries(new FormData(f));
    const input={id:state.postEditId||undefined,title:fd.title,body:fd.body,category:fd.category,projectId:fd.projectId,pinned:!!fd.pinned,links:state.draftLinks};
    try{
      const r=await api.savePost(input); const isNew=!state.postEditId;
      state.postDirty=false; dlgPost.close();
      state.postFilters={q:'',cat:'',unread:false,project:''}; state.flashPost=r.id; state.expanded.add(r.id);
      state.posts=await api.listPosts(); state.projects=await api.list();
      if(state.view!=='posts') state.animate=true; state.view='posts'; render();
      toast(isNew?'Post shared with the team':'Post updated','s');
      if(isNew) confetti(innerWidth/2,innerHeight/3,40);
    }catch(err){ if(err instanceof ApiError) showErr('#postErr',err); else throw err; }
  }
});
if($('#importFile')) $('#importFile').addEventListener('change', async e=>{
  const file=e.target.files[0]; e.target.value=''; if(!file) return;
  let data; try{ data=JSON.parse(await file.text()); }catch(err){ toast('El archivo no es un JSON válido','e'); return; }
  if(await ask({title:'Importar respaldo',msg:`Se reemplazarán los proyectos y posts actuales con el contenido de "${file.name}".`,okText:'Importar',danger:true})){
    state.animate=true; await call(()=>api.importAll(data),'Datos importados'); }
});
dlg.addEventListener('cancel', e=>{ if(state.dirty||state.staged.length){ e.preventDefault(); confirmDiscard().then(ok=>ok&&dlg.close()); } });
dlg.addEventListener('close',()=>{ state.detailId=null; state.editRiskId=null; state.dirty=false; state.staged=[]; hideTip(); if(dlgImg.open) dlgImg.close(); });
dlgImg.addEventListener('close',()=>{ state.lb=null; hideTip(); });
/* Pegar capturas (Ctrl+V) y arrastrar archivos al detalle del proyecto */
document.addEventListener('paste',e=>{
  if(!dlg.open || !state.detailId || dlgPost.open || dlgImg.open || $('#dlgAsk').open) return;
  const files=[...((e.clipboardData&&e.clipboardData.items)||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile());
  if(!files.length) return; e.preventDefault(); handleFiles(files);
});
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
document.addEventListener('dragover',e=>{
  if(!hasFiles(e)) return; e.preventDefault();
  const dz=e.target.closest && e.target.closest('.dropzone');
  document.querySelectorAll('.dropzone.hot').forEach(d=>{ if(d!==dz) d.classList.remove('hot'); }); if(dz) dz.classList.add('hot');
});
document.addEventListener('dragleave',e=>{ if(hasFiles(e) && e.target.classList && e.target.classList.contains('dropzone')) e.target.classList.remove('hot'); });
document.addEventListener('drop',e=>{
  if(!hasFiles(e)) return; e.preventDefault();
  document.querySelectorAll('.dropzone.hot').forEach(d=>d.classList.remove('hot'));
  if(dlg.open && !dlgPost.open && !dlgImg.open) handleFiles(e.dataTransfer.files);
  else toast('To attach images, open a project and drop them in the Evidence tab','i');
});
dlgPost.addEventListener('cancel', e=>{ if(state.postDirty){ e.preventDefault(); confirmDiscard('postDirty').then(ok=>ok&&dlgPost.close()); } });
dlgPost.addEventListener('close',()=>{ state.postEditId=null; state.postDirty=false; hideTip(); });

/* Arranque */
seed(); refresh();  // con api-http.js, seed() no hace nada y refresh() carga desde el servidor
