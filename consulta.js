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
    return `<li class="${cls}"><span>${a.t === 'inv' ? '' : '🖥️ '}${a.im ? `<button type="button" class="alink" data-im="${esc(a.im)}" data-n="${esc(a.n)}">${esc(a.n)}</button>` : esc(a.n)}</span><span class="v ${a.v !== '' ? 'ok' : 'nc'}">${txt}</span></li>`;
  };
  $('res').innerHTML = `<div class="card">
    <h2>${esc(d.name)}</h2>
    <div class="sub">${esc(d.curso)}${d.area ? ' · ' + esc(d.area) : ''}${d.prof ? ' · ' + esc(d.prof) : ''}</div>
    <div class="sum"><div class="s-ok"><b>${done.length}</b>Realizadas</div><div class="s-no"><b>${miss.length}</b>Faltantes</div></div>
    <ul>${counted.map(row).join('')}</ul>
    <button type="button" id="upd" class="upd">⟳ Actualizar</button>
    <div class="foot" id="ts"></div>
    <div class="msg" id="msg2" role="alert"></div>
  </div>`;
  $('res').hidden = false;
  $('upd').onclick = () => lookup(lastCode, true);
  document.querySelectorAll('.alink').forEach(b => b.onclick = () => openImg(b.dataset.im, b.dataset.n));
  $('ts').textContent = 'Consultado a las ' + new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

async function openImg(id, name) {
  $('imT').textContent = name; $('imB').innerHTML = '<div class="imload">Cargando…</div>'; $('imD').showModal();
  try {
    const snap = await getDoc(doc(fs, 'consultaimg', id));
    $('imB').innerHTML = snap.exists() ? '<img alt="">' : '<div class="imload">Imagen no disponible</div>';
    if (snap.exists()) $('imB').firstChild.src = snap.data().data;
  } catch (e) { $('imB').innerHTML = '<div class="imload">No se pudo cargar la imagen</div>'; }
}
$('imX').onclick = () => $('imD').close();
$('imD').addEventListener('click', e => { if (e.target === $('imD')) $('imD').close(); });
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
