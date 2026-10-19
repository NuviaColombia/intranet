/* Generado por scripts/integrar_development.py desde control-proyectos/public. No editar a mano. */
/* Control de Proyectos y Protocolos · conector a la API REST real
   Reemplaza a api-mock.js: carga SOLO uno de los dos en index.html.
   Expone exactamente la misma interfaz `api` que usa app.js.

   Configuración (definir antes de cargar los scripts):
     window.CP_API_BASE   = '/api'            // URL base del backend
     window.CP_AUTH_TOKEN = '...'             // opcional: token Bearer
     window.CP_USER_NAME  = 'Nombre Apellido' // usuario actual (auditoría en pantalla)

   Contrato de errores esperado del backend (JSON):
     { "message": "texto para el usuario", "details": ["detalle 1", "detalle 2"] }
   Para 409 de transición también se acepta { "missing_gates": [...] }.
*/
"use strict";
const API_BASE = window.CP_API_BASE || '/design/api/dev';
const cache = { posts: [] };   // para alternar leído / útil sin pedir el estado de nuevo

async function http(method, path, body, form){
  const opt = { method, headers: { 'Accept': 'application/json' }, credentials: 'same-origin' };
  if(form) opt.body = form;
  else if(body !== undefined){ opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  if(window.CP_AUTH_TOKEN) opt.headers.Authorization = 'Bearer ' + window.CP_AUTH_TOKEN;
  let res;
  try{ res = await fetch(API_BASE + path, opt); }
  catch(e){ throw new ApiError(0, (window.CP_EN?'No connection to the server. Check your network and try again.':'No hay conexión con el servidor. Revisa tu red e intenta de nuevo.')); }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if(!res.ok){
    const details = (data && (data.details || data.missing_gates)) || [];
    throw new ApiError(res.status, (data && data.message) || (window.CP_EN?`Server error (${res.status})`:`Error del servidor (${res.status})`), details);
  }
  return data;
}
const dataUrlToBlob = async u => (await fetch(u)).blob();
const q = encodeURIComponent;

/* Datos de ejemplo: en producción no se siembra nada */
function seed(){}

const api = {
  /* Proyectos */
  list:          ()              => http('GET',    '/projects'),
  create:        (input)         => http('POST',   '/projects', input),
  update:        (id, patch)     => http('PATCH',  `/projects/${q(id)}`, patch),
  changeStatus:  (id, to, reason)=> http('POST',   `/projects/${q(id)}/transitions`, { to, reason }),
  setGate:       (id, key, done) => http('PUT',    `/projects/${q(id)}/gates/${q(key)}`, { done }),
  remove:        (id)            => http('DELETE', `/projects/${q(id)}`),
  addNote:       (id, text)      => http('POST',   `/projects/${q(id)}/notes`, { text }),

  /* Riesgos */
  saveRisk(id, input){
    const { id: riskId, ...body } = input;
    return riskId ? http('PATCH', `/projects/${q(id)}/risks/${q(riskId)}`, body)
                  : http('POST',  `/projects/${q(id)}/risks`, body);
  },
  deleteRisk:    (id, riskId)    => http('DELETE', `/projects/${q(id)}/risks/${q(riskId)}`),

  /* Evidencias: se suben como multipart (archivo + metadatos) */
  async addEvidence(id, items){
    const form = new FormData();
    for(const [i, it] of items.entries()){
      form.append('files', await dataUrlToBlob(it.dataUrl), it.name || `evidencia-${i + 1}`);
    }
    form.append('meta', JSON.stringify(items.map(({ dataUrl, ...m }) => m)));
    return http('POST', `/projects/${q(id)}/evidence`, undefined, form);
  },
  updateEvidence:(id, evId, patch)=> http('PATCH',  `/projects/${q(id)}/evidence/${q(evId)}`, patch),
  deleteEvidence:(id, evId)      => http('DELETE', `/projects/${q(id)}/evidence/${q(evId)}`),

  /* Posts */
  async listPosts(){ cache.posts = await http('GET', '/posts'); return cache.posts; },
  savePost(input){
    const { id, ...body } = input;
    return id ? http('PATCH', `/posts/${q(id)}`, body) : http('POST', '/posts', body);
  },
  toggleRead(id){ const p = cache.posts.find(x => x.id === id); return http(p && p.read ? 'DELETE' : 'PUT', `/posts/${q(id)}/read`); },
  markRead:      (id)            => http('PUT',    `/posts/${q(id)}/read`),
  toggleUseful(id){ const p = cache.posts.find(x => x.id === id); return http(p && p.usefulMine ? 'DELETE' : 'PUT', `/posts/${q(id)}/useful`); },
  deletePost:    (id)            => http('DELETE', `/posts/${q(id)}`),

  /* Responsables (personas activas de Nuvia Design) */
  people:        ()              => http('GET',    '/people'),

  /* Respaldo */
  exportAll:     ()              => http('GET',    '/export'),
  importAll:     (data)          => http('POST',   '/import', data)
};
