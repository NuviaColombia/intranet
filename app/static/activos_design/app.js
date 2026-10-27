'use strict';
const titles={dashboard:'Resumen del inventario',equipos:'Gestión de equipos',dongles:'Gestión de dongles',usuarios:'Usuarios activos',retirados:'Equipos y usuarios retirados',mantenimientos:'Calendario y registro de mantenimientos',areas:'Áreas y departamentos',grupos:'Grupos de trabajo',excel:'Exportar y comparar con Excel',respaldos:'Historial y puntos de restauración'};
const $=id=>document.getElementById(id);
let toastTimer, modalSubmit=null, volverModal=null, equiposRows=[], equiposPage=1;
let mantenimientoMes=new Date(new Date().getFullYear(),new Date().getMonth(),1),mantenimientosCalendario=[];
const EQUIPOS_PAGE_SIZE=50;
function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
// SQLite guarda CURRENT_TIMESTAMP en UTC ("AAAA-MM-DD HH:MM:SS"); se muestra en la hora local del navegador.
function fmtFecha(value){if(!value)return '';const text=String(value);if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text))return new Date(text.replace(' ','T')+'Z').toLocaleString('es-CO');if(/T\d{2}:\d{2}/.test(text))return new Date(text).toLocaleString('es-CO');return text}
function notify(message,error=false){const toast=$('toast');toast.textContent=message;toast.className='toast show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.className='toast',5000)}
async function api(url,options={}){const response=await fetch(url,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});let data={};try{data=await response.json()}catch{}if(!response.ok)throw new Error(data.detail||`La solicitud falló (${response.status}).`);return data}
function badge(status){let cls=status==='EN USO'?'inuse':status==='STOCK'?'stock':status==='MANTENIMIENTO'?'maintenance':status==='DISPONIBLE'?'available':'stock';return `<span class="badge ${cls}">${esc(status||'—')}</span>`}
function setEmpty(id,cols,message='No hay registros que coincidan con la búsqueda.'){ $(id).innerHTML=`<tr><td colspan="${cols}" class="empty">${esc(message)}</td></tr>`}
// ---------------------------------------------------------------------------
// Botón flotante de filtros (común a todos los módulos). Cada .fab[data-panel] abre su
// .filtro-panel; el módulo registra en FILTROS[panel] su estado, sus campos (select o chips),
// cómo contar resultados y qué volver a cargar al cambiar un filtro.
// ---------------------------------------------------------------------------
const FILTROS={};
function cerrarPaneles(){document.querySelectorAll('.filtro-panel:not([hidden])').forEach(panel=>{panel.hidden=true;document.querySelector(`.fab[data-panel="${panel.id}"]`)?.setAttribute('aria-expanded','false')})}
function pintarFiltros(panelId){
 const {titulo,estado,campos,conteo}=FILTROS[panelId],activos=Object.values(estado).filter(Boolean).length,[visibles,total]=conteo();
 const contador=document.querySelector(`.fab[data-panel="${panelId}"] .fab-contador`);contador.hidden=!activos;contador.textContent=activos;
 $(panelId).innerHTML=`<h3>${titulo}</h3>${campos().map(({clave,label,chips,opciones})=>chips
  ?`<label>${label}<span class="filtro-chips">${opciones.map(([v,t])=>`<button type="button" data-chip="${clave}" data-valor="${esc(v)}" class="${estado[clave]===v?'active':''}">${esc(t)}</button>`).join('')}</span></label>`
  :`<label>${label}<select data-filtro="${clave}">${opciones.map(([v,t])=>`<option value="${esc(v)}" ${estado[clave]===v?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`).join('')}
  <div class="filtro-acciones"><span>${visibles} de ${total}</span><button type="button" class="secondary" data-limpiar-filtros ${activos?'':'disabled'}>Limpiar filtros</button></div>`
}
function cambiarFiltro(panelId,clave,valor){const f=FILTROS[panelId];if(clave===null)Object.keys(f.estado).forEach(k=>f.estado[k]='');else f.estado[clave]=valor;f.alCambiar?.(clave);Promise.resolve(f.aplicar()).catch(e=>notify(e.message,true))}
function opcionesUnicas(valores,todos){return [['',todos],...[...new Set(valores.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b))).map(v=>[String(v),String(v)])]}
document.querySelectorAll('.fab[data-panel]').forEach(fab=>fab.addEventListener('click',()=>{const panel=$(fab.dataset.panel),abrir=panel.hidden;cerrarPaneles();if(!abrir)return;pintarFiltros(panel.id);panel.hidden=false;fab.setAttribute('aria-expanded','true')}));
document.querySelectorAll('.filtro-panel').forEach(panel=>{
 panel.addEventListener('change',e=>{const select=e.target.closest('[data-filtro]');if(select)cambiarFiltro(panel.id,select.dataset.filtro,select.value)});
 panel.addEventListener('click',e=>{const chip=e.target.closest('[data-chip]');if(chip)cambiarFiltro(panel.id,chip.dataset.chip,chip.dataset.valor);if(e.target.closest('[data-limpiar-filtros]'))cambiarFiltro(panel.id,null)})});
// composedPath conserva el recorrido del clic aunque el panel se haya vuelto a dibujar.
document.addEventListener('click',e=>{if(!e.composedPath().some(n=>n.classList?.contains('filtro-panel')||n.classList?.contains('fab')))cerrarPaneles()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')cerrarPaneles()});
// Alto real del título fijo del módulo: los encabezados de las tablas se pegan justo debajo.
function medirEncabezado(){document.documentElement.style.setProperty('--alto-topbar',`${document.querySelector('.topbar').offsetHeight}px`)}
window.addEventListener('resize',medirEncabezado);
// El buscador del encabezado fijo muestra solo el campo del módulo activo.
function switchView(view){cerrarPaneles();document.querySelectorAll('.nav button,.view').forEach(el=>el.classList.remove('active'));document.querySelector(`.nav button[data-view="${view}"]`)?.classList.add('active');$(view).classList.add('active');$('title').textContent=titles[view];document.querySelectorAll('#topbar-busqueda [data-vista]').forEach(campo=>{campo.hidden=campo.dataset.vista!==view});medirEncabezado();loadView(view)}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
async function loadView(view){try{if(view==='dashboard')await Promise.all([loadSummary(),loadEstado()]);if(view==='grupos')await loadGrupos();if(view==='equipos')await loadEquipos();if(view==='dongles')await loadDongles();if(view==='usuarios')await loadUsuarios();if(view==='retirados')await loadRetirados();if(view==='mantenimientos')await loadMantenimientos();if(view==='areas')await loadAreasView();if(view==='respaldos')await loadRespaldos()}catch(error){notify(error.message,true)}}
async function loadSummary(){const d=await api('/activos/design/api/resumen');$('metric-equipos').textContent=d.equipos;$('metric-uso').textContent=d.en_uso;$('metric-stock').textContent=d.stock;$('metric-dongles').textContent=d.dongles;$('metric-disponibles').textContent=d.dongles_disponibles;$('metric-mantenimiento').textContent=d.mantenimiento;$('nav-equipos').textContent=d.equipos;$('nav-dongles').textContent=d.dongles;const total=d.equipos||0;for(const [key,value] of [['uso',d.en_uso],['stock',d.stock],['mantenimiento',d.mantenimiento]]){$(`stat-${key}`).textContent=`${value} (${total?Math.round(value/total*100):0}%)`;$(`bar-${key}`).style.width=`${total?value/total*100:0}%`}}
function fechaCorta(iso){if(!iso)return '—';const [y,m,d]=String(iso).slice(0,10).split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('es-CO',{day:'numeric',month:'short',year:'numeric'})}
// Estado de mantenimiento de cada equipo: [etiqueta, clase del badge, color en la barra].
const SALUD={OPTIMO:['Óptimas condiciones','inuse','#138a5b'],NOVEDADES:['Novedades a revisar','maintenance','#e08a00'],EN_MANTENIMIENTO:['En mantenimiento','overdue','#c0392b'],SIN_REVISION:['Sin revisión','neutral','#a0aec0']};
function saludBadge(estado){const [texto,clase]=SALUD[estado]||SALUD.SIN_REVISION;return `<span class="badge ${clase}">${texto}</span>`}
// El estado de un grupo es el más urgente entre sus equipos.
function saludGrupo(c){return c.EN_MANTENIMIENTO?'EN_MANTENIMIENTO':c.NOVEDADES?'NOVEDADES':c.SIN_REVISION?'SIN_REVISION':'OPTIMO'}
function saludBarra(c){const total=Object.values(c).reduce((a,b)=>a+b,0)||1;return `<div class="salud-bar">${Object.entries(SALUD).map(([k,[t,,color]])=>c[k]?`<span style="width:${c[k]/total*100}%;background:${color}" title="${t}: ${c[k]}"></span>`:'').join('')}</div><div class="salud-legend">${Object.entries(SALUD).map(([k,[t,,color]])=>`<div><i style="background:${color}"></i>${t} <strong>${c[k]||0}</strong></div>`).join('')}</div>`}
function alertaHtml([tipo,titulo,detalle,accion,id],boton='Ver'){return `<div class="alert-item ${tipo}"><div><strong>${esc(titulo)}</strong><p>${esc(detalle)}</p></div><button class="small-button" type="button" data-action="${accion}" data-id="${esc(id)}">${boton}</button></div>`}
// Un solo pedido alimenta el panel del Resumen y los indicadores del módulo de Mantenimientos.
async function loadEstado(){
 const d=await api('/activos/design/api/mantenimientos/estado'),urgentes=[],enCurso=d.jornadas_abiertas.length+d.jornadas_vencidas.length;
 for(const j of d.jornadas_vencidas)urgentes.push(['danger',`Solicitud vencida · ${tituloSolicitud(j)}`,`${fechaCorta(j.fecha_programada)} · ${j.pendientes} de ${j.total} equipos pendientes`,'open-jornada',j.id_jornada]);
 for(const m of d.mantenimientos_vencidos)urgentes.push(['danger',`Servicio vencido · ${m.asset_tag}`,`${m.tipo_mantenimiento.toLowerCase()} programado para ${fechaCorta(m.fecha_programada)} · ${m.usuario}`,'open-mantenimiento',m.id_mantenimiento]);
 for(const e of d.equipos_en_mantenimiento)urgentes.push(['warning',`${e.asset_tag} lleva ${e.dias} días en mantenimiento`,[e.tipo_equipo,e.marca,e.modelo].filter(Boolean).join(' '),'open-ficha',e.asset_tag]);
 for(const n of d.novedades.slice(0,5))urgentes.push(['warning',`Novedad · ${n.asset_tag}`,`${n.descripcion_falla} · ${n.usuario}`,'open-mantenimiento',n.id_mantenimiento]);
 // Aviso previo: solicitudes que se cumplen en los próximos días.
 for(const j of d.jornadas_proximas||[])urgentes.push(['info',`Próximo · ${tituloSolicitud(j)}`,`${cuandoEs(j.fecha_programada)} (${fechaCorta(j.fecha_programada)}) · ${j.total} equipos · ${j.responsable}`,'open-jornada',j.id_jornada]);
 $('estado-mantenimiento').innerHTML=`${saludBarra(d.salud)}<div class="mini-metrics"><div><strong>${enCurso}</strong>Solicitudes en curso</div><div><strong>${d.novedades.length}</strong>Novedades abiertas</div><div><strong>${d.completados_mes}</strong>Completados este mes</div></div><div class="alert-list">${urgentes.length?urgentes.map(a=>alertaHtml(a)).join(''):'<div class="alert-item ok"><div><strong>Todo al día</strong><p>No hay servicios vencidos, novedades abiertas ni solicitudes en los próximos días.</p></div></div>'}</div>${d.novedades.length>5?`<p class="hint">Y ${d.novedades.length-5} novedad(es) más en Mantenimientos.</p>`:''}`;
 $('metric-mant-grupos').textContent=d.grupos_sin_programar.length;$('metric-mant-jornadas').textContent=enCurso;$('metric-mant-vencidas').textContent=d.jornadas_vencidas.length?`${d.jornadas_vencidas.length} vencida(s)`:'Ninguna vencida';$('metric-mant-novedades').textContent=d.novedades.length;$('metric-mant-mes').textContent=d.completados_mes;
 // Bloque plegable para que la tabla de solicitudes quede a la vista; conserva si se dejó abierto.
 const abierto=$('grupos-por-programar').querySelector('details')?.open??d.grupos_sin_programar.length<=4;
 $('grupos-por-programar').innerHTML=d.grupos_sin_programar.length?`<details class="por-programar-bloque"${abierto?' open':''}><summary class="por-programar-titulo">Grupos por programar (${d.grupos_sin_programar.length}) <small>· sin solicitud pendiente</small></summary><div class="por-programar">${d.grupos_sin_programar.map(g=>alertaHtml(['warning',`Grupo de ${g.lider}`,`${g.ultima_jornada?`Último: ${fechaCorta(g.ultima_jornada)}`:'Nunca se ha programado'} · ${g.equipos} equipos`,'program-grupo',g.id_lider],'Programar')).join('')}</div></details>`:''
}
['estado-mantenimiento','grupos-por-programar'].forEach(id=>$(id).addEventListener('click',event=>{const b=event.target.closest('button[data-action]');if(b)runAction(b.dataset.action,b.dataset.id)}));
document.querySelectorAll('[data-view-link]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.viewLink)));
// Acciones compartidas por tablas, alertas y modales (abrir ficha, jornada, etc.).
async function runAction(action,id){try{if(action==='open-ficha')await showFicha(id);if(action==='open-jornada')await showJornada(id);if(action==='edit-jornada')await editarJornadaUI(id);if(action==='anular-jornada')await anularJornadaUI(id);if(action==='open-mantenimiento')await editarMantenimientoUI(id);if(action==='program-grupo')await programarJornadaUI(id);if(action==='edit-grupo')await editGrupoUI(id);if(action==='estado-grupo')await showEstadoGrupo(id);if(action==='definir-cargo')await definirCargoUI(id);if(action==='reportar-novedad')reportarNovedadUI(id)}catch(error){notify(error.message,true)}}
// Las tarjetas del Resumen abren Equipos ya filtrado por estado.
document.querySelectorAll('[data-equipment-state]').forEach(button=>button.addEventListener('click',()=>{filtrosEquipos.estado=button.dataset.equipmentState;switchView('equipos')}));
// El catálogo de áreas cambia poco: se pide una vez y se invalida al crear o editar un área.
let areasCache=null;
async function getAreas(force=false){if(!areasCache||force)areasCache=await api('/activos/design/api/areas');return areasCache}
function areaOptions(areas){return areas.map(item=>({value:item.id_area,label:item.departamento?`${item.area} · ${item.departamento}`:item.area}))}
// Filtros de equipos: se envían al servidor junto con la búsqueda.
const filtrosEquipos={estado:'',area:'',departamento:'',tipo:'',dongle:''};
// Situación del dongle según la marca «Requiere ExoCAD» del departamento: [texto del filtro, celda de la tabla].
// El número del dongle es un botón que abre su detalle (serial y módulos) en una ventana pequeña.
const chipsDongle=(r,clase,extra='',titulo='Ver serial y módulos')=>String(r.dongle).split(', ').map(n=>`<button type="button" class="badge ${clase} dongle-chip" data-ver-dongle="${esc(n)}" title="${esc(titulo)}">${esc(n)}${extra}</button>`).join(' ');
const DONGLE={TIENE:['Lo tiene',r=>chipsDongle(r,'inuse')],FALTA:['Falta (lo requiere)',()=>'<span class="badge overdue" title="Su departamento requiere ExoCAD y el equipo no tiene dongle">⚠ Falta</span>'],SIN_REQUERIR:['Tiene sin requerirlo',r=>chipsDongle(r,'maintenance',' ?','Su departamento no requiere ExoCAD: verifica si el dongle debe estar aquí. Clic para ver serial y módulos.')],NO_APLICA:['No aplica',()=>'<span class="muted">—</span>']};
async function verDongleUI(numero){
 const d=(await api(`/activos/design/api/dongles?${new URLSearchParams({busqueda:numero})}`)).find(x=>x.numero_dongle===numero);
 if(!d)throw new Error(`No se encontró el dongle ${numero}.`);
 const dato=(label,valor)=>`<div><small>${label}</small><strong>${esc(valor||'—')}</strong></div>`;
 openModal(`Dongle ${d.numero_dongle}`,[`<div class="field full"><div class="acta-summary dongle-detalle">${dato('Serial físico',d.serial_number)}${dato('Versión ExoCAD',d.version_exocad_compatible)}${dato('Equipo',d.equipo)}${dato('Estado',d.estado_dongle)}</div></div>`,`<div class="field full"><small class="builder-label">Módulos</small><p class="dongle-modulos">${esc(d.modulos||'Sin módulos registrados')}</p></div>`],'Cerrar',async()=>{});
 document.querySelector('.modal-box').classList.add('modal-pequeno')
}
FILTROS['filtros-equipos']={titulo:'Filtrar equipos',estado:filtrosEquipos,aplicar:()=>loadEquipos(),
 conteo:()=>[equiposRows.length,Number($('nav-equipos').textContent)||equiposRows.length],
 alCambiar:clave=>{if(clave==='area')filtrosEquipos.departamento=''},
 campos:()=>{const areas=areasCache||[];return[
  {clave:'estado',label:'Estado',chips:true,opciones:[['','Todos'],['EN USO','En uso'],['STOCK','Stock'],['MANTENIMIENTO','Mantenimiento']]},
  {clave:'area',label:'Área',opciones:opcionesUnicas(areas.map(a=>a.area),'Todas las áreas')},
  {clave:'departamento',label:'Departamento',opciones:opcionesUnicas(areas.filter(a=>!filtrosEquipos.area||a.area===filtrosEquipos.area).map(a=>a.departamento),'Todos los departamentos')},
  {clave:'tipo',label:'Tipo',chips:true,opciones:[['','Todos'],['Laptop','Laptop'],['Mini PC','Mini PC']]},
  {clave:'dongle',label:'Dongle ExoCAD',opciones:[['','Todos'],...Object.entries(DONGLE).map(([k,[t]])=>[k,t])]}]}};
function equipmentFilters(){return new URLSearchParams({busqueda:$('buscar-equipos').value,...filtrosEquipos})}
async function loadEquipos(){const [rows]=await Promise.all([api(`/activos/design/api/equipos?${equipmentFilters()}`),getAreas()]);equiposRows=rows;equiposPage=1;renderEquipos();pintarFiltros('filtros-equipos')}
function equipmentActions(r){return `<button class="small-button" type="button" data-action="equipment-menu" data-tag="${esc(r.asset_tag)}" data-state="${esc(r.estado)}" data-assigned="${r.estado==='EN USO'&&r.usuario&&r.usuario!=='Sin asignar'}" aria-label="Acciones para equipo ${esc(r.asset_tag)}" aria-haspopup="menu">Acciones · ⋯</button>`}
function closeEquipmentMenu(){document.querySelector('.equipment-action-popover')?.remove()}
function toggleEquipmentMenu(anchor){
 const current=document.querySelector('.equipment-action-popover');
 if(current?.dataset.tag===anchor.dataset.tag){closeEquipmentMenu();return}
 closeEquipmentMenu();
 const tag=anchor.dataset.tag,maintenance=anchor.dataset.state==='MANTENIMIENTO',items=[
  ['open-ficha','Ver ficha completa'],
  ...(anchor.dataset.assigned==='true'?[['acta-equipo','Acta digital']]:[]),
  ['maintenance-equipo',maintenance?'Reingresar a stock':'Enviar a mantenimiento',maintenance?'STOCK':'MANTENIMIENTO'],
  ['assign-equipo','Asignar equipo'],
  ['edit-equipo','Editar equipo'],
  ['retire-equipo','Retirar equipo','',true]
 ];
 const menu=document.createElement('div');menu.className='equipment-action-popover';menu.setAttribute('role','menu');menu.dataset.tag=tag;
 menu.innerHTML=items.map(([action,label,state='',danger=false])=>`<button type="button" role="menuitem" data-action="${action}" data-tag="${esc(tag)}" ${state?`data-state="${state}"`:''} class="${danger?'danger':''}">${label}</button>`).join('');
 document.body.append(menu);
 const bounds=anchor.getBoundingClientRect(),menuBounds=menu.getBoundingClientRect(),left=Math.max(8,Math.min(bounds.right-menuBounds.width,window.innerWidth-menuBounds.width-8)),top=bounds.bottom+menuBounds.height>window.innerHeight?Math.max(8,bounds.top-menuBounds.height-4):bounds.bottom+4;
 menu.style.left=`${left}px`;menu.style.top=`${top}px`;
}
async function handleEquipmentAction(button){
 const tag=button.dataset.tag,action=button.dataset.action;
 if(action==='open-ficha')await showFicha(tag);
 if(action==='acta-equipo')await openDigitalActa(tag);
 if(action==='maintenance-equipo')changeEquipmentState(tag,button.dataset.state);
 if(action==='assign-equipo')await assignEquipment(tag);
 if(action==='edit-equipo')await editEquipment(tag);
 if(action==='retire-equipo')retireEquipment(tag)
}
function renderEquipos(){const total=equiposRows.length,pages=Math.max(1,Math.ceil(total/EQUIPOS_PAGE_SIZE));equiposPage=Math.min(equiposPage,pages);if(!total){setEmpty('tabla-equipos',9,'No hay equipos que coincidan con la búsqueda o los filtros.');$('equipos-paginacion').hidden=true;return}const start=(equiposPage-1)*EQUIPOS_PAGE_SIZE;const rows=equiposRows.slice(start,start+EQUIPOS_PAGE_SIZE);$('tabla-equipos').innerHTML=rows.map(r=>`<tr><td><button class="link-button" type="button" data-action="open-ficha" data-tag="${esc(r.asset_tag)}" title="Ver ficha del equipo">${esc(r.asset_tag)}</button></td><td>${esc(r.tipo_equipo)}</td><td>${esc([r.marca,r.modelo_referencia].filter(Boolean).join(' ')||'—')}</td><td>${esc(r.serial_number)}</td><td>${esc(r.usuario)}</td><td>${esc(r.departamento?`${r.area} / ${r.departamento}`:r.area)}</td><td>${(DONGLE[r.situacion_dongle]||DONGLE.NO_APLICA)[1](r)}</td><td>${badge(r.estado)}</td><td>${equipmentActions(r)}</td></tr>`).join('');const pagination=$('equipos-paginacion');pagination.hidden=total<=EQUIPOS_PAGE_SIZE;pagination.innerHTML=`<button class="secondary" data-page="-1" aria-label="Página anterior" ${equiposPage===1?'disabled':''}>‹<span class="pagination-texto"> Anterior</span></button><span class="pagination-info" aria-live="polite">Página <b>${equiposPage}</b> de ${pages}<small>${start+1}–${Math.min(start+EQUIPOS_PAGE_SIZE,total)} de ${total} equipos</small></span><button class="secondary" data-page="1" aria-label="Página siguiente" ${equiposPage===pages?'disabled':''}><span class="pagination-texto">Siguiente </span>›</button>`}
// Dongles, Usuarios y Retirados: la búsqueda va al servidor y los filtros se aplican aquí sobre lo recibido.
let donglesCache=[];const filtrosDongles={estado:'',version:''};
const donglesVisibles=()=>donglesCache.filter(d=>(!filtrosDongles.estado||d.estado_dongle===filtrosDongles.estado)&&(!filtrosDongles.version||String(d.version_exocad_compatible)===filtrosDongles.version));
FILTROS['filtros-dongles']={titulo:'Filtrar dongles',estado:filtrosDongles,aplicar:()=>renderDongles(),conteo:()=>[donglesVisibles().length,donglesCache.length],
 campos:()=>[{clave:'estado',label:'Estado',chips:true,opciones:[['','Todos'],['EN USO','En uso'],['DISPONIBLE','Disponible']]},{clave:'version',label:'Versión ExoCAD',opciones:opcionesUnicas(donglesCache.map(d=>d.version_exocad_compatible),'Todas las versiones')}]};
async function loadDongles(){const [rows,resumen]=await Promise.all([api(`/activos/design/api/dongles?${new URLSearchParams({busqueda:$('buscar-dongles').value})}`),api('/activos/design/api/resumen')]);donglesCache=rows;renderDongles();pintarAvisosDongles(resumen)}
// Cruce con Equipos: quién necesita dongle (su departamento «Requiere ExoCAD») y no lo tiene, y
// dongles en equipos que no lo requieren. «Ver equipos» abre Equipos con ese filtro.
function pintarAvisosDongles(r){const avisos=[];if(r.equipos_sin_dongle)avisos.push(['danger',`${r.equipos_sin_dongle} equipo(s) necesitan dongle y no lo tienen`,'Su departamento está marcado como «Requiere ExoCAD» en Áreas.','FALTA']);if(r.dongles_sin_requerir)avisos.push(['warning',`${r.dongles_sin_requerir} equipo(s) tienen dongle sin requerirlo`,'Revisa si el dongle debe seguir ahí o si el inventario está desactualizado.','SIN_REQUERIR']);$('dongles-avisos').innerHTML=avisos.map(([tipo,titulo,detalle,filtro])=>`<div class="alert-item ${tipo}"><div><strong>${esc(titulo)}</strong><p>${esc(detalle)}</p></div><button class="small-button" type="button" data-dongle-filtro="${filtro}">Ver equipos</button></div>`).join('')}
$('dongles-avisos').addEventListener('click',e=>{const b=e.target.closest('[data-dongle-filtro]');if(!b)return;Object.keys(filtrosEquipos).forEach(k=>filtrosEquipos[k]='');filtrosEquipos.dongle=b.dataset.dongleFiltro;$('buscar-equipos').value='';switchView('equipos')});
function renderDongles(){pintarFiltros('filtros-dongles');const rows=donglesVisibles();if(!rows.length)return setEmpty('tabla-dongles',7,'No hay dongles que coincidan con la búsqueda o los filtros.');$('tabla-dongles').innerHTML=rows.map(r=>`<tr><td><b>${esc(r.numero_dongle)}</b></td><td>${esc(r.serial_number||'—')}</td><td>${esc(r.version_exocad_compatible)}</td><td>${esc(r.modulos||'Sin registrar')}</td><td>${esc(r.equipo||'Sin asignar')}</td><td>${badge(r.estado_dongle)}</td><td><div class="dongle-actions"><button class="small-button" data-action="edit-dongle" data-number="${esc(r.numero_dongle)}">Editar</button><button class="small-button" data-action="assign-dongle" data-number="${esc(r.numero_dongle)}">Asignar</button><button class="small-button" data-action="history-dongle" data-number="${esc(r.numero_dongle)}">Historial</button></div></td></tr>`).join('')}
let usuariosCache=[];const filtrosUsuarios={grupo:'',area:'',departamento:'',equipos:''};
// «Sin grupo» = no reporta a un líder ni lidera un grupo: sirve para terminar de armar los grupos.
function usuariosVisibles(){
 const f=filtrosUsuarios,lideres=new Set(usuariosCache.filter(u=>u.id_lider).map(u=>String(u.id_lider)));
 return usuariosCache.filter(u=>{const enGrupo=Boolean(u.id_lider)||lideres.has(String(u.id_usuario));
  return (!f.area||u.area===f.area)&&(!f.departamento||u.departamento===f.departamento)
   &&(!f.grupo||(f.grupo==='__sin__'?!enGrupo:f.grupo==='__con__'?enGrupo:String(u.id_lider)===f.grupo||String(u.id_usuario)===f.grupo))
   &&(!f.equipos||(f.equipos==='con')===(u.equipos.length>0))})
}
FILTROS['filtros-usuarios']={titulo:'Filtrar usuarios',estado:filtrosUsuarios,aplicar:()=>renderUsuarios(),conteo:()=>[usuariosVisibles().length,usuariosCache.length],
 alCambiar:clave=>{if(clave==='area')filtrosUsuarios.departamento=''},
 campos:()=>{const lideres=new Map(usuariosCache.filter(u=>u.id_lider).map(u=>[String(u.id_lider),u.lider]));return[
  {clave:'grupo',label:'Grupo de trabajo',opciones:[['','Todos'],['__sin__','Sin grupo asignado'],['__con__','Con grupo'],...[...lideres].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,nombre])=>[id,`Grupo de ${nombre}`])]},
  {clave:'area',label:'Área',opciones:opcionesUnicas(usuariosCache.map(u=>u.area),'Todas las áreas')},
  {clave:'departamento',label:'Departamento',opciones:opcionesUnicas(usuariosCache.filter(u=>!filtrosUsuarios.area||u.area===filtrosUsuarios.area).map(u=>u.departamento),'Todos los departamentos')},
  {clave:'equipos',label:'Equipos asignados',chips:true,opciones:[['','Todos'],['con','Con equipo'],['sin','Sin equipo']]}]}};
async function loadUsuarios(){usuariosCache=await api(`/activos/design/api/usuarios?${new URLSearchParams({busqueda:$('buscar-usuarios').value})}`);renderUsuarios()}
function renderUsuarios(){pintarFiltros('filtros-usuarios');const rows=usuariosVisibles();if(!rows.length)return setEmpty('tabla-usuarios',8,'No hay usuarios que coincidan con la búsqueda o los filtros.');$('tabla-usuarios').innerHTML=rows.map(r=>`<tr><td><b>${esc(r.nombre_completo)}</b></td><td>${esc(r.jumpcloud_username||'—')}</td><td>${esc(r.cargo||'—')}</td><td>${esc(r.area)}</td><td>${esc(r.departamento||'—')}</td><td>${esc(r.lider||'—')}</td><td>${r.equipos.length?`<div class="tag-list">${r.equipos.map(tag=>`<button type="button" class="tag-chip" data-action="open-ficha" data-id="${esc(tag)}" title="Ver ficha del equipo">${esc(tag)}</button>`).join('')}</div>`:'—'}</td><td><div class="user-actions"><button class="small-button" data-action="user-assets" data-id="${esc(r.id_usuario)}">Ver activos</button><button class="small-button" data-action="edit-user" data-id="${esc(r.id_usuario)}">Editar</button><button class="small-button danger" data-action="retire-user" data-id="${esc(r.id_usuario)}" data-name="${esc(r.nombre_completo)}" data-equipos="${esc(r.equipos_asignados)}">Retirar</button></div></td></tr>`).join('')}
// Retirados tiene dos pestañas (equipos y usuarios) que comparten el buscador y el botón de filtros:
// los filtros que se muestran y aplican son los de la pestaña activa.
let retiradosCache=[],usuariosRetiradosCache=[],retiradosTab='equipos';const filtrosRetirados={tipo:'',anio:''},filtrosUsuariosRetirados={anio:'',area:''};
const retiradosVisibles=()=>retiradosCache.filter(r=>(!filtrosRetirados.tipo||r.tipo_equipo===filtrosRetirados.tipo)&&(!filtrosRetirados.anio||String(r.fecha_retiro||'').startsWith(filtrosRetirados.anio)));
const usuariosRetiradosVisibles=()=>usuariosRetiradosCache.filter(u=>(!filtrosUsuariosRetirados.anio||String(u.fecha_retiro||'').startsWith(filtrosUsuariosRetirados.anio))&&(!filtrosUsuariosRetirados.area||u.area===filtrosUsuariosRetirados.area));
const anios=lista=>opcionesUnicas(lista.map(r=>String(r.fecha_retiro||'').slice(0,4)),'Todos los años');
FILTROS['filtros-retirados']={titulo:'Filtrar retirados',get estado(){return retiradosTab==='usuarios'?filtrosUsuariosRetirados:filtrosRetirados},aplicar:()=>renderRetirados(),
 conteo:()=>retiradosTab==='usuarios'?[usuariosRetiradosVisibles().length,usuariosRetiradosCache.length]:[retiradosVisibles().length,retiradosCache.length],
 campos:()=>retiradosTab==='usuarios'?[{clave:'anio',label:'Año de retiro',opciones:anios(usuariosRetiradosCache)},{clave:'area',label:'Área',opciones:opcionesUnicas(usuariosRetiradosCache.map(u=>u.area),'Todas las áreas')}]
  :[{clave:'tipo',label:'Tipo',chips:true,opciones:[['','Todos'],['Laptop','Laptop'],['Mini PC','Mini PC']]},{clave:'anio',label:'Año de retiro',opciones:anios(retiradosCache)}]};
async function loadRetirados(){const q=new URLSearchParams({busqueda:$('buscar-retirados').value});[retiradosCache,usuariosRetiradosCache]=await Promise.all([api(`/activos/design/api/retirados?${q}`),api(`/activos/design/api/retirados/usuarios?${q}`).catch(()=>[])]);renderRetirados()}
document.querySelectorAll('[data-ret-tab]').forEach(boton=>boton.addEventListener('click',()=>{retiradosTab=boton.dataset.retTab;document.querySelectorAll('[data-ret-tab]').forEach(b=>{const activa=b===boton;b.classList.toggle('active',activa);b.setAttribute('aria-selected',String(activa))});$('ret-equipos').hidden=retiradosTab!=='equipos';$('ret-usuarios').hidden=retiradosTab!=='usuarios';$('buscar-retirados').placeholder=retiradosTab==='usuarios'?'Buscar persona, cargo, área o motivo':'Buscar activo retirado, serial o motivo';cerrarPaneles();renderRetirados()}));
function renderUsuariosRetirados(){const rows=usuariosRetiradosVisibles();if(!rows.length)return setEmpty('tabla-usuarios-retirados',6,usuariosRetiradosCache.length?'No hay usuarios retirados que coincidan con la búsqueda o los filtros.':'No hay usuarios retirados.');$('tabla-usuarios-retirados').innerHTML=rows.map(u=>`<tr><td><b>${esc(u.nombre_completo)}</b>${u.jumpcloud_username?`<br><small>${esc(u.jumpcloud_username)}</small>`:''}</td><td>${esc(u.cargo||'—')}</td><td>${esc(u.departamento?`${u.area} / ${u.departamento}`:u.area)}</td><td>${esc(fmtFecha(u.fecha_retiro)||'—')}</td><td>${esc(u.motivo_retiro)}</td><td><button class="small-button" type="button" data-action="reactivar-usuario" data-id="${u.id_usuario}" data-name="${esc(u.nombre_completo)}">Reactivar</button></td></tr>`).join('')}
function reactivarUsuarioUI(id,nombre){openModal(`Reactivar · ${nombre}`,[`<div class="field full"><p class="hint">${esc(nombre)} vuelve a «Usuarios activos» con su cargo y departamento. Regresa <b>sin grupo de trabajo y sin equipos</b>: asígnalos desde «Grupos de trabajo» y «Equipos». Su historial se conserva y el retiro anterior queda registrado en «Historial y respaldos».</p></div>`],'Reactivar',async()=>{const result=await api(`/activos/design/api/usuarios/${encodeURIComponent(id)}/reactivar`,{method:'POST'});notify(result.mensaje);await loadRetirados()})}
$('tabla-usuarios-retirados').addEventListener('click',e=>{const boton=e.target.closest('[data-action="reactivar-usuario"]');if(boton)reactivarUsuarioUI(boton.dataset.id,boton.dataset.name)});
function renderRetirados(){pintarFiltros('filtros-retirados');$('ret-conteo-equipos').textContent=retiradosCache.length;$('ret-conteo-usuarios').textContent=usuariosRetiradosCache.length;if(retiradosTab==='usuarios')return renderUsuariosRetirados();const rows=retiradosVisibles();if(!rows.length)return setEmpty('tabla-retirados',6,'No hay retirados que coincidan con la búsqueda o los filtros.');$('tabla-retirados').innerHTML=rows.map(r=>`<tr><td><button class="link-button" type="button" data-action="open-ficha" data-id="${esc(r.asset_tag)}">${esc(r.asset_tag)}</button></td><td>${esc(r.tipo_equipo)}</td><td>${esc([r.marca,r.modelo_referencia].filter(Boolean).join(' ')||'—')}</td><td>${esc(r.serial_number)}</td><td>${esc(fmtFecha(r.fecha_retiro)||'—')}</td><td>${esc(r.motivo_retiro)}</td></tr>`).join('')}
function fechaLocalISO(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function maintenanceStatus(status){const classes={PROGRAMADO:'stock',EN_PROCESO:'maintenance',COMPLETADO:'inuse',CANCELADO:'stock'};return `<span class="badge maintenance-status ${classes[status]||'stock'}">${esc(status.replace('_',' '))}</span>`}
async function loadMantenimientos(){
 const first=new Date(mantenimientoMes.getFullYear(),mantenimientoMes.getMonth(),1),last=new Date(mantenimientoMes.getFullYear(),mantenimientoMes.getMonth()+1,0);
 $('calendario-titulo').textContent=mantenimientoMes.toLocaleDateString('es-CO',{month:'long',year:'numeric'});
 const listParams=new URLSearchParams();for(const [key,id] of [['asset_tag','mant-filtro-equipo'],['estado','mant-filtro-estado'],['fecha_desde','mant-fecha-desde'],['fecha_hasta','mant-fecha-hasta']])if($(id).value)listParams.set(key,$(id).value);
 const monthParams=new URLSearchParams({fecha_desde:fechaLocalISO(first),fecha_hasta:fechaLocalISO(last)});
 const [list,calendar,jornadas]=await Promise.all([api(`/activos/design/api/mantenimientos?${listParams}`),api(`/activos/design/api/mantenimientos?${monthParams}`),api('/activos/design/api/jornadas')]);
 jornadasCache=jornadas;mantenimientosCalendario=calendar;renderJornadas();renderMantenimientos(list);renderCalendarioMantenimientos();await loadEstado()
}
// Lista agrupada: cada solicitud es un encabezado con sus equipos debajo; al final, los
// servicios individuales y novedades (registrados por equipo, fuera de una solicitud).
function renderMantenimientos(rows){
 if(!rows.length)return setEmpty('tabla-mantenimientos',7,'No hay servicios que coincidan con los filtros.');
 const solicitudes=new Map(jornadasCache.map(j=>[j.id_jornada,j])),grupos=new Map();
 for(const m of rows){const clave=m.id_jornada||'individual';if(!grupos.has(clave))grupos.set(clave,[]);grupos.get(clave).push(m)}
 const fila=m=>`<tr><td><button class="link-button" type="button" data-action="open-ficha" data-id="${esc(m.asset_tag)}">${esc(m.asset_tag)}</button></td><td>${esc(m.usuario)}</td><td>${m.id_jornada?'':`${esc(m.tipo_mantenimiento)}<br>`}<small>${esc(fechaCorta(m.fecha_programada))}</small></td><td>${m.id_jornada?'':`${esc(m.descripcion_falla)}<br>`}<small>${m.acciones_realizadas?`Trabajo: ${esc(m.acciones_realizadas)}`:'Sin trabajo registrado'}</small></td><td>${esc(m.fecha_realizada?fechaCorta(m.fecha_realizada):'—')}</td><td>${maintenanceStatus(m.estado_mantenimiento)}</td><td><button class="small-button" type="button" data-action="open-mantenimiento" data-id="${m.id_mantenimiento}">Editar</button></td></tr>`;
 const encabezado=(titulo,detalle,extra='')=>`<tr class="grupo-fila"><td colspan="7"><div class="grupo-fila-contenido"><div><strong>${titulo}</strong><small>${detalle}</small></div>${extra}</div></td></tr>`;
 let html='';
 for(const [clave,items] of grupos){
  if(clave==='individual')continue;
  const j=solicitudes.get(clave);
  html+=encabezado(esc(j?tituloSolicitud(j):`Solicitud #${clave}`),`Solicitud #${clave} · ${esc(fechaCorta(j?.fecha_programada||items[0].fecha_programada))} · ${esc(j?.responsable||items[0].responsable)}${j?.frecuencia_meses?` · ${esc(textoFrecuencia(j.frecuencia_meses))}`:''}`,`<div class="grupo-fila-estado">${j?`${avance(j)}${jornadaEstado(j.estado)}`:''}<button class="small-button" type="button" data-action="open-jornada" data-id="${clave}">Ver solicitud</button></div>`)+items.map(fila).join('');
 }
 if(grupos.has('individual'))html+=encabezado('Servicios individuales y novedades','Correctivos y servicios registrados por equipo, fuera de una solicitud.')+grupos.get('individual').map(fila).join('');
 $('tabla-mantenimientos').innerHTML=html
}
// Calendario: cada solicitud es un evento «Mantenimiento equipos · líder». Las que tienen
// frecuencia muestran además sus próximas fechas como «proyectadas» (se crean al cerrarse).
function renderCalendarioMantenimientos(){
 const year=mantenimientoMes.getFullYear(),month=mantenimientoMes.getMonth(),first=new Date(year,month,1),offset=(first.getDay()+6)%7,start=new Date(year,month,1-offset),today=fechaLocalISO(new Date()),byDay=new Map();
 const inicioMes=fechaLocalISO(first),finMes=fechaLocalISO(new Date(year,month+1,0)),eventos=[];
 for(const item of mantenimientosCalendario)if(!item.id_jornada)eventos.push({fecha:item.fecha_programada,accion:'open-mantenimiento',id:item.id_mantenimiento,estado:item.estado_mantenimiento,texto:`${item.asset_tag} · ${item.tipo_mantenimiento.toLowerCase()}`,titulo:item.descripcion_falla});
 for(const j of jornadasCache){
  if(j.estado==='ANULADA')continue;
  const hechos=j.completados+j.cancelados;
  if(j.fecha_programada>=inicioMes&&j.fecha_programada<=finMes)eventos.push({fecha:j.fecha_programada,accion:'open-jornada',id:j.id_jornada,estado:j.estado==='CERRADA'?'COMPLETADO':hechos?'EN_PROCESO':'PROGRAMADO',texto:tituloSolicitud(j,true),titulo:`Solicitud #${j.id_jornada} · ${j.lider} · ${hechos}/${j.total} equipos`});
  if(j.frecuencia_meses&&!j.id_jornada_siguiente&&['ABIERTA','VENCIDA'].includes(j.estado))for(let n=1;n<=60;n++){const fecha=sumarMeses(j.fecha_programada,j.frecuencia_meses*n);if(fecha>finMes)break;if(fecha>=inicioMes)eventos.push({fecha,accion:'open-jornada',id:j.id_jornada,estado:'PROYECTADO',texto:tituloSolicitud(j,true),titulo:`Proyectado (${textoFrecuencia(j.frecuencia_meses).toLowerCase()}): se programa solo al cerrar la solicitud #${j.id_jornada}`})}
 }
 for(const evento of eventos){if(!byDay.has(evento.fecha))byDay.set(evento.fecha,[]);byDay.get(evento.fecha).push(evento)}
 $('calendario-dias').innerHTML=Array.from({length:42},(_,index)=>{const day=new Date(start.getFullYear(),start.getMonth(),start.getDate()+index),key=fechaLocalISO(day),items=byDay.get(key)||[];return `<div class="calendar-day${day.getMonth()!==month?' outside':''}${key===today?' today':''}"><div class="calendar-day-number"><span>${day.getDate()}</span>${items.length?`<span>${items.length}</span>`:''}</div>${items.slice(0,3).map(evento=>`<button type="button" class="calendar-event status-${esc(evento.estado)}" data-action="${evento.accion}" data-id="${esc(evento.id)}" title="${esc(evento.titulo)}">${esc(evento.texto)}</button>`).join('')}${items.length>3?`<span class="calendar-more">+${items.length-3} más</span>`:''}</div>`}).join('')
}
function mantenimientoFields(data={},equipos=[],includeAsset=true){
 const fields=[guia('¿Qué significa cada estado?',['<b>Programado</b>: pendiente de hacer.','<b>En proceso</b>: se está trabajando. En un <b>correctivo</b>, el equipo se retira de su usuario y pasa a MANTENIMIENTO (queda en el historial).','<b>Completado</b>: terminado. Escribe el trabajo realizado y la fecha.','<b>Cancelado</b>: no se hará (por ejemplo, el equipo no estaba disponible).','El <b>preventivo</b> se hace en sitio: el equipo nunca deja a su usuario.'])];
 if(includeAsset){const options=equipos.map(item=>`<option value="${esc(item.asset_tag)}">${esc(`${item.asset_tag} · ${item.tipo_equipo} · ${item.marca||''} ${item.modelo_referencia||''}`)}</option>`).join('');fields.push(`<div class="field full"><label for="mant-asset-tag">Equipo (buscar por Asset Tag) *</label><input id="mant-asset-tag" name="asset_tag" list="mantenimiento-equipos" value="${esc(data.asset_tag||'')}" placeholder="Escribe el Asset Tag o modelo" required><datalist id="mantenimiento-equipos">${options}</datalist></div>`)}
 fields.push(field('tipo_mantenimiento','Tipo de mantenimiento','text',data.tipo_mantenimiento||'PREVENTIVO',true,[{value:'PREVENTIVO',label:'Preventivo'},{value:'CORRECTIVO',label:'Correctivo'}]));
 fields.push(field('estado_mantenimiento','Estado','text',data.estado_mantenimiento||'PROGRAMADO',true,[{value:'PROGRAMADO',label:'Programado'},{value:'EN_PROCESO',label:'En proceso'},{value:'COMPLETADO',label:'Completado'},{value:'CANCELADO',label:'Cancelado'}]));
 fields.push(field('fecha_programada','Fecha programada','date',data.fecha_programada||fechaLocalISO(new Date()),true));
 fields.push(field('fecha_realizada','Fecha realizada','date',data.fecha_realizada||''));
 fields.push(field('responsable','Responsable técnico','text',data.responsable||'',true,null,true));
 fields.push(field('descripcion_falla','Diagnóstico / motivo','textarea',data.descripcion_falla||'',true,null,true));
 fields.push(field('acciones_realizadas','Trabajo o acciones realizadas','textarea',data.acciones_realizadas||'',false,null,true));
 // Solo tiene sentido si un correctivo dejó el equipo en MANTENIMIENTO (sin usuario).
 if(!includeAsset&&data.estado_equipo==='MANTENIMIENTO')fields.push('<div class="field full devolver-stock"><label><input type="checkbox" name="devolver_stock"> Al completar la reparación, dejar el equipo disponible en STOCK</label><p class="hint">Este equipo está en MANTENIMIENTO y sin usuario porque un correctivo lo retiró. Márcalo si, ya reparado, debe quedar en STOCK para asignarlo a quien lo necesite. Si no lo marcas, sigue en MANTENIMIENTO hasta que lo asignes desde «Equipos».</p></div>');
 return fields
}
async function registrarMantenimientoUI(){
 const equipos=await api('/activos/design/api/equipos');
 openModal('Registrar mantenimiento',mantenimientoFields({},equipos),'Guardar mantenimiento',async form=>{
  const data=values(form);data.fecha_realizada=data.fecha_realizada||null;
  const result=await api('/activos/design/api/mantenimientos',{method:'POST',body:JSON.stringify(data)});
  notify(result.mensaje);await Promise.all([loadMantenimientos(),loadSummary()])
 })
}
async function editarMantenimientoUI(id){
 const item=await api(`/activos/design/api/mantenimientos/${encodeURIComponent(id)}`);
 openModal(`Actualizar mantenimiento · ${item.asset_tag}`,mantenimientoFields(item,[],false),'Guardar cambios',async form=>{
  const data=values(form);data.fecha_realizada=data.fecha_realizada||null;
  data.devolver_stock=Boolean(form.get('devolver_stock'));
  const result=await api(`/activos/design/api/mantenimientos/${id}`,{method:'PUT',body:JSON.stringify(data)});
  notify(result.mensaje);await Promise.all([refrescarMantenimiento(),loadSummary(),loadEquipos()])
 })
}
// Las tablas y el calendario delegan sus botones en runAction (ficha, jornada, editar servicio).
['tabla-mantenimientos','calendario-dias','tabla-retirados','tabla-jornadas','tabla-grupos'].forEach(id=>$(id).addEventListener('click',event=>{const button=event.target.closest('button[data-action]');if(button)runAction(button.dataset.action,button.dataset.id)}));
$('nuevo-mantenimiento').addEventListener('click',()=>registrarMantenimientoUI().catch(error=>notify(error.message,true)));
document.querySelectorAll('[data-maint-tab]').forEach(button=>button.addEventListener('click',()=>{const tab=button.dataset.maintTab;document.querySelectorAll('[data-maint-tab]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-selected',String(active))});document.querySelectorAll('.maintenance-pane').forEach(pane=>{const active=pane.id===`mant-${tab}`;pane.classList.toggle('active',active);pane.hidden=!active})}));
function cambiarMesMantenimiento(delta){mantenimientoMes=new Date(mantenimientoMes.getFullYear(),mantenimientoMes.getMonth()+delta,1);loadMantenimientos().catch(error=>notify(error.message,true))}
$('calendario-anterior').addEventListener('click',()=>cambiarMesMantenimiento(-1));$('calendario-siguiente').addEventListener('click',()=>cambiarMesMantenimiento(1));$('calendario-hoy').addEventListener('click',()=>{mantenimientoMes=new Date(new Date().getFullYear(),new Date().getMonth(),1);loadMantenimientos().catch(error=>notify(error.message,true))});
['mant-filtro-equipo','mant-filtro-estado','mant-fecha-desde','mant-fecha-hasta'].forEach(id=>$(id).addEventListener(id==='mant-filtro-equipo'?'input':'change',debounce(loadMantenimientos,200)));
$('mant-limpiar-filtros').addEventListener('click',()=>{['mant-filtro-equipo','mant-filtro-estado','mant-fecha-desde','mant-fecha-hasta'].forEach(id=>$(id).value='');loadMantenimientos().catch(error=>notify(error.message,true))});
function field(name,label,type='text',value='',required=false,options=null,full=false){let input=options?`<select name="${name}" ${required?'required':''}>${options.map(o=>`<option value="${esc(o.value)}" ${String(o.value)===String(value)?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`:type==='textarea'?`<textarea name="${name}" rows="3" ${required?'required':''}>${esc(value)}</textarea>`:`<input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''}>`;return `<div class="field${full?' full':''}"><label>${esc(label)}${required?' *':''}</label>${input}</div>`}
// Ventanas encadenadas: si una ventana que se puede reabrir (la que deja `volverModal`, como la
// solicitud o la ficha) abre otra, la anterior se guarda en una pila y «← Volver» regresa a ella,
// aunque se encadenen varias. Guardar en una ventana secundaria también regresa a la anterior.
// `cancelar` cambia el texto del botón secundario. Un clic fuera de la ventana no la cierra.
let pilaModal=[];
function openModal(title,fields,submitLabel,handler,{cancelar='Cancelar'}={}){if($('modal').classList.contains('show')&&volverModal)pilaModal.push(volverModal);const volver=pilaModal.length>0;$('modal-title').textContent=title;$('modal-fields').innerHTML=fields.join('');$('modal-form').reset();$('modal-guardar').textContent=submitLabel;$('modal-guardar').hidden=!submitLabel;$('modal-cancelar').textContent=volver?'← Volver':cancelar;$('modal-cancelar').classList.toggle('modal-cancel-hidden',submitLabel==='Cerrar'&&!volver);document.querySelector('.modal-box').classList.remove('acta-modal','group-modal','modal-pequeno');modalSubmit=handler;volverModal=null;$('modal').classList.add('show');document.querySelector('.modal-box').scrollTop=0}
function closeModal(){$('modal').classList.remove('show');document.querySelector('.modal-box').classList.remove('acta-modal','group-modal','modal-pequeno');modalSubmit=null;volverModal=null;pilaModal=[]}
// Reabre la ventana anterior de la pila; si no hay, simplemente cierra.
function regresarModal(){const anterior=pilaModal.pop(),resto=pilaModal;closeModal();if(anterior){pilaModal=resto;anterior().catch(error=>notify(error.message,true))}}
$('modal-cancelar').addEventListener('click',regresarModal);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('modal').classList.contains('show'))closeModal()});
// Guía desplegable dentro de una ventana: pasos cortos de qué hacer.
function guia(titulo,pasos){return `<div class="field full"><details class="guia"><summary>${esc(titulo)}</summary><ol>${pasos.map(p=>`<li>${p}</li>`).join('')}</ol></details></div>`}
$('modal-form').addEventListener('submit',async e=>{e.preventDefault();if(!modalSubmit)return;const button=$('modal-guardar');button.disabled=true;try{await modalSubmit(new FormData(e.currentTarget));if(button.textContent==='Cerrar')closeModal();else regresarModal()}catch(error){notify(error.message,true)}finally{button.disabled=false}});
function values(form){return Object.fromEntries(form.entries())}
function equipmentFields(data={},includeTag=true){const fields=[];if(includeTag)fields.push(field('asset_tag','Asset Tag', 'text',data.asset_tag||'',true));fields.push(field('tipo_equipo','Tipo','text',data.tipo_equipo||'Laptop',true,[{value:'Laptop',label:'Laptop'},{value:'Mini PC',label:'Mini PC'}]));fields.push(field('marca','Marca','text',data.marca||'',true));fields.push(field('modelo','Modelo','text',data.modelo_referencia||'',true));fields.push(field('serial_number','Serial','text',data.serial_number||'',true));fields.push(field('sistema_operativo','Sistema operativo','text',data.sistema_operativo||''));fields.push(field('procesador','Procesador','text',data.procesador||''));fields.push(field('memoria_ram','Memoria RAM','text',data.memoria_ram||''));fields.push(field('almacenamiento','Almacenamiento','text',data.almacenamiento||''));fields.push(field('observaciones','Observaciones','textarea',data.observaciones||'',false,null,true));return fields}
async function showFicha(tag){
 const f=await api(`/activos/design/api/equipos/${encodeURIComponent(tag)}/ficha`),e=f.equipo;
 const dato=(label,value)=>`<div><small>${esc(label)}</small><strong>${esc(value||'—')}</strong></div>`;
 const ubicacion=e.usuario?[e.area,e.departamento].filter(Boolean).join(' / '):'';
 const resumen=`<div class="field full"><div class="acta-summary">${dato('Estado',e.retirado?`RETIRADO · ${fmtFecha(e.fecha_retiro)}`:e.estado)}${e.retirado?'':dato('Mantenimiento',(SALUD[e.salud]||SALUD.SIN_REVISION)[0])}${dato('Tipo',e.tipo_equipo)}${dato('Marca / modelo',[e.marca,e.modelo_referencia].filter(Boolean).join(' '))}${dato('Serial',e.serial_number)}${dato('Sistema operativo',e.sistema_operativo)}${dato('Procesador',e.procesador)}${dato('Memoria RAM',e.memoria_ram)}${dato('Almacenamiento',e.almacenamiento)}${dato('Fecha de ingreso',fechaCorta(e.fecha_ingreso))}${dato('Usuario',e.usuario||'Sin asignar')}${dato('Área',ubicacion)}${dato('Grupo (líder)',e.lider||(e.integrantes_a_cargo?`Es el líder (${e.integrantes_a_cargo} a cargo)`:''))}${dato('Dongle ExoCAD',f.dongle?`${f.dongle.numero_dongle} · ${f.dongle.version_exocad_compatible}`:'')}${dato('JumpCloud',e.jumpcloud_username)}</div>${e.observaciones?`<p class="hint">Observaciones: ${esc(e.observaciones)}</p>`:''}${e.retirado?`<p class="hint">Motivo del retiro: ${esc(e.motivo_retiro||'—')}</p>`:''}</div>`;
 const mantenimientos=f.mantenimientos.length?`<table class="mini-table"><thead><tr><th>Programado</th><th>Tipo</th><th>Estado</th><th>Detalle</th><th></th></tr></thead><tbody>${f.mantenimientos.map(m=>`<tr><td>${esc(m.fecha_programada)}${m.fecha_realizada?`<br><small>Realizado ${esc(m.fecha_realizada)}</small>`:''}</td><td>${esc(m.tipo_mantenimiento)}</td><td>${maintenanceStatus(m.estado_mantenimiento)}</td><td>${esc(m.descripcion_falla)}${m.acciones_realizadas?`<br><small>${esc(m.acciones_realizadas)} · ${esc(m.responsable)}</small>`:''}</td><td><button class="small-button" type="button" data-action="open-mantenimiento" data-id="${m.id_mantenimiento}">Editar</button></td></tr>`).join('')}</tbody></table>`:'<div class="history-empty">Sin mantenimientos registrados.</div>';
 const historial=f.historial.length?`<ol class="timeline">${f.historial.map(h=>`<li class="timeline-item"><strong>${esc(h.usuario)}</strong><div class="timeline-date">${h.fecha_fin===h.fecha_inicio?esc(fmtFecha(h.fecha_inicio)):`${esc(fmtFecha(h.fecha_inicio))} – ${esc(h.fecha_fin?fmtFecha(h.fecha_fin):'Actualmente asignado')}`}</div><p>${esc(h.motivo||'Sin motivo registrado')}</p></li>`).join('')}</ol>`:'<div class="history-empty">Sin movimientos de asignación.</div>';
 const actas=f.actas.length?f.actas.map(a=>`<div class="history-entry"><strong>${esc(a.tipo_acta)} · ${esc(a.usuario)}</strong><p>${esc(fmtFecha(a.fecha))}${a.observaciones?` · ${esc(a.observaciones)}`:''}</p></div>`).join(''):'<div class="history-empty">Sin actas firmadas.</div>';
 openModal(`Ficha del equipo · ${e.asset_tag}`,[resumen,`<div class="field full ficha-section"><div class="team-toolbar"><h3>Mantenimientos (${f.mantenimientos.length})</h3>${e.retirado?'':`<button class="small-button" type="button" data-action="reportar-novedad" data-id="${esc(e.asset_tag)}">Reportar novedad</button>`}</div>${mantenimientos}</div>`,`<div class="field full ficha-section"><h3>Historial de asignaciones</h3>${historial}</div>`,`<div class="field full ficha-section"><h3>Actas digitales</h3>${actas}</div>`],'Cerrar',async()=>{});
 document.querySelector('.modal-box').classList.add('acta-modal');volverModal=()=>showFicha(tag)
}
$('nuevo-equipo').addEventListener('click',()=>openModal('Registrar equipo',equipmentFields(), 'Registrar',async form=>{await api('/activos/design/api/equipos',{method:'POST',body:JSON.stringify(values(form))});notify('Equipo registrado correctamente.');await loadEquipos()}));
async function editEquipment(tag){const d=await api(`/activos/design/api/equipos/${encodeURIComponent(tag)}`);const data={...d,modelo:d.modelo_referencia};openModal(`Editar equipo ${tag}`,equipmentFields(data), 'Guardar cambios',async form=>{await api(`/activos/design/api/equipos/${encodeURIComponent(tag)}`,{method:'PUT',body:JSON.stringify({...values(form),asset_tag:tag})});notify('Equipo actualizado correctamente.');await loadEquipos()})}
const OPCION_LIBERAR={valor:'LIBERAR',titulo:'Liberar',detalle:'Dejar sin asignar (STOCK o DISPONIBLE)',buscar:'liberar stock disponible sin asignar'};
async function assignEquipment(tag){const users=await api('/activos/design/api/usuarios');openModal(`Asignar equipo ${tag}`,[campoBuscador('id_usuario','Usuario'),field('motivo','Motivo del movimiento','textarea','',true,null,true)],'Guardar asignación',async form=>{const d=values(form);if(!d.id_usuario)throw new Error('Busca y elige el usuario, o «Liberar».');await api('/activos/design/api/equipos/asignar',{method:'POST',body:JSON.stringify({asset_tag:tag,id_usuario:d.id_usuario==='LIBERAR'?null:Number(d.id_usuario),motivo:d.motivo})});notify('Asignación de equipo guardada.');await loadEquipos()});montarBuscador('id_usuario',{placeholder:'Busca la persona por nombre, cargo o área (o escribe «liberar»)',opciones:()=>[OPCION_LIBERAR,...opcionesPersonas(users)]});$('modal-fields').querySelector('[data-buscador="id_usuario"] input').focus()}
function retireEquipment(tag){openModal(`Retirar equipo ${tag}`,[field('motivo','Motivo de retiro','textarea','',true,null,true)],'Confirmar retiro',async form=>{await api('/activos/design/api/equipos/retirar',{method:'POST',body:JSON.stringify({asset_tag:tag,...values(form)})});notify('Equipo retirado correctamente.');await loadEquipos()})}
async function editDongle(numero){
 const rows=await api(`/activos/design/api/dongles?${new URLSearchParams({busqueda:numero})}`),dongle=rows.find(row=>String(row.numero_dongle)===String(numero));
 if(!dongle)throw new Error(`No se encontró el dongle ${numero}.`);
 openModal(`Editar dongle #${numero}`,[field('serial_number','Serial físico','text',dongle.serial_number||'',true),field('version_exocad','Versión ExoCAD','text',dongle.version_exocad_compatible||'N/A'),field('modulos','Módulos','textarea',dongle.modulos||'',false,null,true)],'Guardar cambios',async form=>{
  await api(`/activos/design/api/dongles/${encodeURIComponent(numero)}`,{method:'PUT',body:JSON.stringify(values(form))});notify(`Dongle #${numero} actualizado.`);await loadDongles()
 })
}
async function editUser(id){
 const [user,areas,users]=await Promise.all([api(`/activos/design/api/usuarios/${id}`),getAreas(),api('/activos/design/api/usuarios')]);
 const options=areaOptions(areas);
 const fields=[
  `<div class="field full"><label>Empleado</label><p class="hint" style="margin:6px 0 0">${esc(user.nombre_completo)}${user.cargo?' — '+esc(user.cargo):''} (el nombre y el cargo se editan en People)</p></div>`,
  field('jumpcloud_username','Usuario JumpCloud','text',user.jumpcloud_username||''),
  field('id_area','Área / departamento','text',user.id_area??'',false,[{value:'',label:'Sin área'},...options]),
  campoBuscador('id_lider','Líder de grupo (a quién reporta; vacío = sin grupo)')
 ];
 openModal(`Editar usuario · ${user.nombre_completo}`,fields,'Guardar cambios',async form=>{
  const changes=values(form);changes.id_area=changes.id_area?Number(changes.id_area):null;changes.id_lider=changes.id_lider?Number(changes.id_lider):null;
  await api(`/activos/design/api/usuarios/${id}`,{method:'PUT',body:JSON.stringify(changes)});notify('Datos del usuario actualizados.');await loadUsuarios()
 });
 montarBuscador('id_lider',{valor:user.id_lider??'',placeholder:'Busca al líder por nombre, cargo o área',opciones:()=>opcionesPersonas(users,id)});
}
function changeEquipmentState(tag,state){const maintenance=state==='MANTENIMIENTO';const fields=maintenance?[`<div class="field full"><p class="hint">El equipo se liberará de la asignación actual para mantener coherencia con su estado. La asignación quedará registrada en el historial.</p></div>`,field('motivo','Nota breve del motivo de falla','textarea','',true,null,true)]:[field('motivo','Nota del movimiento','textarea','',false,null,true)];openModal(maintenance?`Enviar ${tag} a mantenimiento`:`Reingresar ${tag} a stock`,fields,maintenance?'Confirmar mantenimiento':'Reingresar a stock',async form=>{await api('/activos/design/api/equipos/mantenimiento',{method:'POST',body:JSON.stringify({asset_tag:tag,nuevo_estado:state,motivo:values(form).motivo||null})});notify(maintenance?'Equipo enviado a mantenimiento.':'Equipo reingresado a stock.');await Promise.all([loadEquipos(),loadSummary()])})}
async function prepareCanvas(){const canvas=$('firma-canvas'),ratio=window.devicePixelRatio||1,rect=canvas.getBoundingClientRect();canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);const context=canvas.getContext('2d');context.setTransform(ratio,0,0,ratio,0,0);context.fillStyle='#fff';context.fillRect(0,0,rect.width,rect.height);context.strokeStyle='#14213d';context.lineWidth=2.2;context.lineCap='round';context.lineJoin='round';let drawing=false;canvas.dataset.signed='false';const position=event=>{const bounds=canvas.getBoundingClientRect();return{x:event.clientX-bounds.left,y:event.clientY-bounds.top}};canvas.onpointerdown=event=>{event.preventDefault();drawing=true;canvas.setPointerCapture(event.pointerId);const p=position(event);context.beginPath();context.moveTo(p.x,p.y)};canvas.onpointermove=event=>{if(!drawing)return;event.preventDefault();const p=position(event);context.lineTo(p.x,p.y);context.stroke();canvas.dataset.signed='true'};const stop=event=>{if(!drawing)return;drawing=false;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId)};canvas.onpointerup=stop;canvas.onpointercancel=stop;$('limpiar-firma').onclick=()=>{context.clearRect(0,0,rect.width,rect.height);context.fillStyle='#fff';context.fillRect(0,0,rect.width,rect.height);canvas.dataset.signed='false'}}
async function openDigitalActa(tag){const d=await api(`/activos/design/api/equipos/${encodeURIComponent(tag)}/acta`);const dongle=d.dongle?`${d.dongle.numero_dongle} · ExoCAD ${d.dongle.version_exocad_compatible||'—'} · ${d.dongle.modulos||'módulos sin registrar'}`:'Sin licencia/dongle asociado';const fields=[`<div class="field full"><div class="acta-heading"><h3>Acta Digital de Responsabilidad de Activos</h3><p>Constancia digital de entrega de equipo y accesorios tecnológicos al colaborador abajo identificado.</p></div></div>`,`<div class="field full"><div class="acta-summary"><div><small>Asset Tag</small><strong>${esc(d.asset_tag)}</strong></div><div><small>Equipo</small><strong>${esc([d.marca,d.modelo].filter(Boolean).join(' ')||'—')}</strong></div><div><small>Serial</small><strong>${esc(d.serial_number)}</strong></div><div><small>Sistema operativo</small><strong>${esc(d.sistema_operativo||'—')}</strong></div><div><small>Colaborador</small><strong>${esc(d.usuario.nombre_completo)}</strong></div><div><small>Área</small><strong>${esc(d.usuario.area)}</strong></div><div><small>JumpCloud</small><strong>${esc(d.usuario.jumpcloud_username||'—')}</strong></div><div><small>Software / dongle asociado</small><strong>${esc(dongle)}</strong></div></div></div>`,`<div class="field full"><p class="acta-clause">Declaro recibir los activos indicados y me comprometo a custodiarlos, utilizarlos para fines laborales, proteger la información y reportar inmediatamente pérdidas, daños o fallas. Su devolución o reasignación deberá registrarse por los canales internos autorizados.</p></div>`,`<div class="field full"><label for="firma-canvas">Firma del colaborador</label><canvas class="signature-canvas" id="firma-canvas" aria-label="Área para dibujar la firma"></canvas><div class="signature-toolbar"><span class="acta-notice">La firma dibujada se archivará con la fecha y hora del servidor.</span><button class="secondary" type="button" id="limpiar-firma">Limpiar firma</button></div></div>`,field('observaciones','Observaciones','textarea','',false,null,true),`<div class="field full"><p class="acta-notice">Registro electrónico con firma dibujada; no constituye una firma electrónica certificada ni verifica por sí mismo la identidad del firmante.</p></div>`];openModal(`Acta Digital · ${tag}`,fields,'Firmar y archivar',async form=>{const canvas=$('firma-canvas');if(canvas.dataset.signed!=='true')throw new Error('Dibuja la firma del colaborador antes de archivar el acta.');const result=await api('/activos/design/api/actas/generar',{method:'POST',body:JSON.stringify({asset_tag:d.asset_tag,id_usuario:d.usuario.id_usuario,firma_base64:canvas.toDataURL('image/png'),observaciones:values(form).observaciones||null})});notify(`${result.mensaje} ${new Date(result.fecha).toLocaleString()}`)});document.querySelector('.modal-box').classList.add('acta-modal');await prepareCanvas()}
$('tabla-equipos').addEventListener('click',async event=>{const dongle=event.target.closest('[data-ver-dongle]');if(dongle){verDongleUI(dongle.dataset.verDongle).catch(error=>notify(error.message,true));return}const button=event.target.closest('button[data-action]');if(!button)return;if(button.dataset.action==='equipment-menu'){toggleEquipmentMenu(button);return}try{await handleEquipmentAction(button)}catch(error){notify(error.message,true)}});
document.addEventListener('click',async event=>{const button=event.target.closest('.equipment-action-popover button[data-action]');if(button){closeEquipmentMenu();try{await handleEquipmentAction(button)}catch(error){notify(error.message,true)}return}if(!event.target.closest('.equipment-action-popover')&&!event.target.closest('[data-action="equipment-menu"]'))closeEquipmentMenu()});
async function showUserAssets(id){const data=await api(`/activos/design/api/usuarios/${id}/activos`),user=data.usuario;const equipment=data.equipos.length?data.equipos.map(item=>`<article class="asset-card"><strong>${esc(item.tipo_equipo)} · ${esc(item.asset_tag)}</strong><p>${esc([item.marca,item.modelo].filter(Boolean).join(' ')||'Modelo no registrado')} · Serial ${esc(item.serial_number)} · ${esc(item.estado)}</p></article>`).join(''):'<div class="history-empty">No hay equipos asignados actualmente.</div>';const dongles=data.dongles.length?data.dongles.map(item=>`<article class="asset-card"><strong>Dongle ExoCAD · ${esc(item.numero_dongle)}</strong><p>${esc(item.version_exocad_compatible)} · ${esc(item.modulos||'Módulos sin registrar')} · Equipo ${esc(item.asset_tag_asignado)}</p></article>`).join(''):'<div class="history-empty">No hay dongles asignados a sus equipos.</div>';const fields=[`<div class="field full"><div class="acta-summary"><div><small>Colaborador</small><strong>${esc(user.nombre_completo)}</strong></div><div><small>Área</small><strong>${esc(user.area)}</strong></div><div><small>JumpCloud</small><strong>${esc(user.jumpcloud_username||'—')}</strong></div><div><small>Cargo</small><strong>${esc(user.cargo||'—')}</strong></div></div></div>`,`<div class="field full"><h3>Equipos a cargo (${data.equipos.length})</h3>${equipment}</div>`,...(user.mostrar_dongles?[`<div class="field full"><h3>Licencias y dongles (${data.dongles.length})</h3>${dongles}</div>`]:[]),`<div class="field full"><button type="button" class="secondary" data-action="user-actas" data-id="${esc(id)}" data-name="${esc(user.nombre_completo)}">Consultar actas digitales archivadas</button></div>`];openModal(`Activos a cargo · ${user.nombre_completo}`,fields,'Cerrar',async()=>{})}
async function showUserActas(id,name){const records=await api(`/activos/design/api/usuarios/${id}/actas`);const content=records.length?records.map(record=>`<article><strong>${esc(record.tipo_acta)} · ${esc(record.asset_tag)}</strong><p>${esc([record.tipo_equipo,record.marca,record.modelo].filter(Boolean).join(' '))} · Serial ${esc(record.serial_number)}</p><p>${esc(new Date(record.fecha).toLocaleString())}${record.observaciones?` · ${esc(record.observaciones)}`:''}</p><img src="/activos/design/api/actas/${encodeURIComponent(record.id_acta)}/firma" loading="lazy" alt="Firma archivada en acta ${esc(record.id_acta)}"></article>`).join(''):'<div class="history-empty">Este colaborador aún no tiene actas digitales archivadas.</div>';openModal(`Actas digitales · ${name}`,[`<div class="field full"><div class="acta-archive">${content}</div><button type="button" class="secondary" data-action="user-assets" data-id="${esc(id)}" style="margin-top:12px">Volver a activos a cargo</button></div>`],'Cerrar',async()=>{})}
$('tabla-usuarios').addEventListener('click',async event=>{const button=event.target.closest('button[data-action]');if(!button)return;try{if(button.dataset.action==='user-assets')await showUserAssets(button.dataset.id);else if(button.dataset.action==='edit-user')await editUser(button.dataset.id);else if(button.dataset.action==='retire-user')retireUser(button.dataset.id,button.dataset.name,Number(button.dataset.equipos));else runAction(button.dataset.action,button.dataset.id)}catch(error){notify(error.message,true)}});
function userFields(areas,empleados){return[field('empleado_id','Empleado (de People)','text','',true,[{value:'',label:'Elige un empleado…'},...empleados.map(e=>({value:e.id_usuario,label:`${e.nombre_completo}${e.cargo?' — '+e.cargo:''}`}))],true),field('jumpcloud_username','Usuario JumpCloud','text',''),field('id_area','Área / departamento','text','',false,[{value:'',label:'Sin área'},...areaOptions(areas)],true)]}
async function registerUser(){const [areas,empleados]=await Promise.all([getAreas(),api('/activos/design/api/empleados-disponibles')]);if(!empleados.length){notify('No hay empleados de Design disponibles para registrar (ya están todos en Activos, o no tienen la empresa Nuvia Design en People).',true);return}openModal('Registrar usuario',userFields(areas,empleados),'Registrar',async form=>{const data=values(form);data.empleado_id=Number(data.empleado_id);data.id_area=data.id_area?Number(data.id_area):null;const result=await api('/activos/design/api/usuarios',{method:'POST',body:JSON.stringify(data)});notify(result.mensaje);await loadUsuarios()})}
function retireUser(id,name,equipos){const fields=equipos>0?[`<div class="field full"><p class="hint">${esc(name)} tiene ${esc(equipos)} equipo(s) asignado(s). Libéralos o reasígnalos antes de retirar al usuario.</p></div>`]:[`<div class="field full"><p class="hint">${esc(name)} dejará de aparecer entre los usuarios activos y no podrá recibir nuevas asignaciones. Su historial se conserva.</p></div>`,field('motivo','Motivo del retiro','text','',true,[{value:'',label:'Selecciona un motivo'},{value:'Renunció',label:'Renunció'},{value:'Retirado por la empresa',label:'Retirado por la empresa'},{value:'Fin de contrato',label:'Fin de contrato'},{value:'Otro',label:'Otro'}],true),field('detalle','Detalle (obligatorio si eliges «Otro»)','textarea','',false,null,true)];openModal(`Retirar usuario · ${name}`,fields,equipos>0?'Cerrar':'Confirmar retiro',equipos>0?async()=>{}:async form=>{const data=values(form);const motivo=data.motivo==='Otro'?(data.detalle||'').trim():[data.motivo,(data.detalle||'').trim()].filter(Boolean).join(' · ');if(!motivo)throw new Error('Especifica el motivo del retiro.');const result=await api(`/activos/design/api/usuarios/${encodeURIComponent(id)}/retirar`,{method:'POST',body:JSON.stringify({motivo})});notify(result.mensaje);await loadUsuarios()})}
$('nuevo-usuario').addEventListener('click',()=>registerUser().catch(error=>notify(error.message,true)));
async function loadAreasView(){const term=$('buscar-areas').value.trim().toLowerCase(),areas=await getAreas(true);const rows=areas.filter(a=>!term||`${a.area} ${a.departamento||''}`.toLowerCase().includes(term));if(!rows.length)return setEmpty('tabla-areas',6);$('tabla-areas').innerHTML=rows.map(a=>`<tr><td>${a.departamento?esc(a.area):`<b>${esc(a.area)}</b>`}</td><td>${esc(a.departamento||(a.departamentos?`${a.departamentos} departamento(s)`:'Área independiente'))}</td><td>${a.aplica_software_diseno?'Sí':'No'}</td><td>${a.requiere_exocad?'Sí':'No'}</td><td>${esc(a.usuarios_registrados)}</td><td><div class="actions"><button class="small-button" data-action="edit-area" data-id="${esc(a.id_area)}">Editar</button>${!a.usuarios_registrados&&!a.departamentos?`<button class="small-button danger-button" data-action="delete-area" data-id="${esc(a.id_area)}" data-name="${esc(a.nombre_area)}">Eliminar</button>`:''}</div></td></tr>`).join('')}
function areaFields(area,areas){const parents=areas.filter(a=>!a.id_area_padre&&a.id_area!==area?.id_area);const canHaveParent=!area||!area.departamentos;const checkbox=(name,label,checked)=>`<div class="field"><label><input type="checkbox" name="${name}" ${checked?'checked':''}> ${esc(label)}</label></div>`;return[field('nombre_area','Nombre','text',area?.nombre_area||'',true,null,true),canHaveParent?field('id_area_padre','Área principal (vacío = área principal o independiente)','text',area?.id_area_padre??'',false,[{value:'',label:'— Ninguna —'},...parents.map(a=>({value:a.id_area,label:a.nombre_area}))],true):'<div class="field full"><p class="hint">Esta área tiene departamentos, por eso no puede quedar dentro de otra.</p></div>',checkbox('aplica_software_diseno','Aplica software de diseño',area?.aplica_software_diseno),checkbox('requiere_exocad','Requiere ExoCAD',area?.requiere_exocad)]}
function areaPayload(form){const data=values(form);return{nombre_area:data.nombre_area,id_area_padre:data.id_area_padre?Number(data.id_area_padre):null,aplica_software_diseno:Boolean(data.aplica_software_diseno),requiere_exocad:Boolean(data.requiere_exocad)}}
async function registerArea(){const areas=await getAreas(true);openModal('Registrar área o departamento',areaFields(null,areas),'Registrar',async form=>{const result=await api('/activos/design/api/areas',{method:'POST',body:JSON.stringify(areaPayload(form))});notify(result.mensaje);await loadAreasView()})}
async function editArea(id){const areas=await getAreas(true),area=areas.find(a=>String(a.id_area)===String(id));if(!area)throw new Error('No se encontró el área seleccionada.');openModal(`Editar área · ${area.nombre_area}`,areaFields(area,areas),'Guardar cambios',async form=>{const result=await api(`/activos/design/api/areas/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(areaPayload(form))});notify(result.mensaje);await loadAreasView()})}
$('nueva-area').addEventListener('click',()=>registerArea().catch(error=>notify(error.message,true)));
// Solo se ofrece en áreas sin usuarios activos ni departamentos; el servidor revisa además los retirados.
function deleteArea(id,nombre){openModal(`Eliminar · ${nombre}`,[`<div class="field full"><p class="hint">«${esc(nombre)}» no tiene usuarios ni departamentos. Al eliminarlo deja de aparecer en el catálogo y en las listas para elegir área. Úsalo para depurar entradas que no son áreas reales, como cargos que en el Excel original se registraron como departamentos. Queda un punto de restauración en «Historial y respaldos».</p></div>`],'Eliminar',async()=>{const result=await api(`/activos/design/api/areas/${encodeURIComponent(id)}`,{method:'DELETE'});notify(result.mensaje);await loadAreasView()})}
$('tabla-areas').addEventListener('click',event=>{const button=event.target.closest('button[data-action]');if(!button)return;if(button.dataset.action==='edit-area')editArea(button.dataset.id).catch(error=>notify(error.message,true));if(button.dataset.action==='delete-area')deleteArea(button.dataset.id,button.dataset.name)});
async function loadRespaldos(){const rows=await api('/activos/design/api/respaldos');if(!rows.length)return setEmpty('tabla-respaldos',5,'Aún no hay operaciones registradas.');$('tabla-respaldos').innerHTML=rows.map(r=>`<tr><td>${esc(r.id_cambio)}</td><td>${esc(fmtFecha(r.fecha))}</td><td>${esc(r.accion)}</td><td>${esc(r.descripcion)}</td><td>${r.restaurable?`<button class="small-button danger" data-action="restore" data-id="${esc(r.id_cambio)}" data-label="${esc(r.accion)}">Restaurar</button>`:'<span class="hint">Sin copia</span>'}</td></tr>`).join('')}
function confirmRestore(id,label){openModal(`Restaurar operación #${id}`,[`<div class="field full"><p class="hint">La base completa volverá al estado previo a «${esc(label)}» (operación #${esc(id)}). Se perderán los cambios hechos después de ese momento. Antes de restaurar se guarda una copia del estado actual, por lo que esta acción también se puede deshacer.</p></div>`],'Restaurar',async()=>{const result=await api(`/activos/design/api/respaldos/${encodeURIComponent(id)}/restaurar`,{method:'POST'});notify(result.mensaje);areasCache=null;await Promise.all([loadRespaldos(),loadSummary()])})}
$('tabla-respaldos').addEventListener('click',event=>{const button=event.target.closest('button[data-action="restore"]');if(button)confirmRestore(button.dataset.id,button.dataset.label)});
$('recargar-respaldos').addEventListener('click',()=>loadRespaldos().catch(error=>notify(error.message,true)));
$('modal-fields').addEventListener('click',async event=>{const button=event.target.closest('button[data-action]');if(!button)return;const action=button.dataset.action;if(action==='marcar-grupo')event.preventDefault();try{if(action==='user-actas')await showUserActas(button.dataset.id,button.dataset.name);else if(action==='user-assets')await showUserAssets(button.dataset.id);else if(action==='marcar-todos')$('modal-fields').querySelectorAll(`input[name="${button.dataset.campo}"]`).forEach(box=>{if(!box.closest('label')?.hidden)box.checked=button.dataset.valor==='1'});else if(action==='marcar-grupo')button.closest('[data-grupo-bloque]')?.querySelectorAll('input[type=checkbox]').forEach(box=>{if(!box.closest('label')?.hidden)box.checked=button.dataset.valor==='1'});else runAction(action,button.dataset.id||button.dataset.tag)}catch(error){notify(error.message,true)}});

// ---------------------------------------------------------------------------
// Grupos de trabajo y jornadas de mantenimiento
// ---------------------------------------------------------------------------
let gruposCache=[];
async function loadGrupos(){gruposCache=await api('/activos/design/api/grupos');renderGrupos()}
function detalleSalud(c){const partes=[[c.EN_MANTENIMIENTO,'en mantenimiento'],[c.NOVEDADES,'con novedades'],[c.SIN_REVISION,'sin revisión'],[c.OPTIMO,'óptimos']].filter(([n])=>n).map(([n,t])=>`${n} ${t}`);return partes.join(' · ')}
// Orden y filtros de la tabla de grupos (se aplican en el navegador sobre gruposCache).
const ordenGrupos={campo:'lider',dir:1},filtrosGrupos={cargo:'',estado:'',ultimo:''};
const PRIORIDAD_SALUD={EN_MANTENIMIENTO:0,NOVEDADES:1,SIN_REVISION:2,OPTIMO:3};
const FILTRO_ULTIMO={'':'Cualquiera',nunca:'Nunca','3m':'En los últimos 3 meses','mas3':'Hace más de 3 meses','mas6':'Hace más de 6 meses'};
function cumpleUltimo(fecha,regla){if(!regla)return true;if(regla==='nunca')return !fecha;if(!fecha)return false;const hace=m=>sumarMeses(fechaLocalISO(new Date()),-m);return regla==='3m'?fecha>=hace(3):regla==='mas3'?fecha<hace(3):fecha<hace(6)}
function gruposVisibles(){
 const term=normalizar($('buscar-grupos').value.trim()),{campo,dir}=ordenGrupos;
 const valor=g=>campo==='estado'?PRIORIDAD_SALUD[saludGrupo(g.salud)]:campo==='cargo'?normalizar(g.cargo||'￿'):campo==='lider'?normalizar(g.lider):campo==='ultima_jornada'?(g.ultima_jornada||''):g[campo];
 return gruposCache.filter(g=>(!term||normalizar(`${g.lider} ${g.cargo||''} ${g.area} ${g.departamento||''}`).includes(term))
   &&(!filtrosGrupos.cargo||(filtrosGrupos.cargo==='__sin__'?!g.cargo:g.cargo===filtrosGrupos.cargo))
   &&(!filtrosGrupos.estado||saludGrupo(g.salud)===filtrosGrupos.estado)
   &&cumpleUltimo(g.ultima_jornada,filtrosGrupos.ultimo))
  .sort((a,b)=>{const x=valor(a),y=valor(b);return (x<y?-1:x>y?1:normalizar(a.lider).localeCompare(normalizar(b.lider)))*dir})
}
FILTROS['filtros-grupos']={titulo:'Filtrar grupos',estado:filtrosGrupos,aplicar:()=>renderGrupos(),conteo:()=>[gruposVisibles().length,gruposCache.length],
 campos:()=>[{clave:'cargo',label:'Cargo del líder',opciones:[['','Todos'],['__sin__','Sin cargo definido'],...opcionesUnicas(gruposCache.map(g=>g.cargo),'').slice(1)]},
  {clave:'estado',label:'Estado de equipos',chips:true,opciones:[['','Todos'],...Object.entries(SALUD).map(([k,[t]])=>[k,t])]},
  {clave:'ultimo',label:'Último mantenimiento',opciones:Object.entries(FILTRO_ULTIMO)}]};
$('orden-grupos').addEventListener('click',e=>{const boton=e.target.closest('[data-orden]');if(!boton)return;const campo=boton.dataset.orden;ordenGrupos.dir=ordenGrupos.campo===campo?-ordenGrupos.dir:1;ordenGrupos.campo=campo;renderGrupos()});
function renderGrupos(){pintarFiltros('filtros-grupos');document.querySelectorAll('#orden-grupos [data-orden]').forEach(b=>{if(b.dataset.orden===ordenGrupos.campo)b.dataset.dir=ordenGrupos.dir;else delete b.dataset.dir});const rows=gruposVisibles();if(!rows.length)return setEmpty('tabla-grupos',7,gruposCache.length?'No hay grupos que coincidan con la búsqueda o los filtros.':'Aún no hay grupos. Usa «Crear grupo» para definir el primero.');$('tabla-grupos').innerHTML=rows.map(g=>`<tr><td><b>${esc(g.lider)}</b></td><td>${g.cargo?`<button class="link-button" type="button" data-action="definir-cargo" data-id="${g.id_lider}" title="Cambiar cargo">${esc(g.cargo)}</button>`:`<button class="small-button" type="button" data-action="definir-cargo" data-id="${g.id_lider}">＋ Definir cargo</button>`}</td><td>${esc(g.integrantes)}</td><td>${esc(g.equipos)}</td><td>${esc(fechaCorta(g.ultima_jornada))}</td><td><div class="salud-cell">${saludBadge(saludGrupo(g.salud))}<span>${esc(detalleSalud(g.salud))}</span></div></td><td><div class="actions"><button class="small-button" data-action="edit-grupo" data-id="${g.id_lider}">Integrantes</button><button class="small-button" data-action="estado-grupo" data-id="${g.id_lider}">Ver estado</button></div></td></tr>`).join('')}
async function showEstadoGrupo(id){
 const g=await api(`/activos/design/api/grupos/${encodeURIComponent(id)}`);
 const equipos=g.equipos.length?`<table class="mini-table"><thead><tr><th>Equipo</th><th>Usuario</th><th>Último mantenimiento</th><th>Estado</th><th></th></tr></thead><tbody>${g.equipos.map(e=>`<tr><td><button class="link-button" type="button" data-action="open-ficha" data-id="${esc(e.asset_tag)}">${esc(e.asset_tag)}</button><br><small>${esc([e.tipo_equipo,e.marca,e.modelo].filter(Boolean).join(' '))}</small></td><td>${esc(e.usuario)}${String(e.id_usuario)===String(id)?' <small>(líder)</small>':''}</td><td>${esc(e.ultimo_mantenimiento?fechaCorta(e.ultimo_mantenimiento):'—')}</td><td>${saludBadge(e.salud)}</td><td><button class="small-button" type="button" data-action="reportar-novedad" data-id="${esc(e.asset_tag)}">Reportar novedad</button></td></tr>`).join('')}</tbody></table>`:'<div class="history-empty">El grupo no tiene equipos asignados.</div>';
 const guia=g.novedades.length?g.novedades.map(n=>`<div class="history-entry"><strong>${esc(n.asset_tag)} · ${esc(fechaCorta(n.fecha_programada))} ${maintenanceStatus(n.estado_mantenimiento)}</strong><p>Problema: ${esc(n.descripcion_falla)}</p>${n.acciones_realizadas?`<p>Solución: ${esc(n.acciones_realizadas)}${n.fecha_realizada?` (${esc(fechaCorta(n.fecha_realizada))})`:''}</p>`:''}</div>`).join(''):'<div class="history-empty">Sin novedades registradas: los equipos de este grupo no han presentado problemas.</div>';
 openModal(`Estado de equipos · grupo de ${g.lider.nombre_completo}`,[`<div class="field full">${saludBarra(g.salud)}</div>`,`<div class="field full ficha-section"><h3>Equipos del grupo (${g.equipos.length})</h3>${equipos}</div>`,`<div class="field full ficha-section"><h3>Guía de novedades</h3><p class="hint">Problemas reportados en los equipos actuales del grupo y cómo se resolvieron. El estado sigue al equipo si cambia de diseñador.</p><div class="history-list">${guia}</div></div>`],'Cerrar',async()=>{});
 document.querySelector('.modal-box').classList.add('acta-modal');volverModal=()=>showEstadoGrupo(id)
}
async function definirCargoUI(id){
 const users=await api('/activos/design/api/usuarios'),persona=users.find(u=>String(u.id_usuario)===String(id));
 if(!persona)throw new Error('No se encontró el usuario.');
 const cargos=[...new Set(users.map(u=>u.cargo).filter(Boolean))].sort();
 openModal(`Cargo · ${persona.nombre_completo}`,[`<div class="field full"><label for="cargo-lider">Cargo</label><input id="cargo-lider" name="cargo" list="cargos-existentes" value="${esc(persona.cargo||'')}" placeholder="Ej.: Team Leader, Supervisor N2" required><datalist id="cargos-existentes">${cargos.map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div>`],'Guardar cargo',async form=>{await api(`/activos/design/api/usuarios/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({cargo:form.get('cargo')})});notify('Cargo actualizado.');await loadGrupos()});
 $('cargo-lider').focus()
}
// Una novedad es un correctivo pendiente: deja el equipo en «Novedades a revisar» hasta completarlo.
function reportarNovedadUI(tag){
 openModal(`Reportar novedad · ${tag}`,['<div class="field full"><p class="hint">Registra el problema encontrado. Queda como mantenimiento correctivo pendiente y el equipo pasa a «Novedades a revisar» hasta que se complete con la solución aplicada.</p></div>',field('descripcion_falla','Problema encontrado','textarea','',true,null,true),field('responsable','Responsable técnico','text','',true),field('fecha_programada','Fecha para atenderla','date',fechaLocalISO(new Date()),true)],'Reportar novedad',async form=>{const d=values(form);await api('/activos/design/api/mantenimientos',{method:'POST',body:JSON.stringify({asset_tag:tag,tipo_mantenimiento:'CORRECTIVO',estado_mantenimiento:'PROGRAMADO',fecha_programada:d.fecha_programada,descripcion_falla:d.descripcion_falla,responsable:d.responsable})});notify(`Novedad registrada para ${tag}.`);await refrescarMantenimiento()})
}
// Lista de casillas con «Marcar todos»; con `placeholder` agrega un buscador para listas largas.
function checkList(name,items,placeholder=''){return `<div class="field full"><div class="toolbar" style="margin:0">${placeholder?`<input class="search" data-filtro-lista="${name}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">`:''}<button type="button" class="secondary" data-action="marcar-todos" data-campo="${name}" data-valor="1">Marcar todos</button><button type="button" class="secondary" data-action="marcar-todos" data-campo="${name}" data-valor="0">Ninguno</button></div><div class="check-list" id="lista-${name}">${items}</div></div>`}
$('modal-fields').addEventListener('input',event=>{const filtro=event.target.closest('[data-filtro-lista]');if(!filtro)return;const term=filtro.value.trim().toLowerCase();$(`lista-${filtro.dataset.filtroLista}`).querySelectorAll('label').forEach(label=>{label.hidden=Boolean(term)&&!label.textContent.toLowerCase().includes(term)})});
// Como checkList, pero organizada por grupo de trabajo (bloques con encabezado y «Marcar grupo» /
// «Ninguno» propios) -- para listas largas de equipos sueltos de varios grupos a la vez.
// `grupos`: [{titulo, items: [{valor, html}]}].
// Cada grupo es un <details> (se puede colapsar/expandir, pedido por Oscar el 27-oct-2026) --
// abierto por defecto, igual que antes.
function checkListGrupos(name,grupos,placeholder=''){
 const bloques=grupos.map((g,i)=>{
  const idg=`${name}-${i}`;
  const labels=g.items.map(it=>`<label><input type="checkbox" name="${name}" value="${esc(it.valor)}"> <span>${it.html}</span></label>`).join('');
  return `<details class="check-list-grupo" data-grupo-bloque="${idg}" open><summary class="check-list-grupo-header"><span class="check-list-grupo-flecha" aria-hidden="true">▸</span><b>${esc(g.titulo)}</b><span>(${g.items.length})</span><span class="check-list-grupo-acciones"><button type="button" class="link-button" data-action="marcar-grupo" data-grupo="${idg}" data-valor="1">Marcar grupo</button><button type="button" class="link-button" data-action="marcar-grupo" data-grupo="${idg}" data-valor="0">Ninguno</button></span></summary>${labels}</details>`
 }).join('');
 return `<div class="field full"><div class="toolbar" style="margin:0">${placeholder?`<input class="search" data-filtro-lista-grupos="${name}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">`:''}<button type="button" class="secondary" data-action="marcar-todos" data-campo="${name}" data-valor="1">Marcar todos</button><button type="button" class="secondary" data-action="marcar-todos" data-campo="${name}" data-valor="0">Ninguno</button></div><div class="check-list" id="lista-${name}">${bloques}</div></div>`
}
$('modal-fields').addEventListener('input',event=>{const filtro=event.target.closest('[data-filtro-lista-grupos]');if(!filtro)return;const term=filtro.value.trim().toLowerCase();const lista=$(`lista-${filtro.dataset.filtroListaGrupos}`);lista.querySelectorAll('label').forEach(label=>{label.hidden=Boolean(term)&&!label.textContent.toLowerCase().includes(term)});lista.querySelectorAll('[data-grupo-bloque]').forEach(bloque=>{const visibles=[...bloque.querySelectorAll('label')].some(l=>!l.hidden);bloque.hidden=Boolean(term)&&!visibles;if(term&&visibles)bloque.open=true})});
// ---------------------------------------------------------------------------
// Personajes pixel art estilo chibi (20x30) para los grupos de trabajo. Se dibujan con figuras
// simples sobre una cuadrícula de letras (cada letra es un color, '.' es transparente) y el
// contorno oscuro se agrega solo. Los brazos son cuadros aparte para animar las acciones.
// La misma persona recibe siempre el mismo personaje porque todo se elige a partir de su id.
// ---------------------------------------------------------------------------
const PJ_W=20,PJ_H=30;
const PJ_PIEL=['#ffdcb5','#f5c59c','#e5ab83','#c98d62','#a46a43','#7b4a2c'];
const PJ_PELO=['#2b1d14','#4a2f22','#7a4a2c','#b6782f','#e2c27a','#1f2937','#9a3b24','#5b5f6b'];
const PJ_ROPA=['#2563eb','#16a34a','#db2777','#7c3aed','#ea580c','#0891b2','#ca8a04','#475569','#e11d48','#0f766e'];
const PJ_ACENTO=['#ef4444','#f59e0b','#22c55e','#3b82f6','#a855f7','#ec4899','#14b8a6'];
const PJ_ACCIONES=['cafe','portatil','dibujo'];
function pjTono(hex,f){const n=parseInt(hex.slice(1),16),c=[n>>16,(n>>8)&255,n&255].map(v=>Math.round(f<0?v*(1+f):v+(255-v)*f));return '#'+c.map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('')}
// Mezcla el id para que usuarios con ids consecutivos no salgan parecidos.
function pjMezclar(v){let h=Math.imul((Number(v)||0)^0x9e3779b9,0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);h^=h>>>16;return h>>>0}
const pjLienzo=()=>Array.from({length:PJ_H},()=>Array(PJ_W).fill('.'));
function pjPunto(g,x,y,c){if(y>=0&&y<PJ_H&&x>=0&&x<PJ_W)g[y][x]=c}
function pjRect(g,x,y,w,h,c){for(let j=0;j<h;j++)for(let i=0;i<w;i++)pjPunto(g,x+i,y+j,c)}
function pjElipse(g,cx,cy,rx,ry,c,filtro=()=>true){for(let y=0;y<PJ_H;y++)for(let x=0;x<PJ_W;x++){const dx=(x+.5-cx)/rx,dy=(y+.5-cy)/ry;if(dx*dx+dy*dy<=1&&filtro(x,y))pjPunto(g,x,y,c)}}
// Pinta píxeles escritos como [x, y, 'texto'] ('.' no pinta).
function pjTexto(g,lista){for(const [x,y,t] of lista)[...t].forEach((c,i)=>{if(c!=='.')pjPunto(g,x+i,y,c)})}
// Contorno automático: todo píxel vacío vecino de uno pintado pasa a ser contorno ('q' = vapor, sin contorno).
function pjContorno(g){const r=g.map(f=>[...f]);for(let y=0;y<PJ_H;y++)for(let x=0;x<PJ_W;x++){if(g[y][x]!=='.')continue;for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){const v=g[y+b]?.[x+a];if(v&&v!=='.'&&v!=='q'){r[y][x]='o';break}}}return r}
function pjSvg(g,colores){let s='';g.forEach((fila,y)=>{let x=0;while(x<PJ_W){const c=fila[x];if(c==='.'||!colores[c]){x++;continue}let fin=x;while(fin+1<PJ_W&&fila[fin+1]===c)fin++;s+=`<rect x="${x}" y="${y}" width="${fin-x+1.02}" height="1.02" fill="${colores[c]}"/>`;x=fin+1}});return s}
const PJ_CABEZA={cx:10,cy:8.6,rx:6.6,ry:6.5};
function pjDentroCabeza(x,y,m=0){const dx=(x+.5-PJ_CABEZA.cx)/(PJ_CABEZA.rx+m),dy=(y+.5-PJ_CABEZA.cy)/(PJ_CABEZA.ry+m);return dx*dx+dy*dy<=1}
function pjCuerpo(g,ropa){
 pjRect(g,6,16,8,1,'b');pjRect(g,5,17,10,7,'b');pjRect(g,13,17,2,7,'B');pjRect(g,5,23,10,1,'B'); // torso con sombra
 pjRect(g,8,15,4,2,'S'); // cuello
 if(ropa==='camisa')pjTexto(g,[[7,16,'ww..ww'],[9,16,'tt'],[9,17,'TT'],[9,18,'tt'],[9,19,'tt'],[9,20,'tt'],[9,21,'.T']]);
 if(ropa==='buzo'){pjRect(g,6,15,8,1,'B');pjTexto(g,[[8,17,'W..W'],[8,18,'W..W'],[8,19,'W..W'],[7,21,'BBBBBB']])}
 if(ropa==='camiseta')pjTexto(g,[[8,16,'SSSS'],[9,17,'SS']]);
 pjRect(g,6,24,3,3,'p');pjRect(g,11,24,3,3,'p');pjRect(g,6,24,8,1,'p');pjPunto(g,8,26,'P');pjPunto(g,11,26,'P'); // piernas
 pjRect(g,5,27,4,2,'k');pjRect(g,11,27,4,2,'k');pjPunto(g,6,27,'K');pjPunto(g,12,27,'K'); // zapatos
}
function pjCara(g,sexo){
 pjElipse(g,PJ_CABEZA.cx,PJ_CABEZA.cy,PJ_CABEZA.rx,PJ_CABEZA.ry,'s');
 pjPunto(g,3,9,'s');pjPunto(g,16,9,'s'); // orejas
 for(let x=4;x<16;x++)if(pjDentroCabeza(x,14)&&!pjDentroCabeza(x,15))pjPunto(g,x,14,'S'); // sombra del mentón
 pjTexto(g,[[6,8,'ew'],[6,9,'ee'],[6,10,'ee'],[12,8,'ew'],[12,9,'ee'],[12,10,'ee']]); // ojos grandes con brillo
 if(sexo==='F')pjTexto(g,[[5,8,'e'],[14,8,'e'],[5,11,'rr'],[13,11,'rr']]); // pestañas y rubor
 pjTexto(g,[[9,12,'mm']]);
}
function pjCasco(g,hasta){pjElipse(g,10,7.4,7.2,6.6,'h',(x,y)=>y<=hasta)}
// Cada peinado tiene una parte de atrás (detrás del cuerpo) y una de adelante (sobre la cara).
const PJ_PEINADOS={
 corto:{frente:g=>{pjCasco(g,6);pjTexto(g,[[4,7,'hhhhh..hhhhhhh'],[3,8,'hh'],[15,8,'hh'],[3,9,'h'],[16,9,'h'],[6,3,'HHH']])}},
 peinado:{frente:g=>{pjCasco(g,6);pjTexto(g,[[4,7,'hhhhhhhh'],[3,8,'hhhh'],[3,9,'h'],[16,8,'h'],[11,2,'HHH'],[12,3,'HH']])}},
 rapado:{frente:g=>{pjElipse(g,10,7.6,6.8,6.4,'D',(x,y)=>y<=5);pjTexto(g,[[6,2,'H.H.H'],[5,4,'.H.H.H.H']])}},
 rizado:{frente:g=>{pjCasco(g,6);for(const [cx,cy] of [[4,5],[6.5,2.5],[10,1.8],[13.5,2.5],[16,5],[3.6,8],[16.4,8]])pjElipse(g,cx,cy,1.9,1.9,'h');pjTexto(g,[[5,7,'h.hh.hh.hh.h'],[7,2,'H'],[11,1,'HH'],[14,3,'H']])}},
 largo:{atras:g=>{pjRect(g,3,8,14,13,'h');pjRect(g,4,21,12,1,'h');pjRect(g,3,15,2,6,'D');pjRect(g,15,15,2,6,'D')},frente:g=>{pjCasco(g,6);pjTexto(g,[[4,7,'hhhh....hhhhh'],[3,8,'hh'],[15,8,'hh'],[3,9,'hh'],[15,9,'hh'],[3,10,'h'],[16,10,'h'],[6,3,'HHH']])}},
 coleta:{atras:g=>{pjElipse(g,17.6,10.5,2,4.2,'h');pjPunto(g,18,12,'D');pjPunto(g,18,13,'D')},frente:g=>{pjCasco(g,6);pjTexto(g,[[4,7,'hhhhhh.hhhhhh'],[3,8,'hh'],[15,8,'hh'],[16,5,'cc'],[6,3,'HHH']])}},
 mono:{frente:g=>{pjElipse(g,10,2,2.6,2.2,'h');pjCasco(g,6);pjTexto(g,[[5,7,'hhh....hhhh'],[3,8,'hh'],[15,8,'hh'],[9,1,'H'],[7,4,'cccccc']])}},
 melena:{atras:g=>{pjRect(g,3,8,14,6,'h')},frente:g=>{pjCasco(g,6);pjRect(g,4,7,12,1,'h');pjTexto(g,[[3,8,'hh'],[15,8,'hh'],[2,9,'hhh'],[15,9,'hhh'],[2,10,'hhh'],[15,10,'hhh'],[2,11,'hhh'],[15,11,'hhh'],[2,12,'hhh'],[15,12,'hhh'],[3,13,'DD'],[15,13,'DD'],[6,3,'HHHH']])}}
};
const PJ_ACCESORIOS={
 gafas:g=>pjTexto(g,[[5,7,'GGGG..GGGG'],[5,8,'G..G..G..G'],[5,9,'G..GGGG..G'],[5,10,'G..G..G..G'],[5,11,'GGGG..GGGG']]),
 audifonos:g=>{for(let x=3;x<17;x++)for(let y=0;y<4;y++)if(!pjDentroCabeza(x,y,.6)&&pjDentroCabeza(x,y,1.5))pjPunto(g,x,y,'c');pjRect(g,1,7,2,4,'c');pjRect(g,17,7,2,4,'c');pjRect(g,1,8,1,2,'C');pjRect(g,18,8,1,2,'C')},
 gorra:g=>{pjElipse(g,10,7.2,7.3,6.4,'c',(x,y)=>y<=5);pjRect(g,3,6,15,1,'C');pjRect(g,13,5,6,2,'C');pjTexto(g,[[9,1,'CC'],[6,3,'d']])},
 lazo:g=>pjTexto(g,[[13,1,'c...c'],[13,2,'ccCcc'],[13,3,'c...c']]),
 barba:g=>{for(let x=3;x<17;x++)for(let y=11;y<16;y++)if(pjDentroCabeza(x,y)&&(y>=13||x<=5||x>=14))pjPunto(g,x,y,'h');pjTexto(g,[[8,11,'hhhh'],[9,12,'mm']])},
 bigote:g=>pjTexto(g,[[8,11,'hhhh']]),
 corona:g=>pjTexto(g,[[6,0,'y..yy..y'],[6,1,'yYyyyyYy'],[6,2,'YYYYYYYY']])
};
// Brazos y objetos: cada cuadro se dibuja en su propio lienzo con su contorno, encima del cuerpo.
const PJ_BRAZOS={
 reposo:[[3,17,'bb'],[3,18,'bb'],[3,19,'bb'],[3,20,'BB'],[3,21,'ss'],[3,22,'ss'],[15,17,'bb'],[15,18,'bb'],[15,19,'bb'],[15,20,'BB'],[15,21,'ss'],[15,22,'ss']],
 // Café: taza en el pecho (c1) y en la boca (c2).
 c1:[[3,17,'bb'],[3,18,'bb'],[3,19,'bb'],[3,20,'BB'],[3,21,'ss'],[3,22,'ss'],[15,17,'bb'],[15,18,'bb'],[13,19,'bbbB'],[12,18,'ss'],[12,19,'ss'],[11,15,'uuuu'],[11,16,'uUuuu'],[11,17,'uUuu.u'],[11,16,'.....u'],[11,18,'uuuu']],
 c2:[[3,17,'bb'],[3,18,'bb'],[3,19,'bb'],[3,20,'BB'],[3,21,'ss'],[3,22,'ss'],[15,17,'bb'],[15,16,'bb'],[14,15,'bb'],[13,13,'ss'],[13,14,'ss'],[9,11,'uuuu'],[9,12,'uUuu'],[9,13,'uUuu'],[9,14,'uuuu']],
 // Portátil: tapa vista por detrás; las manos asoman alternadas sobre el borde al teclear.
 t1:[[3,17,'bb'],[4,18,'b'],[15,17,'bb'],[15,18,'b'],[4,19,'llllllllllll'],[4,20,'llllllllllll'],[4,21,'llllllllllll'],[4,22,'lllllLLlllll'],[4,23,'lllllLLlllll'],[4,24,'llllllllllll'],[3,25,'KKKKKKKKKKKKKK'],[5,18,'ss'],[12,19,'ss']],
 t2:[[3,17,'bb'],[4,18,'b'],[15,17,'bb'],[15,18,'b'],[4,19,'llllllllllll'],[4,20,'llllllllllll'],[4,21,'llllllllllll'],[4,22,'lllllLLlllll'],[4,23,'lllllLLlllll'],[4,24,'llllllllllll'],[3,25,'KKKKKKKKKKKKKK'],[5,19,'ss'],[12,18,'ss']],
 // Dibujo: la mano izquierda sostiene la hoja y la derecha mueve el lápiz.
 d1:[[3,17,'bb'],[3,18,'bb'],[4,19,'ss'],[5,18,'wwwwwwww'],[5,19,'wwwwwwww'],[5,20,'wwwwwwww'],[5,21,'wwwwwwww'],[5,22,'wwwwwwww'],[5,23,'wwwwwwww'],[15,17,'bb'],[15,18,'bb'],[14,19,'bB'],[12,19,'ss'],[12,17,'y'],[12,18,'Y']],
 d2:[[3,17,'bb'],[3,18,'bb'],[4,19,'ss'],[5,18,'wwwwwwww'],[5,19,'wvvvwwww'],[5,20,'wwwwwwww'],[5,21,'wwwwwwww'],[5,22,'wwwwwwww'],[5,23,'wwwwwwww'],[15,17,'bb'],[15,18,'bb'],[13,19,'bbB'],[9,19,'ss'],[9,17,'y'],[9,18,'Y']],
 d3:[[3,17,'bb'],[3,18,'bb'],[4,19,'ss'],[5,18,'wwwwwwww'],[5,19,'wvvvvvww'],[5,20,'wwwwwwww'],[5,21,'wwwwwwww'],[5,22,'wwwwwwww'],[5,23,'wwwwwwww'],[15,17,'bb'],[15,18,'bb'],[15,19,'bB'],[12,21,'ss'],[12,19,'y'],[12,20,'Y']],
 d4:[[3,17,'bb'],[3,18,'bb'],[4,19,'ss'],[5,18,'wwwwwwww'],[5,19,'wvvvvvww'],[5,20,'wwwwwwww'],[5,21,'wrrrwwww'],[5,22,'wwwwwwww'],[5,23,'wwwwwwww'],[15,17,'bb'],[15,18,'bb'],[13,19,'bbB'],[9,21,'ss'],[9,19,'y'],[9,20,'Y']]
};
// Secuencia de cada acción dentro de un ciclo de 12 s: [inicio %, fin %, cuadro]. Fuera de ella, reposo.
const PJ_GUIONES={
 cafe:[[58,63,'c1'],[63,70,'c2'],[70,75,'c1'],[75,82,'c2'],[82,88,'c1']],
 portatil:[[58,61,'t1'],[61,64,'t2'],[64,67,'t1'],[67,70,'t2'],[70,73,'t1'],[73,76,'t2'],[76,79,'t1'],[79,82,'t2'],[82,85,'t1'],[85,88,'t2']],
 dibujo:[[58,64,'d1'],[64,70,'d2'],[70,76,'d3'],[76,82,'d4'],[82,88,'d4']]
};
// Genera una sola vez las animaciones CSS de cada cuadro a partir de los guiones.
function pjEstilos(){
 if(document.getElementById('pj-estilos'))return;
 let css='';
 for(const [accion,guion] of Object.entries(PJ_GUIONES)){
  for(const c of new Set(guion.map(g=>g[2]))){let k='0%{opacity:0}';for(const [a,b] of guion.filter(g=>g[2]===c))k+=`${a}%{opacity:1}${b}%{opacity:0}`;css+=`@keyframes pj-${accion}-${c}{${k}100%{opacity:0}}`}
  css+=`@keyframes pj-${accion}-reposo{0%{opacity:1}${guion[0][0]}%{opacity:0}${guion[guion.length-1][1]}%{opacity:1}100%{opacity:1}}`;
 }
 const estilo=document.createElement('style');estilo.id='pj-estilos';estilo.textContent=css;document.head.append(estilo);
}
const pjCache=new Map();
/**
 * Dibuja el personaje de una persona. `sexo`: 'M', 'F' o '' (neutro).
 * `accion`: '' sin animación, 'auto' (según la persona) o 'cafe' | 'portatil' | 'dibujo'.
 * Las acciones y el parpadeo solo se animan dentro de un contenedor con la clase pj-animado,
 * que solo usa la ventana de grupos de trabajo; en el resto de la plataforma el personaje es estático.
 */
function pixelPersonaje(semilla,{sexo='',lider=false,fantasma=false,accion='',variante=0,piel=null}={}){
 const clave=`${semilla}|${sexo}|${lider}|${fantasma}|${accion}|${variante}|${piel}`;
 if(!pjCache.has(clave))pjCache.set(clave,dibujarPersonaje(semilla,sexo,lider,fantasma,accion,variante,piel));
 return pjCache.get(clave)
}
// `variante` > 0 da otra versión del personaje (peinado, ropa, colores); `tonoPiel` fija el tono (índice de PJ_PIEL).
function dibujarPersonaje(semilla,sexo,lider,fantasma,accion,variante,tonoPiel){
 const n=variante?pjMezclar(pjMezclar(semilla)+variante*7919):pjMezclar(semilla),elegir=(lista,bits)=>lista[(n>>>bits)%lista.length];
 const peinado=sexo==='F'?elegir(['largo','coleta','mono','melena'],3):sexo==='M'?elegir(['corto','peinado','rapado','rizado'],3):elegir(['corto','melena','rizado'],3);
 const ropa=elegir(['camiseta','camisa','buzo','camiseta','buzo'],7);
 let accesorio=elegir(['','','gafas','audifonos','gorra',sexo==='F'?'lazo':'gafas'],15);
 if(accesorio==='gorra'&&['mono','coleta','rizado'].includes(peinado))accesorio='gafas';
 const g=pjLienzo();
 PJ_PEINADOS[peinado].atras?.(g);
 pjCuerpo(g,ropa);pjCara(g,sexo);
 if(sexo==='M'){const v=(n>>>11)%10;if(v<2)PJ_ACCESORIOS.barba(g);else if(v<4)PJ_ACCESORIOS.bigote(g)}
 PJ_PEINADOS[peinado].frente(g);
 if(accesorio)PJ_ACCESORIOS[accesorio](g);
 if(lider)PJ_ACCESORIOS.corona(g);
 const piel=PJ_PIEL[tonoPiel]??elegir(PJ_PIEL,19),pelo=elegir(PJ_PELO,22),camisa=elegir(PJ_ROPA,25),acento=elegir(PJ_ACENTO,28);
 const colores=fantasma?new Proxy({},{get:()=>'#a9b6c6'}):{
  o:'#1c2230',e:'#1c2230',w:'#ffffff',s:piel,S:pjTono(piel,-.14),m:sexo==='F'?'#d9466f':'#a3483a',r:'#f4a0a0',
  h:pelo,H:pjTono(pelo,.3),D:pjTono(pelo,-.25),d:pjTono(acento,.5),b:camisa,B:pjTono(camisa,-.22),W:pjTono(camisa,.5),
  p:'#3b4a63',P:'#28334a',k:'#1e293b',K:'#475569',y:'#f5b301',Y:'#c98a00',G:'#1c2230',c:acento,C:pjTono(acento,-.25),
  t:acento,T:pjTono(acento,-.25),u:'#dc2626',U:'#f87171',l:'#cbd5e1',L:'#94a3b8',v:'#2563eb',q:'#cbd5e1'};
 const cuadro=lista=>{const lienzo=pjLienzo();pjTexto(lienzo,lista);return pjSvg(pjContorno(lienzo),colores)};
 let svg=pjSvg(pjContorno(g),colores);
 // Párpados: se cierran un instante cada pocos segundos.
 if(!fantasma){const p=pjLienzo();pjRect(p,6,8,2,3,'s');pjRect(p,12,8,2,3,'s');pjRect(p,6,9,2,1,'e');pjRect(p,12,9,2,1,'e');svg+=`<g class="pj-parpado">${pjSvg(p,colores)}</g>`}
 const tipo=!fantasma&&accion?(accion==='auto'?PJ_ACCIONES[(n>>>9)%PJ_ACCIONES.length]:accion):'';
 if(tipo){
  pjEstilos();
  svg+=`<g class="pj-cuadro" style="animation-name:pj-${tipo}-reposo">${cuadro(PJ_BRAZOS.reposo)}</g>`;
  svg+=[...new Set(PJ_GUIONES[tipo].map(c=>c[2]))].map(c=>`<g class="pj-cuadro" style="animation-name:pj-${tipo}-${c};opacity:0">${cuadro(PJ_BRAZOS[c])}${c==='c1'?`<g class="pj-vapor">${cuadro([[12,13,'q'],[13,12,'q'],[12,11,'q']])}</g>`:''}</g>`).join('');
 }else svg+=cuadro(PJ_BRAZOS.reposo);
 return `<svg class="pj" viewBox="0 0 ${PJ_W} ${PJ_H}" shape-rendering="crispEdges" aria-hidden="true" style="--retraso:${-((n>>>4)%12000)/1000}s;--parpadeo:${-((n>>>6)%5000)/1000}s">${svg}</svg>`
}
// Sexo sugerido del personaje según el primer nombre; se corrige en «Editar usuario».
const NOMBRES_F=new Set('isabel raquel carmen mercedes pilar rosario consuelo socorro leidy lady leydi yuly yuli nicole michelle ingrid ruth esther abigail belen ines luz sol beatriz lourdes dolores noemi nohemi jennifer jenifer yenifer katherine katherin kathy karen allison alison evelyn madeleine nathaly nataly natalie shirley sirley darly yaneth janeth lizeth liseth yamile jazmin yasmin yazmin marisol maribel mabel elizabeth yuliet julieth juliet lisbeth mayerly sharon astrid ivonne yvonne gisel giselle rocio zoe ivette sindy cindy mary nancy heidy deisy daisy yuri yury ruby edith maite rachel emily angie ashley yurany yurani mileidy kelly lucy betty'.split(' '));
const NOMBRES_M=new Set('carlos andres ivan luis samuel jose juan david daniel miguel jorge oscar javier manuel rafael gabriel angel felipe sebastian nicolas julian cristian christian cristhian kevin brayan brian bryan jhon john jhonatan jonathan jhonathan wilson edwin jaime esteban matias tomas martin joel abel isaac ismael josue raul saul ruben hernan german adrian fabian damian elkin victor hector nestor edgar omar cesar alexander alex steven stiven jeison yeison harold wilmer wilmar wilber freddy fredy eduar eduard edward richard william jean duvan yesid jesus nelson ronald elias andrey emmanuel enrique felix leonel moises reinaldo yostyn rosember jair yair jefferson yeferson anderson dairon deiby michael maicol brandon dilan dylan joshua luca isaias didier jhonny johnny'.split(' '));
function sexoPorNombre(nombre){
 const primero=normalizar(nombre).trim().split(/\s+/)[0]||'';
 if(NOMBRES_F.has(primero))return 'F';
 if(NOMBRES_M.has(primero))return 'M';
 return primero.endsWith('a')?'F':primero.endsWith('o')?'M':''
}
// Personaje elegido en la ficha del usuario (M, F, N) o, si no hay, el sugerido por el nombre.
function sexoDe(persona){if(!persona)return '';if(persona.personaje)return persona.personaje==='N'?'':persona.personaje;return sexoPorNombre(persona.nombre_completo??persona.lider)}
// Opciones de dibujo guardadas en la ficha del usuario: sexo, versión y tono de piel.
function pjDe(persona){return{sexo:sexoDe(persona),variante:Number(persona?.personaje_variante)||0,piel:persona?.personaje_piel??null}}
function normalizar(texto){return String(texto||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()}
// Buscador con lista desplegable y teclado (flechas, Enter, Escape).
function crearSelector(contenedor,{placeholder,opciones,alElegir}){
 contenedor.innerHTML=`<input class="picker-input" type="search" placeholder="${esc(placeholder)}" autocomplete="off" aria-label="${esc(placeholder)}"><div class="picker-results" role="listbox" hidden></div>`;
 const input=contenedor.querySelector('input'),lista=contenedor.querySelector('.picker-results');let resultados=[],indice=0;
 const marcar=()=>lista.querySelectorAll('.picker-option').forEach((b,i)=>b.classList.toggle('active',i===indice));
 // Las opciones deshabilitadas (por ejemplo, quien ya está en el grupo) se muestran al final y no se pueden elegir.
 const pintar=()=>{const termino=normalizar(input.value);resultados=opciones().filter(o=>!termino||normalizar(o.buscar).includes(termino)).sort((a,b)=>Boolean(a.deshabilitada)-Boolean(b.deshabilitada)).slice(0,8);indice=0;lista.hidden=false;lista.innerHTML=resultados.length?resultados.map((o,i)=>`<button type="button" class="picker-option" role="option" data-i="${i}"${o.deshabilitada?' disabled aria-disabled="true"':''}><span>${esc(o.titulo)}<br><small>${esc(o.detalle)}</small></span>${o.etiqueta?`<span class="avatar-tag">${esc(o.etiqueta)}</span>`:''}</button>`).join(''):'<div class="picker-empty">No hay personas que coincidan.</div>';marcar();ubicarLista(input,lista)};
 lista.ubicar=()=>ubicarLista(input,lista);
 const elegir=i=>{const o=resultados[i];if(!o||o.deshabilitada)return;input.value='';lista.hidden=true;alElegir(o.valor)};
 input.addEventListener('input',pintar);input.addEventListener('click',pintar);
 input.addEventListener('blur',()=>setTimeout(()=>{lista.hidden=true},150));
 input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(lista.hidden)pintar();else if(resultados.length){indice=(indice+(e.key==='ArrowDown'?1:-1)+resultados.length)%resultados.length;marcar()}}else if(e.key==='Enter'){e.preventDefault();elegir(indice)}else if(e.key==='Escape'&&!lista.hidden){e.preventDefault();e.stopPropagation();lista.hidden=true}});
 lista.addEventListener('mousedown',e=>{const b=e.target.closest('.picker-option');if(b){e.preventDefault();elegir(Number(b.dataset.i))}});
 return input
}
// La lista flota sobre la página (position: fixed) para que la ventana no la recorte:
// se abre hacia abajo o, si no hay espacio, hacia arriba, con la altura que quepa en pantalla.
function ubicarLista(input,lista){
 const r=input.getBoundingClientRect(),abajo=window.innerHeight-r.bottom-12,arriba=r.top-12,haciaArriba=abajo<220&&arriba>abajo;
 Object.assign(lista.style,{left:`${r.left}px`,width:`${r.width}px`,maxHeight:`${Math.min(320,haciaArriba?arriba:abajo)}px`,top:haciaArriba?'auto':`${r.bottom+4}px`,bottom:haciaArriba?`${window.innerHeight-r.top+4}px`:'auto'})
}
// Si se desplaza la ventana o la página con una lista abierta, la lista sigue al campo.
['scroll','resize'].forEach(evento=>window.addEventListener(evento,()=>document.querySelectorAll('.picker-results:not([hidden])').forEach(lista=>lista.ubicar?.()),true));
// Campo de formulario con el buscador: guarda el valor en un input oculto y, al elegir,
// muestra la selección como tarjeta con «Cambiar». Se usa en todas las ventanas que eligen personas.
function campoBuscador(name,label){return `<div class="field full"><span class="builder-label">${esc(label)}</span><input type="hidden" name="${name}"><div class="picker" data-buscador="${name}"></div></div>`}
function montarBuscador(name,{opciones,valor='',placeholder,alCambiar=()=>{},icono=o=>/^\d+$/.test(o.valor)?pixelPersonaje(o.valor,o.pj):''}){
 const oculto=$('modal-fields').querySelector(`input[name="${name}"]`),contenedor=$('modal-fields').querySelector(`[data-buscador="${name}"]`);
 const pintar=()=>{const o=opciones().find(x=>x.valor===oculto.value);
  if(!o)return crearSelector(contenedor,{placeholder,opciones,alElegir:v=>{oculto.value=v;pintar();alCambiar(v)}});
  contenedor.innerHTML=`<div class="leader-chip">${icono(o)}<div><strong>${esc(o.titulo)}</strong><small>${esc(o.detalle)}</small></div><button type="button" class="small-button">Cambiar</button></div>`;
  contenedor.querySelector('button').addEventListener('click',()=>{oculto.value='';pintar();alCambiar('');contenedor.querySelector('input').focus()})};
 oculto.value=valor==null?'':String(valor);pintar()
}
function opcionesPersonas(users,excluir=''){return users.filter(u=>String(u.id_usuario)!==String(excluir)).map(u=>({valor:String(u.id_usuario),pj:pjDe(u),titulo:u.nombre_completo,detalle:[u.cargo,u.departamento||u.area].filter(Boolean).join(' · '),buscar:`${u.nombre_completo} ${u.departamento||u.area} ${u.jumpcloud_username||''} ${u.cargo||''}`}))}
// Editor del personaje de un usuario: sexo, tono de piel y una galería de versiones (8 por página).
// Se guarda al instante en la ficha del usuario, aparte de «Guardar grupo».
function editorPersonaje(contenedor,u,{alGuardar,alCerrar}){
 const elegido={personaje:u.personaje||'',variante:Number(u.personaje_variante)||0,piel:u.personaje_piel==null?'':String(u.personaje_piel)};
 let pagina=Math.floor(elegido.variante/8);
 const sugerido={M:'masculino',F:'femenino'}[sexoPorNombre(u.nombre_completo)]||'neutro';
 contenedor.innerHTML=`<div class="pj-editor-cabecera"><button type="button" class="secondary" data-pj="volver">← Volver al grupo</button><strong>Personaje de ${esc(u.nombre_completo)}</strong></div>
  <div class="personaje-cabecera"><div class="personaje-vista" data-pj="vista"></div><div class="personaje-controles">
   <div><span class="builder-label">Personaje</span><select data-pj="sexo" aria-label="Personaje">${[['',`Automático (según el nombre: ${sugerido})`],['M','Masculino'],['F','Femenino'],['N','Neutro']].map(([v,t])=>`<option value="${v}"${v===elegido.personaje?' selected':''}>${t}</option>`).join('')}</select></div>
   <div><span class="builder-label">Tono de piel</span><div class="personaje-tonos" data-pj="tonos"><button type="button" data-piel="" title="Automático">Auto</button>${PJ_PIEL.map((color,i)=>`<button type="button" data-piel="${i}" style="background:${color}" title="Tono ${i+1}" aria-label="Tono de piel ${i+1}"></button>`).join('')}</div></div>
  </div></div>
  <div class="personaje-galeria-cabecera"><span class="builder-label">Elige su personaje</span><button type="button" class="small-button" data-pj="mas">Ver otras opciones</button></div>
  <div class="personaje-galeria" data-pj="galeria"></div>
  <div class="pj-editor-acciones"><button type="button" class="secondary" data-pj="volver">Cancelar</button><button type="button" class="primary" data-pj="guardar">Guardar personaje</button></div>`;
 const parte=k=>contenedor.querySelector(`[data-pj="${k}"]`);
 const pintar=()=>{
  const opciones={sexo:sexoDe({personaje:elegido.personaje,nombre_completo:u.nombre_completo}),piel:elegido.piel===''?null:Number(elegido.piel)};
  parte('vista').innerHTML=pixelPersonaje(u.id_usuario,{...opciones,variante:elegido.variante,accion:'auto'});
  parte('galeria').innerHTML=Array.from({length:8},(_,i)=>pagina*8+i).map(v=>`<button type="button" data-variante="${v}" class="${v===elegido.variante?'active':''}" aria-label="Personaje ${v+1}" aria-pressed="${v===elegido.variante}">${pixelPersonaje(u.id_usuario,{...opciones,variante:v})}</button>`).join('');
  parte('tonos').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.piel===elegido.piel))
 };
 contenedor.onclick=async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.variante!=null)elegido.variante=Number(b.dataset.variante);
  else if(b.dataset.piel!=null)elegido.piel=b.dataset.piel;
  else if(b.dataset.pj==='mas')pagina=(pagina+1)%12;
  else if(b.dataset.pj==='volver')return alCerrar();
  else if(b.dataset.pj==='guardar'){
   const cambios={personaje:elegido.personaje||null,personaje_variante:elegido.variante,personaje_piel:elegido.piel===''?null:Number(elegido.piel)};
   b.disabled=true;
   try{await api(`/activos/design/api/usuarios/${u.id_usuario}`,{method:'PUT',body:JSON.stringify(cambios)});Object.assign(u,cambios);notify(`Personaje de ${u.nombre_completo} actualizado.`);return alGuardar()}
   catch(error){notify(error.message,true);b.disabled=false;return}
  }
  pintar()
 };
 parte('sexo').addEventListener('change',e=>{elegido.personaje=e.target.value;pintar()});
 pintar();parte('volver').focus()
}
// Ventana del grupo en dos partes: arriba la tarjeta del líder y el buscador; abajo los integrantes.
async function editGrupoUI(idLider){
 const users=await api('/activos/design/api/usuarios'),porId=new Map(users.map(u=>[String(u.id_usuario),u]));
 const ubicacion=u=>u.departamento||u.area,miembrosDe=id=>users.filter(u=>String(u.id_lider)===String(id)).map(u=>String(u.id_usuario)),lideraGrupo=u=>miembrosDe(u.id_usuario).length>0;
 const estado={lider:idLider?String(idLider):'',miembros:idLider?miembrosDe(idLider):[],nuevo:''};
 openModal(idLider?'Grupo de trabajo':'Crear grupo de trabajo',[`<div class="field full group-builder pj-animado">
  <section class="team-top">
   <div class="team-lider" id="team-lider"></div>
   <div class="team-panel">
    <div><strong id="team-titulo"></strong><div class="hint" id="team-resumen"></div></div>
    <div id="buscar-lider"><span class="builder-label">Líder del grupo</span><div class="picker" id="picker-lider"></div></div>
    <div id="buscar-miembro"><span class="builder-label">Agregar diseñador</span><div class="picker" id="picker-miembro"></div></div>
   </div>
  </section>
  <section class="team-stage"><div class="team-stage-head"><strong>Integrantes</strong><span class="hint" id="team-conteo"></span></div><div class="team-members" id="team-members"></div></section>
  <div class="pj-editor" id="pj-editor" hidden></div>
 </div>`],'Guardar grupo',async()=>{if(!estado.lider)throw new Error('Selecciona el líder del grupo.');const result=await api(`/activos/design/api/grupos/${encodeURIComponent(estado.lider)}`,{method:'PUT',body:JSON.stringify({integrantes:estado.miembros.map(Number)})});notify(`${result.mensaje} ${estado.miembros.length} integrante(s).`);await loadGrupos()});
 document.querySelector('.modal-box').classList.add('group-modal');
 // La tarjeta recién agregada entra con un salto; las demás no se vuelven a animar al redibujar.
 const tarjeta=(u,esLider=false)=>`<div class="avatar-card active${esLider?' leader':''}${String(u.id_usuario)===estado.nuevo?' nuevo pj-salto':''}">${esLider?'':`<button type="button" class="avatar-remove" data-quitar="${u.id_usuario}" aria-label="Quitar a ${esc(u.nombre_completo)} del grupo" title="Quitar del grupo">×</button>`}<button type="button" class="avatar-edit" data-personaje="${u.id_usuario}" aria-label="Cambiar el personaje de ${esc(u.nombre_completo)}" title="Cambiar personaje">✎</button>${pixelPersonaje(u.id_usuario,{...pjDe(u),lider:esLider,accion:'auto'})}<div class="avatar-name" title="${esc(u.nombre_completo)}">${esc(u.nombre_completo)}</div><div class="avatar-meta">${esLider?'Líder · ':''}${esc(ubicacion(u))} · ${esc(u.equipos_asignados)} PC</div>${!esLider&&u.id_lider&&String(u.id_lider)!==estado.lider?`<span class="avatar-tag">Viene del grupo de ${esc(u.lider)}</span>`:''}${!esLider&&lideraGrupo(u)?'<span class="avatar-tag lidera-tag" title="Sus PC se mantienen con su propio grupo, no en este">Lidera su propio grupo</span>':''}${esLider?'<button type="button" class="small-button" data-cambiar-lider>Cambiar líder</button>':''}</div>`;
 const fantasma=(i,activo)=>`<div class="avatar-card ghost${activo?' clickable':''}"${activo?' data-agregar="1" role="button" tabindex="0" title="Agregar diseñador"':''}>${pixelPersonaje(i+2,{fantasma:true})}<div class="avatar-name">${activo?'＋ Agregar':'&nbsp;'}</div></div>`;
 const pintarEscena=()=>{
  const lider=porId.get(estado.lider),miembros=estado.miembros.map(id=>porId.get(id)).filter(Boolean);
  // Cada PC pertenece a un solo grupo: los de un integrante que lidera su propio grupo no suman aquí.
  const equipos=miembros.filter(u=>!lideraGrupo(u)).reduce((total,u)=>total+Number(u.equipos_asignados||0),Number(lider?.equipos_asignados||0));
  $('team-lider').innerHTML=lider?tarjeta(lider,true):`<div class="avatar-card ghost leader">${pixelPersonaje(1,{lider:true,fantasma:true})}<div class="avatar-name">Líder</div></div>`;
  $('team-members').innerHTML=miembros.map(u=>tarjeta(u)).join('')+Array.from({length:Math.max(1,4-miembros.length)},(_,i)=>fantasma(i+miembros.length,Boolean(lider))).join('');
  $('team-titulo').textContent=lider?`Grupo de ${lider.nombre_completo}`:'Selecciona el líder para comenzar';
  $('team-resumen').textContent=lider?`${equipos} equipo(s) entrarán en el mantenimiento del grupo`:'Después agrega a cada diseñador con el buscador.';
  $('team-conteo').textContent=`${miembros.length} integrante(s)`;
  $('buscar-lider').hidden=Boolean(lider);$('buscar-miembro').hidden=!lider;
  estado.nuevo=''
 };
 const enfocar=id=>$(id).querySelector('input').focus();
 crearSelector($('picker-lider'),{placeholder:'Busca al líder por nombre, cargo, área o JumpCloud',
  opciones:()=>opcionesPersonas(users).map(o=>{const lidera=miembrosDe(o.valor).length;return{...o,etiqueta:lidera?`Ya lidera ${lidera}`:''}}),
  alElegir:id=>{estado.lider=id;estado.miembros=miembrosDe(id);estado.nuevo=id;pintarEscena();enfocar('picker-miembro')}});
 crearSelector($('picker-miembro'),{placeholder:'Busca al diseñador por nombre, área o JumpCloud',
  opciones:()=>users.filter(u=>String(u.id_usuario)!==estado.lider).map(u=>{const yaEsta=estado.miembros.includes(String(u.id_usuario));return{valor:String(u.id_usuario),titulo:u.nombre_completo,detalle:`${ubicacion(u)} · ${u.equipos_asignados} PC`,buscar:`${u.nombre_completo} ${ubicacion(u)} ${u.jumpcloud_username||''}`,deshabilitada:yaEsta,etiqueta:yaEsta?'Ya está en este grupo':u.id_lider&&String(u.id_lider)!==estado.lider?`En grupo de ${u.lider}`:''}}),
  alElegir:id=>{estado.miembros.push(id);estado.nuevo=id;pintarEscena();enfocar('picker-miembro');const tarjetaNueva=$('team-members').querySelector('.nuevo');tarjetaNueva?.scrollIntoView({block:'nearest',behavior:'smooth'})}});
 $('team-lider').addEventListener('click',e=>{if(e.target.closest('[data-cambiar-lider]')){estado.lider='';estado.miembros=[];pintarEscena();enfocar('picker-lider')}});
 $('team-members').addEventListener('click',e=>{const quitar=e.target.closest('[data-quitar]');if(quitar){estado.miembros=estado.miembros.filter(id=>id!==quitar.dataset.quitar);pintarEscena();return}if(e.target.closest('[data-agregar]')&&estado.lider)enfocar('picker-miembro')});
 $('team-members').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.closest('[data-agregar]')&&estado.lider){e.preventDefault();enfocar('picker-miembro')}});
 // El lápiz de cada tarjeta abre el editor del personaje encima del grupo, sin salir de la ventana.
 const cerrarEditor=()=>{$('pj-editor').hidden=true;$('pj-editor').innerHTML=''};
 document.querySelector('.group-builder').addEventListener('click',e=>{const b=e.target.closest('[data-personaje]');if(!b)return;const panel=$('pj-editor');panel.hidden=false;editorPersonaje(panel,porId.get(b.dataset.personaje),{alGuardar:()=>{pintarEscena();cerrarEditor()},alCerrar:cerrarEditor});panel.scrollIntoView({block:'nearest'})});
 pintarEscena();
 enfocar(estado.lider?'picker-miembro':'picker-lider')
}
// ---------------------------------------------------------------------------
// Solicitudes de mantenimiento por grupo (en la API y la base se llaman «jornadas»).
// Ciclo: programar -> el día del servicio, Ver y completar los equipos atendidos ->
// al no quedar pendientes la solicitud se cierra y, si tiene frecuencia, el sistema
// programa sola la siguiente. Mientras tanto el calendario la muestra «proyectada».
// ---------------------------------------------------------------------------
const FRECUENCIAS=[{value:'',label:'No se repite'},{value:1,label:'Cada mes'},{value:2,label:'Cada 2 meses'},{value:3,label:'Cada 3 meses'},{value:4,label:'Cada 4 meses'},{value:6,label:'Cada 6 meses'},{value:12,label:'Cada año'}];
function textoFrecuencia(meses){return meses?FRECUENCIAS.find(f=>f.value===Number(meses))?.label||`Cada ${meses} meses`:'No se repite'}
// «LEIDY LAURA RODRIGUEZ PADILLA» -> «Leidy Rodriguez»: nombre y primer apellido para el calendario.
function nombreCorto(nombre){const p=String(nombre||'').trim().split(/\s+/).map(x=>x.charAt(0).toUpperCase()+x.slice(1).toLowerCase());return (p.length>=4?[p[0],p[2]]:p.slice(0,2)).join(' ')}
function tituloSolicitud(j,corto=false){return `${j.tipo_mantenimiento==='CORRECTIVO'?'Correctivo':'Mantenimiento'} equipos · ${corto?nombreCorto(j.lider):j.lider}`}
function cuandoEs(iso){const dias=Math.round((new Date(`${iso}T00:00`)-new Date(`${fechaLocalISO(new Date())}T00:00`))/864e5);return dias===0?'hoy':dias===1?'mañana':`en ${dias} días`}
async function programarJornadaUI(idLider){
 const grupos=await api('/activos/design/api/grupos');
 if(!grupos.length)throw new Error('Primero crea un grupo de trabajo en «Grupos de trabajo».');
 // Lista corta: Asset Tag y la persona que lo tiene (el líder marcado).
 const equiposDe=async lider=>{if(!lider)return '<p class="hint">Selecciona el grupo para ver sus equipos.</p>';const g=await api(`/activos/design/api/grupos/${encodeURIComponent(lider)}`);return g.equipos.length?g.equipos.map(e=>`<label><input type="checkbox" name="asset_tags" value="${esc(e.asset_tag)}" checked> <span><b>${esc(e.asset_tag)}</b> · ${esc(e.usuario)}${String(e.id_usuario)===String(lider)?' <small>(líder)</small>':''}</span></label>`).join(''):'<p class="hint">El grupo no tiene equipos asignados.</p>'};
 const fields=[guia('¿Cómo funciona una solicitud?',['Elige el grupo, la fecha y el responsable. Se crea un servicio por cada equipo marcado.','Con una <b>frecuencia</b>, al completar todos los equipos se programa sola la siguiente solicitud (por ejemplo, 4 meses después). Desde ya la verás «proyectada» en el calendario.','El día del servicio abre la solicitud con <b>Ver</b>, marca los equipos atendidos y pulsa «Completar marcados».','Si la programaste por error, usa <b>Anular</b> en el listado de solicitudes.']),
  campoBuscador('id_lider','Grupo (líder)'),field('tipo_mantenimiento','Tipo','text','PREVENTIVO',true,[{value:'PREVENTIVO',label:'Preventivo (en sitio)'},{value:'CORRECTIVO',label:'Correctivo'}]),field('fecha_programada','Fecha programada','date',fechaLocalISO(new Date()),true),
  field('frecuencia_meses','Frecuencia','text','',false,FRECUENCIAS),field('responsable','Responsable técnico','text','',true),field('descripcion','Descripción del trabajo','textarea','',false,null,true),
  '<div class="field full"><p class="hint">Equipos del grupo: desmarca los que no entran en esta solicitud.</p></div>',checkList('asset_tags',await equiposDe(idLider))];
 openModal('Programar mantenimiento por grupo',fields,'Programar solicitud',async form=>{
  const data=values(form),asset_tags=form.getAll('asset_tags');
  if(!data.id_lider)throw new Error('Selecciona el grupo.');if(!asset_tags.length)throw new Error('Marca al menos un equipo.');
  const result=await api('/activos/design/api/jornadas',{method:'POST',body:JSON.stringify({id_lider:Number(data.id_lider),tipo_mantenimiento:data.tipo_mantenimiento,fecha_programada:data.fecha_programada,responsable:data.responsable,descripcion:data.descripcion||null,asset_tags,frecuencia_meses:data.frecuencia_meses?Number(data.frecuencia_meses):null})});
  notify(`${result.mensaje} ${asset_tags.length} equipo(s).`);verPestanaMantenimiento('jornadas');await refrescarMantenimiento()});
 montarBuscador('id_lider',{valor:idLider??'',placeholder:'Busca el grupo por líder, cargo o área',icono:o=>pixelPersonaje(o.valor,{...o.pj,lider:true}),
  opciones:()=>grupos.map(g=>({valor:String(g.id_lider),pj:pjDe(g),titulo:g.lider,detalle:`${[g.cargo,g.departamento||g.area].filter(Boolean).join(' · ')} · ${g.equipos} equipos`,buscar:`${g.lider} ${g.cargo||''} ${g.departamento||g.area}`,etiqueta:g.proxima_jornada?`Programado ${fechaCorta(g.proxima_jornada)}`:''})),
  alCambiar:async lider=>{$('lista-asset_tags').innerHTML=await equiposDe(lider)}})
}
function jornadaEstado(estado){const clases={ABIERTA:'stock',VENCIDA:'overdue',CERRADA:'inuse',ANULADA:'neutral'};return `<span class="badge ${clases[estado]||'stock'}">${esc(estado)}</span>`}
function avance(j){const hechos=j.completados+j.cancelados;return `<div class="progress"><div class="progress-bar"><span style="width:${j.total?Math.round(hechos/j.total*100):0}%"></span></div><span>${hechos}/${j.total}</span></div>`}
// Las solicitudes se cargan con loadMantenimientos y alimentan la tabla, la lista y el calendario.
let jornadasCache=[];
function renderJornadas(){
 const estado=$('jornadas-filtro-estado').value,rows=jornadasCache.filter(j=>!estado||j.estado===estado);
 if(!rows.length)return setEmpty('tabla-jornadas',8,jornadasCache.length?'No hay solicitudes con ese estado.':'No hay solicitudes. Usa «Programar por grupo» para crear la primera.');
 $('tabla-jornadas').innerHTML=rows.map(j=>{const pendiente=['ABIERTA','VENCIDA'].includes(j.estado);return `<tr${j.estado==='ANULADA'?' class="fila-anulada"':''}><td>${esc(fechaCorta(j.fecha_programada))}<br><small>Solicitud #${j.id_jornada}</small></td><td><b>${esc(j.lider)}</b></td><td>${esc(j.tipo_mantenimiento)}</td><td>${esc(textoFrecuencia(j.frecuencia_meses))}${j.fecha_siguiente?`<br><small>Siguiente: ${esc(fechaCorta(j.fecha_siguiente))}</small>`:''}</td><td>${esc(j.responsable)}</td><td>${avance(j)}</td><td>${jornadaEstado(j.estado)}${j.estado==='ANULADA'&&j.motivo_anulacion?`<br><small>${esc(j.motivo_anulacion)}</small>`:''}</td><td><div class="actions"><button class="small-button" data-action="open-jornada" data-id="${j.id_jornada}">Ver</button>${pendiente?`<button class="small-button" data-action="edit-jornada" data-id="${j.id_jornada}">Editar</button>${j.completados?'':`<button class="small-button danger-button" data-action="anular-jornada" data-id="${j.id_jornada}">Anular</button>`}`:''}</div></td></tr>`}).join('')
}
function verPestanaMantenimiento(tab){document.querySelector(`[data-maint-tab="${tab}"]`)?.click()}
async function editarJornadaUI(id){
 const j=await api(`/activos/design/api/jornadas/${encodeURIComponent(id)}`);
 openModal(`Editar solicitud #${j.id_jornada} · ${j.lider}`,['<div class="field full"><p class="hint">La fecha, el responsable y la descripción se aplican a los equipos que siguen pendientes; los ya atendidos conservan sus datos.</p></div>',field('fecha_programada','Fecha programada','date',j.fecha_programada,true),field('frecuencia_meses','Frecuencia','text',j.frecuencia_meses??'',false,FRECUENCIAS),field('responsable','Responsable técnico','text',j.responsable,true,null,true),field('descripcion','Descripción del trabajo','textarea',j.descripcion||'',false,null,true)],'Guardar cambios',async form=>{
  const d=values(form),result=await api(`/activos/design/api/jornadas/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({fecha_programada:d.fecha_programada,responsable:d.responsable,descripcion:d.descripcion,frecuencia_meses:d.frecuencia_meses?Number(d.frecuencia_meses):null})});
  notify(result.mensaje);await refrescarMantenimiento()})
}
async function anularJornadaUI(id){
 const j=await api(`/activos/design/api/jornadas/${encodeURIComponent(id)}`);
 openModal(`Anular solicitud #${j.id_jornada} · ${j.lider}`,[`<div class="field full"><p class="hint">Úsalo si la solicitud se programó por error. Sus ${esc(j.total)} servicio(s) quedan cancelados y no se programa una siguiente. Si el grupo no tiene otra solicitud pendiente, vuelve a «Grupos por programar». La solicitud queda en el listado como ANULADA.</p></div>`,field('motivo','Motivo de la anulación','textarea','',true,null,true)],'Anular solicitud',async form=>{
  const result=await api(`/activos/design/api/jornadas/${encodeURIComponent(id)}/anular`,{method:'POST',body:JSON.stringify({motivo:form.get('motivo')})});
  notify(result.mensaje);await refrescarMantenimiento()})
}
function sumarMeses(iso,meses){const [y,m,d]=iso.split('-').map(Number),ultimo=new Date(y,m+meses,0).getDate();return fechaLocalISO(new Date(y,m-1+meses,Math.min(d,ultimo)))}
// Ventana de la solicitud: se abre con «Ver» para documentar el servicio el día que se hace.
async function showJornada(id){
 const j=await api(`/activos/design/api/jornadas/${encodeURIComponent(id)}`),pendientes=j.mantenimientos.filter(m=>['PROGRAMADO','EN_PROCESO'].includes(m.estado_mantenimiento)),anulada=j.estado==='ANULADA';
 const dato=(label,valor)=>`<div><small>${label}</small><strong>${valor}</strong></div>`;
 const resumen=`<div class="field full"><div class="acta-summary">${dato('Grupo (líder)',esc(j.lider))}${dato('Fecha programada',esc(fechaCorta(j.fecha_programada)))}${dato('Tipo',esc(j.tipo_mantenimiento))}${dato('Frecuencia',esc(textoFrecuencia(j.frecuencia_meses)))}${dato('Responsable',esc(j.responsable))}${dato('Estado',jornadaEstado(j.estado))}${dato('Avance',avance(j))}</div>${j.descripcion?`<p class="hint">${esc(j.descripcion)}</p>`:''}${anulada?`<p class="hint">Anulada el ${esc(fechaCorta(j.fecha_anulacion))}: ${esc(j.motivo_anulacion||'')}</p>`:''}</div>`;
 const filas=j.mantenimientos.map(m=>{const pendiente=['PROGRAMADO','EN_PROCESO'].includes(m.estado_mantenimiento);return `<tr><td>${pendiente?`<input type="checkbox" name="ids" value="${m.id_mantenimiento}" aria-label="Seleccionar ${esc(m.asset_tag)}">`:''}</td><td><button class="link-button" type="button" data-action="open-ficha" data-id="${esc(m.asset_tag)}">${esc(m.asset_tag)}</button></td><td>${esc(m.usuario)}</td><td>${maintenanceStatus(m.estado_mantenimiento)}</td><td>${esc(m.acciones_realizadas||'—')}${m.fecha_realizada?`<br><small>${esc(fechaCorta(m.fecha_realizada))}</small>`:''}</td><td>${anulada?'':`<div class="actions"><button class="small-button" type="button" data-action="open-mantenimiento" data-id="${m.id_mantenimiento}">Editar</button><button class="small-button" type="button" data-action="reportar-novedad" data-id="${esc(m.asset_tag)}">Novedad</button></div>`}</td></tr>`}).join('');
 const fields=[resumen];
 if(pendientes.length)fields.push(guia('¿Cómo documento el servicio?',['Marca los equipos a los que ya se les hizo el mantenimiento, escribe el trabajo realizado y pulsa <b>Completar marcados</b>.','Para documentar un equipo en detalle (diagnóstico, estado, fecha), usa <b>Editar</b>; al guardar o con «Volver» regresas aquí.','Si encuentras un problema en un equipo, usa <b>Novedad</b>: queda como correctivo pendiente y el equipo pasa a «Novedades a revisar».',`Cuando no quedan equipos pendientes la solicitud se cierra${j.frecuencia_meses?` y se programa sola la siguiente (${esc(textoFrecuencia(j.frecuencia_meses).toLowerCase())})`:''}.`]));
 fields.push(`<div class="field full"><table class="mini-table"><thead><tr><th></th><th>Equipo</th><th>Usuario actual</th><th>Estado</th><th>Trabajo realizado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`);
 if(pendientes.length)fields.push(`<div class="field full"><div class="toolbar" style="margin:0"><button type="button" class="secondary" data-action="marcar-todos" data-campo="ids" data-valor="1">Marcar pendientes</button><button type="button" class="secondary" data-action="marcar-todos" data-campo="ids" data-valor="0">Ninguno</button></div></div>`,field('acciones_realizadas','Trabajo realizado (se aplica a los marcados)','textarea','',false,null,true),field('fecha_realizada','Fecha realizada','date',fechaLocalISO(new Date())));
 if(j.id_jornada_siguiente)fields.push(`<div class="field full"><p class="hint">La siguiente solicitud de este grupo quedó programada para el ${esc(fechaCorta(j.fecha_siguiente))}.</p><button type="button" class="secondary" data-action="open-jornada" data-id="${j.id_jornada_siguiente}">Ver solicitud #${j.id_jornada_siguiente}</button></div>`);
 else if(pendientes.length&&j.frecuencia_meses)fields.push(`<div class="field full"><p class="hint">Al completarla se programará sola la siguiente, cerca del ${esc(fechaCorta(sumarMeses(j.fecha_programada,j.frecuencia_meses)))}.</p></div>`);
 else if(j.estado==='CERRADA')fields.push('<div class="field full"><p class="hint">Esta solicitud no se repite: si el grupo no tiene otra pendiente, aparece en «Grupos por programar».</p></div>');
 openModal(`Solicitud #${j.id_jornada} · ${tituloSolicitud(j)}`,fields,pendientes.length?'Completar marcados':'Cerrar',pendientes.length?async form=>{
  const ids=form.getAll('ids').map(Number);if(!ids.length)throw new Error('Marca los equipos a los que ya se les hizo el mantenimiento.');
  const result=await api('/activos/design/api/mantenimientos/completar',{method:'POST',body:JSON.stringify({ids,acciones_realizadas:form.get('acciones_realizadas')||null,fecha_realizada:form.get('fecha_realizada')||null})});
  notify(result.mensaje);await refrescarMantenimiento()}:async()=>{},{cancelar:'Cerrar'});
 document.querySelector('.modal-box').classList.add('acta-modal');volverModal=()=>showJornada(id)
}
async function refrescarMantenimiento(){const tareas=[loadEstado()];if($('mantenimientos').classList.contains('active'))tareas.push(loadMantenimientos());if($('grupos').classList.contains('active'))tareas.push(loadGrupos());await Promise.all(tareas)}
// Programar el mismo servicio para varios equipos sueltos (no tienen que ser del mismo grupo de
// trabajo): trae todos los equipos activos (no hace falta haber entrado antes a «Equipos»), y los
// que marques quedan como mantenimientos sueltos, no una "solicitud".
async function programarLoteUI(){
 const equipos=await api('/activos/design/api/equipos');
 if(!equipos.length)throw new Error('No hay equipos registrados todavía.');
 // Organizados por grupo de trabajo (pedido por Oscar, 26-oct-2026): más fácil de ubicar que una
 // lista plana de ~180 equipos, y "Marcar grupo" selecciona todos los de un grupo de una vez.
 const porGrupo=new Map();
 for(const e of equipos){
  const clave=e.id_lider_grupo!=null?String(e.id_lider_grupo):'sin-grupo';
  if(!porGrupo.has(clave))porGrupo.set(clave,{titulo:e.grupo||'Sin grupo asignado',items:[]});
  porGrupo.get(clave).items.push({valor:e.asset_tag,html:`<b>${esc(e.asset_tag)}</b> · ${esc(e.usuario||'Sin usuario')}${e.marca||e.modelo?` · ${esc([e.marca,e.modelo].filter(Boolean).join(' '))}`:''}`});
 }
 const grupos=[...porGrupo.values()].sort((a,b)=>(a.titulo==='Sin grupo asignado')-(b.titulo==='Sin grupo asignado')||a.titulo.localeCompare(b.titulo));
 const fields=[
  guia('¿Cómo funciona?',['Los equipos están organizados por grupo de trabajo. Marca equipos sueltos, o usa «Marcar grupo» para seleccionar todos los de un grupo de una vez.','Se crea un servicio PROGRAMADO por cada equipo marcado, con la misma fecha, tipo y responsable.','A diferencia de «Programar por grupo», no quedan agrupados en una solicitud ni se reprograman solos -- cada uno se completa o edita por separado desde la pestaña «Lista».']),
  field('tipo_mantenimiento','Tipo','text','PREVENTIVO',true,[{value:'PREVENTIVO',label:'Preventivo (en sitio)'},{value:'CORRECTIVO',label:'Correctivo'}]),
  field('fecha_programada','Fecha programada','date',fechaLocalISO(new Date()),true),
  field('responsable','Responsable técnico','text','',true),
  field('descripcion_falla','Descripción (opcional)','textarea','',false,null,true),
  checkListGrupos('asset_tags',grupos,'Buscar por Asset Tag, usuario, marca o modelo')
 ];
 openModal(`Programar mantenimiento para varios equipos (${equipos.length} en total)`,fields,'Programar',async form=>{
  const data=values(form),asset_tags=form.getAll('asset_tags');
  if(!asset_tags.length)throw new Error('Marca al menos un equipo.');
  const result=await api('/activos/design/api/mantenimientos/lote',{method:'POST',body:JSON.stringify({asset_tags,tipo_mantenimiento:data.tipo_mantenimiento,fecha_programada:data.fecha_programada,responsable:data.responsable,descripcion_falla:data.descripcion_falla||null})});
  notify(result.mensaje);switchView('mantenimientos');verPestanaMantenimiento('lista')})
}
$('programar-lote').addEventListener('click',()=>programarLoteUI().catch(error=>notify(error.message,true)));
$('nuevo-grupo').addEventListener('click',()=>editGrupoUI(null).catch(error=>notify(error.message,true)));
$('nueva-jornada').addEventListener('click',()=>programarJornadaUI(null).catch(error=>notify(error.message,true)));
$('buscar-grupos').addEventListener('input',renderGrupos);
$('jornadas-filtro-estado').addEventListener('change',renderJornadas);
$('nuevo-dongle').addEventListener('click',()=>openModal('Registrar dongle',[field('numero_dongle','Número del dongle','text','',true),field('serial_number','Serial físico','text','',true),field('version_exocad','Versión ExoCAD','text','N/A'),field('modulos','Módulos','text','',false,null,true)],'Registrar',async form=>{await api('/activos/design/api/dongles',{method:'POST',body:JSON.stringify(values(form))});notify('Dongle registrado correctamente.');await loadDongles()}));
async function assignDongle(numero){const equipos=await api('/activos/design/api/equipos');openModal(`Asignar dongle ${numero}`,[campoBuscador('asset_tag','Equipo'),field('motivo','Motivo del movimiento','textarea','',true,null,true)],'Guardar asignación',async form=>{const d=values(form);if(!d.asset_tag)throw new Error('Busca y elige el equipo, o «Liberar».');await api('/activos/design/api/dongles/asignar',{method:'POST',body:JSON.stringify({numero_dongle:numero,asset_tag:d.asset_tag==='LIBERAR'?null:d.asset_tag,motivo:d.motivo})});notify('Asignación de dongle guardada.');await loadDongles()});montarBuscador('asset_tag',{placeholder:'Busca el equipo por Asset Tag o persona (o escribe «liberar»)',icono:()=>'',opciones:()=>[OPCION_LIBERAR,...equipos.map(x=>({valor:x.asset_tag,titulo:`${x.asset_tag} · ${x.tipo_equipo}`,detalle:`${x.usuario} · ${[x.marca,x.modelo_referencia].filter(Boolean).join(' ')}`,buscar:`${x.asset_tag} ${x.usuario} ${x.serial_number} ${x.modelo_referencia||''}`}))]});$('modal-fields').querySelector('[data-buscador="asset_tag"] input').focus()}
async function dongleHistory(numero){const d=await api(`/activos/design/api/dongles/${encodeURIComponent(numero)}/historial`);const rows=d.historial.length?d.historial.map(x=>`<div class="history-entry"><strong>${esc(x.asset_tag)} · ${esc(x.nombre_completo||'Sin usuario')}</strong><p>${esc(fmtFecha(x.fecha_inicio))} – ${esc(x.fecha_fin?fmtFecha(x.fecha_fin):'En uso')} · ${esc(x.motivo||'Sin motivo')}</p></div>`).join(''):'<p class="empty">Este dongle no tiene movimientos históricos.</p>';openModal(`Historial del dongle ${numero}`,[`<div class="field full"><p class="hint">${esc(d.cantidad_equipos)} equipos utilizados históricamente</p><div class="history-list">${rows}</div></div>`],'Cerrar',async()=>{})}
$('tabla-dongles').addEventListener('click',async e=>{const b=e.target.closest('button[data-action]');if(!b)return;try{if(b.dataset.action==='edit-dongle')await editDongle(b.dataset.number);else if(b.dataset.action==='assign-dongle')await assignDongle(b.dataset.number);else await dongleHistory(b.dataset.number)}catch(error){notify(error.message,true)}});
let excelResult=null;
async function compareExcel(){const b=$('comparar-excel');b.disabled=true;try{const file=$('archivo-excel').files[0];excelResult=await api('/activos/design/api/excel/comparar',file?{method:'POST',body:file,headers:{'Content-Type':'application/octet-stream','X-Nombre-Archivo':encodeURIComponent(file.name)}}:{method:'POST'});const counts=excelResult.resumen||{};$('resumen-excel').innerHTML=`<span>Libro: <b>${esc(excelResult.archivo)}</b></span><span>Equipos en Excel: <b>${esc(excelResult.equipos_excel)}</b></span><span>Usuarios: <b>${esc(excelResult.usuarios_excel)}</b></span><span>Dongles: <b>${esc(excelResult.dongles_excel)}</b></span><span>Cambios aplicables: <b>${esc(excelResult.cambios_aplicables)}</b></span><span>${Object.entries(counts).map(([k,v])=>`${esc(k)}: ${esc(v)}`).join(' · ')}</span>`;if(!excelResult.cambios.length)setEmpty('tabla-excel',7,'No se encontraron diferencias.');else $('tabla-excel').innerHTML=excelResult.cambios.map((x,i)=>`<tr><td class="checkbox-cell">${x._aplicar?`<input type="checkbox" data-change="${i}" aria-label="Seleccionar cambio">`:'—'}</td><td>${esc(x.tipo)}</td><td>${esc(x.identificador)}</td><td>${esc(x.campo)}</td><td>${esc(x.actual)}</td><td>${esc(x.excel)}</td><td>${esc(x.accion)}</td></tr>`).join('');$('sincronizar-excel').disabled=!excelResult.cambios_aplicables;notify('Comparación de Excel completada.')}catch(error){notify(error.message,true)}finally{b.disabled=false}}
$('comparar-excel').addEventListener('click',compareExcel);
$('tabla-excel').addEventListener('change',()=>{$('sincronizar-excel').disabled=!document.querySelector('#tabla-excel input:checked')});
$('sincronizar-excel').addEventListener('click',async()=>{const selected=[...document.querySelectorAll('#tabla-excel input:checked')].map(box=>excelResult.cambios[Number(box.dataset.change)]._aplicar);if(!selected.length)return;const button=$('sincronizar-excel');button.disabled=true;try{const result=await api('/activos/design/api/excel/sincronizar',{method:'POST',body:JSON.stringify({cambios:selected})});notify(result.mensaje);excelResult=null;$('tabla-excel').innerHTML='<tr><td colspan="7" class="empty">Vuelve a comparar para confirmar los cambios aplicados.</td></tr>';$('resumen-excel').textContent='';await Promise.all([loadSummary(),loadEquipos(),loadDongles()])}catch(error){notify(error.message,true);button.disabled=false}});
function debounce(fn,delay=250){let timer;return()=>{clearTimeout(timer);timer=setTimeout(()=>fn().catch(e=>notify(e.message,true)),delay)}}
$('buscar-equipos').addEventListener('input',debounce(loadEquipos));
// Al cambiar de página se vuelve al inicio de la tabla: la barra flotante se usa desde cualquier punto del scroll.
$('equipos-paginacion').addEventListener('click',e=>{const button=e.target.closest('button[data-page]');if(!button||button.disabled)return;equiposPage+=Number(button.dataset.page);renderEquipos();window.scrollTo({top:0})});
async function descargar(url,nombre,button){button.disabled=true;try{const response=await fetch(url);if(!response.ok){let data={};try{data=await response.json()}catch{}throw new Error(data.detail||`La exportación falló (${response.status}).`)}const blob=await response.blob(),enlace=URL.createObjectURL(blob),link=document.createElement('a');link.href=enlace;link.download=nombre;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(enlace),1000);notify('Archivo Excel descargado.')}catch(error){notify(error.message,true)}finally{button.disabled=false}}
$('exportar-equipos').addEventListener('click',()=>descargar(`/activos/design/api/equipos/exportar?${equipmentFilters()}`,`inventario_equipos_${fechaLocalISO(new Date())}.xlsx`,$('exportar-equipos')));
$('exportar-inventario').addEventListener('click',()=>descargar('/activos/design/api/exportar/inventario',`inventario_completo_${fechaLocalISO(new Date())}.xlsx`,$('exportar-inventario')));
$('buscar-dongles').addEventListener('input',debounce(loadDongles));$('buscar-usuarios').addEventListener('input',debounce(loadUsuarios));$('buscar-retirados').addEventListener('input',debounce(loadRetirados));$('buscar-areas').addEventListener('input',debounce(loadAreasView,150));
const searchInputs=['buscar-equipos','buscar-dongles','buscar-usuarios','buscar-retirados','buscar-areas','buscar-grupos'];
searchInputs.forEach(id=>$(id).addEventListener('input',()=>{document.querySelector(`[data-clear-search="${id}"]`).hidden=!$(id).value}));
document.addEventListener('click',event=>{const clear=event.target.closest('[data-clear-search]');if(!clear)return;const input=$(clear.dataset.clearSearch);input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus()});
document.addEventListener('keydown',event=>{if(event.key!=='/'||event.ctrlKey||event.altKey||event.metaKey||$('modal').classList.contains('show'))return;const target=event.target;if(target.matches('input,textarea,select,[contenteditable="true"]'))return;const activeView=document.querySelector('.view.active')?.id;const searchByView={equipos:'buscar-equipos',dongles:'buscar-dongles',usuarios:'buscar-usuarios',retirados:'buscar-retirados',areas:'buscar-areas',grupos:'buscar-grupos'};const input=$(searchByView[activeView]);if(input){event.preventDefault();input.focus();input.select()}});
$('recargar-equipos').addEventListener('click',()=>loadEquipos().catch(e=>notify(e.message,true)));$('recargar-dongles').addEventListener('click',()=>loadDongles().catch(e=>notify(e.message,true)));
medirEncabezado();loadSummary().catch(e=>notify(e.message,true));loadEstado().catch(e=>notify(e.message,true));
