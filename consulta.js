/* Consulta pública: busca el resumen publicado por el profesor usando el hash del código. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cfg = window.FIREBASE_CONFIG;
let fs = null;
if (cfg && cfg.apiKey && !/^PEGA/.test(cfg.apiKey)) fs = getFirestore(initializeApp(cfg));

async function hash(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(t).toUpperCase().replace(/\s+/g, '')));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

function show(d) {
  const counted = d.acts.filter(a => a.c);
  const done = counted.filter(a => a.v !== ''), miss = counted.filter(a => a.v === '');
  const other = d.acts.filter(a => !a.c);
  const row = (a, cls, txt) => `<li><span>${esc(a.n)}</span><span class="${cls}">${txt}</span></li>`;
  $('res').innerHTML = `<div class="card">
    <h2>${esc(d.name)}</h2>
    <div class="sub">${esc(d.curso)}${d.area ? ' · ' + esc(d.area) : ''}${d.prof ? ' · ' + esc(d.prof) : ''}</div>
    <div class="sum"><div class="s-ok"><b>${done.length}</b>Realizadas</div><div class="s-no"><b>${miss.length}</b>Faltantes</div></div>
    <div class="ent ${d.ent ? 'yes' : 'no'}">${d.ent ? `ENTREVISTA: te faltan ${miss.length} actividades (desde ${d.min} corresponde entrevista)` : 'No tienes entrevista pendiente'}</div>
    ${miss.length ? `<h3>Faltantes</h3><ul>${miss.map(a => row(a, 'falta', 'Falta')).join('')}</ul>` : ''}
    ${done.length ? `<h3>Realizadas</h3><ul>${done.map(a => row(a, 'ok', esc(a.v))).join('')}</ul>` : ''}
    ${other.length ? `<h3>Otras actividades</h3><ul>${other.map(a => row(a, a.v ? 'ok' : 'nc', a.v ? esc(a.v) : 'Sin nota')).join('')}</ul>` : ''}
  </div>`;
  $('res').hidden = false;
}

$('f').addEventListener('submit', async e => {
  e.preventDefault();
  const code = $('code').value.trim(), msg = $('msg'), btn = $('go');
  msg.textContent = ''; $('res').hidden = true;
  if (!code) { msg.textContent = 'Escribe tu código RUDE o C.I.'; return; }
  if (!fs) { msg.textContent = 'La consulta aún no está configurada.'; return; }
  btn.disabled = true; btn.textContent = 'Buscando…';
  try {
    const snap = await getDoc(doc(fs, 'consulta', await hash(code)));
    if (!snap.exists()) msg.textContent = 'No se encontró ese código. Revisa que esté bien escrito.';
    else show(JSON.parse(snap.data().data));
  } catch (err) {
    msg.textContent = 'No se pudo consultar. Revisa tu conexión e inténtalo de nuevo.';
  }
  btn.disabled = false; btn.textContent = 'Consultar';
});
