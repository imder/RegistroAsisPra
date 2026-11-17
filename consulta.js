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
  const row = a => {
    const falta = a.c && a.v === '';
    const cls = falta ? 'miss' : '';
    const txt = falta ? 'Falta' : a.v !== '' ? esc(a.v) : 'Sin nota';
    return `<li class="${cls}"><span>${a.t === 'inv' ? '' : '🖥️ '}${esc(a.n)}</span><span class="v ${a.v !== '' ? 'ok' : 'nc'}">${txt}</span></li>`;
  };
  $('res').innerHTML = `<div class="card">
    <h2>${esc(d.name)}</h2>
    <div class="sub">${esc(d.curso)}${d.area ? ' · ' + esc(d.area) : ''}${d.prof ? ' · ' + esc(d.prof) : ''}</div>
    <div class="sum"><div class="s-ok"><b>${done.length}</b>Realizadas</div><div class="s-no"><b>${miss.length}</b>Faltantes</div></div>
    <div class="ent ${d.ent ? 'yes' : 'no'}">${d.ent ? `Corresponde entrevista${d.tri ? ' del ' + esc(d.tri.replace(/TRIMESTRE/i, 'Trimestre')) : ''}` : 'No tienes entrevista pendiente'}</div>
    <ul>${d.acts.map(row).join('')}</ul>
    <button type="button" id="upd" class="upd">⟳ Actualizar</button>
    <div class="foot" id="ts"></div>
    <div class="msg" id="msg2" role="alert"></div>
  </div>`;
  $('res').hidden = false;
  $('upd').onclick = () => lookup(lastCode, true);
  $('ts').textContent = 'Consultado a las ' + new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

let lastCode = '';
async function lookup(code, refresh) {
  const msg = $(refresh ? 'msg2' : 'msg'), btn = refresh ? $('upd') : $('go'), label = btn.textContent;
  msg.textContent = '';
  if (!refresh) $('res').hidden = true;
  if (!code) { msg.textContent = 'Escribe tu código RUDE o C.I.'; return; }
  if (!fs) { msg.textContent = 'La consulta aún no está configurada.'; return; }
  btn.disabled = true; btn.textContent = refresh ? 'Actualizando…' : 'Buscando…';
  try {
    const snap = await getDoc(doc(fs, 'consulta', await hash(code)));
    if (!snap.exists()) { if (refresh) $('res').hidden = true; $('msg').textContent = 'No se encontró ese código. Revisa que esté bien escrito.'; }
    else { lastCode = code; $('go').disabled = false; $('go').textContent = 'Consultar'; show(JSON.parse(snap.data().data)); return; }
  } catch (err) {
    msg.textContent = 'No se pudo consultar. Revisa tu conexión e inténtalo de nuevo.';
  }
  btn.disabled = false; btn.textContent = label;
}
$('f').addEventListener('submit', e => { e.preventDefault(); lookup($('code').value.trim(), false); });
