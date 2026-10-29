'use strict';
/* Registro Escolar — asistencia y prácticas. Datos locales (localStorage), sin dependencias. */

const KEY = 'registro-escolar-v1';
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const TRIMESTRES = ['1er TRIMESTRE', '2do TRIMESTRE', '3er TRIMESTRE'];
const APROBADO = 51;

/* ---------- utilidades ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad2 = n => String(n).padStart(2, '0');

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function dateLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DIAS[dt.getDay()]},${pad2(d)} ${MESES[m - 1]}`;
}
function newCourse(extra) {
  return Object.assign({
    id: uid(), unidad: '', prof: '', area: '', grado: '', paralelo: '', nivel: '',
    trimestre: TRIMESTRES[0], anio: new Date().getFullYear(),
    students: [], dates: [], items: [], att: {}, grades: {}
  }, extra || {});
}
function defaultDB() {
  const c = newCourse();
  return { v: 1, current: c.id, courses: [c], advance: false };
}
function normalizeDB(d) {
  if (!d || !Array.isArray(d.courses) || !d.courses.length) return defaultDB();
  d.courses = d.courses.map(c => Object.assign(newCourse(), c));
  if (!d.courses.some(c => c.id === d.current)) d.current = d.courses[0].id;
  d.advance = !!d.advance;
  return d;
}
function isNumeric(v) { return v !== '' && v != null && !isNaN(Number(v)); }

/* cálculos (puros, reutilizados por la exportación) */
function attStats(c, sid) {
  const total = c.dates.length;
  let n = 0;
  for (const d of c.dates) if (c.att[sid] && c.att[sid][d.id]) n++;
  return { n, total, pct: total ? Math.round(n * 100 / total) : null };
}
function average(c, sid) {
  const vals = [];
  for (const it of c.items) {
    const v = c.grades[sid] && c.grades[sid][it.id];
    if (isNumeric(v)) vals.push(Number(v));
  }
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

/* ---------- ZIP + XLSX (sin librerías) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(files, mime) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0, cdSize = 0;
  const now = new Date();
  const dd = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const tm = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, tm, true); lh.setUint16(12, dd, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, tm, true); ch.setUint16(14, dd, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    cdSize += 46 + name.length;
    offset += 30 + name.length + data.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: mime });
}

const xmlEsc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function colName(i) { // 0 -> A
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
  return s;
}
/* estilos: 0 normal, 1 encabezado, 2 verde menta, 3 naranja, 4 borde centrado, 5 negrita, 6 encabezado vertical, 7 borde izq, 8 crema, 9 encabezado vertical gris */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF4E7D2E"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF9FF5D0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF4B183"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFDF3E1"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFB9B9B9"/></left><right style="thin"><color rgb="FFB9B9B9"/></right><top style="thin"><color rgb="FFB9B9B9"/></top><bottom style="thin"><color rgb="FFB9B9B9"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" textRotation="90"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" textRotation="90"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(c) {
  const rows = []; // rows[r] = {cells:[], ht}
  const put = (r, col, val, style) => {
    rows[r] = rows[r] || { cells: [] };
    rows[r].cells.push({ col, val, style });
  };
  const ND = c.dates.length, NI = c.items.length;
  const colD = 2, colSum = 2 + ND, colI = colSum + 2, colAvg = colI + NI, colEst = colAvg + 1;

  put(1, 0, c.anio, 5); put(1, 1, c.trimestre, 5);
  put(2, 0, 'UNIDAD:', 5); put(2, 1, c.unidad, 0);
  put(3, 0, 'PROF.:', 5); put(3, 1, c.prof, 0);
  put(4, 0, 'ÁREA:', 5); put(4, 1, c.area, 0);
  put(5, 0, 'GRADO', 5); put(5, 1, `${c.grado}   PARALELO: ${c.paralelo}   NIVEL: ${c.nivel}`, 0);
  put(6, colD, 'ASISTENCIA', 5); put(6, colI, 'PRÁCTICAS, INVESTIGACIONES', 5);

  const H = 7;
  rows[H] = { cells: [], ht: 105 };
  put(H, 0, 'N°', 1); put(H, 1, 'APELLIDOS Y NOMBRES', 1);
  c.dates.forEach((d, i) => put(H, colD + i, dateLabel(d.date), 6));
  put(H, colSum, 'Asist.', 1); put(H, colSum + 1, '%', 1);
  c.items.forEach((it, i) => put(H, colI + i, it.name, it.tipo === 'inv' ? 9 : 6));
  put(H, colAvg, 'Prom.', 1); put(H, colEst, 'Estado', 1);

  c.students.forEach((s, k) => {
    const r = H + 1 + k, ret = !!s.retirado;
    put(r, 0, k + 1, ret ? 3 : 4); put(r, 1, s.name, ret ? 3 : 7);
    c.dates.forEach((d, i) => {
      const on = !ret && c.att[s.id] && c.att[s.id][d.id];
      put(r, colD + i, on ? '✓' : '', ret ? 3 : on ? 2 : 4);
    });
    const st = attStats(c, s.id);
    put(r, colSum, ret ? '' : st.n, ret ? 3 : 4);
    put(r, colSum + 1, ret || st.pct == null ? '' : st.pct, ret ? 3 : 4);
    c.items.forEach((it, i) => {
      const v = c.grades[s.id] && c.grades[s.id][it.id];
      const has = !ret && v !== undefined && v !== '';
      put(r, colI + i, has ? (isNumeric(v) ? Number(v) : v) : '', ret ? 3 : has ? 2 : 8);
    });
    const av = average(c, s.id);
    put(r, colAvg, ret || av == null ? '' : av, ret ? 3 : 4);
    put(r, colEst, ret ? 'RETIRADO' : '', ret ? 3 : 4);
  });

  let xml = '';
  rows.forEach((row, r) => {
    if (!row) return;
    const ht = row.ht ? ` ht="${row.ht}" customHeight="1"` : '';
    xml += `<row r="${r}"${ht}>`;
    row.cells.sort((a, b) => a.col - b.col).forEach(({ col, val, style }) => {
      const ref = colName(col) + r;
      if (typeof val === 'number') xml += `<c r="${ref}" s="${style}"><v>${val}</v></c>`;
      else if (val === '' || val == null) xml += `<c r="${ref}" s="${style}"/>`;
      else xml += `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(val)}</t></is></c>`;
    });
    xml += '</row>';
  });
  const cols = `<cols><col min="1" max="1" width="5" customWidth="1"/><col min="2" max="2" width="38" customWidth="1"/><col min="3" max="${colEst + 1}" width="5.5" customWidth="1"/></cols>`;
  const pane = `<pane xSplit="2" ySplit="${H}" topLeftCell="C${H + 1}" activePane="bottomRight" state="frozen"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${xml}</sheetData></worksheet>`;
}
function courseTitle(c) {
  const t = [c.area, [c.grado, c.paralelo].filter(Boolean).join(' ')].filter(Boolean).join(' ').trim();
  return t || 'Curso sin nombre';
}
function buildXlsx(courses) {
  const used = new Set();
  const names = courses.map((c, i) => {
    let n = courseTitle(c).replace(/[\[\]:*?\/\\]/g, '-').slice(0, 28) || 'Hoja';
    let base = n, k = 2;
    while (used.has(n.toLowerCase())) n = base.slice(0, 26) + ' ' + k++;
    used.add(n.toLowerCase());
    return n;
  });
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${courses.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${courses.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${courses.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES_XML },
    ...courses.map((c, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(c) }))
  ];
  return makeZip(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/* ---------- datos ---------- */
let db;
function load() {
  try { return normalizeDB(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return defaultDB(); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('No se pudo guardar: almacenamiento lleno'); }
}
const C = () => db.courses.find(c => c.id === db.current);

/* ---------- interfaz ---------- */
let tab = 'asistencia';
const $ = s => document.querySelector(s);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2400);
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function openDlg(html, bind, onEnter) {
  const dlg = $('#dlg'), form = $('#dlgForm');
  form.innerHTML = html;
  form.onsubmit = e => { e.preventDefault(); if (onEnter) onEnter(); };
  if (bind) bind(form);
  if (!dlg.open) dlg.showModal();
}
function closeDlg() { const d = $('#dlg'); if (d.open) d.close(); }

function renderHeader() {
  const sel = $('#courseSel');
  sel.innerHTML = db.courses.map(c => `<option value="${c.id}" ${c.id === db.current ? 'selected' : ''}>${esc(courseTitle(c))} · ${esc(c.trimestre)} ${esc(c.anio)}</option>`).join('');
  const c = C();
  const bits = [c.unidad && `"${c.unidad}"`, c.prof, c.nivel].filter(Boolean);
  $('#courseInfo').textContent = bits.join(' · ') || 'Toca ⋮ → Datos del curso para completar la información';
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
}

function render() {
  const main = $('#main');
  const wrap = main.querySelector('.grid-wrap, .list');
  const sx = wrap ? wrap.scrollLeft : 0, sy = wrap ? wrap.scrollTop : 0;
  renderHeader();
  if (tab === 'asistencia') main.innerHTML = viewAsistencia();
  else if (tab === 'practicas') main.innerHTML = viewPracticas();
  else main.innerHTML = viewEstudiantes();
  const w = main.querySelector('.grid-wrap, .list');
  if (w) { w.scrollLeft = sx; w.scrollTop = sy; }
}

function rowHead(c, s, k) {
  return `<td class="c-n">${k + 1}</td><td class="c-name" title="${esc(s.name)}">${esc(s.name)}</td>`;
}
function noStudents() {
  return `<div class="empty">Aún no hay estudiantes.<br><br><button class="btn" data-go="estudiantes">Agregar estudiantes</button></div>`;
}

function viewAsistencia() {
  const c = C();
  let h = `<div class="toolbar"><button class="btn" data-act="add-date">+ Fecha</button>
    <span class="grow stat">${c.dates.length} fechas · ${c.students.filter(s => !s.retirado).length} estudiantes activos</span></div>`;
  if (!c.students.length) return h + noStudents();
  h += `<div class="grid-wrap"><table class="grid"><thead><tr><th class="c-n corner">N°</th><th class="c-name corner">APELLIDOS Y NOMBRES</th>`;
  c.dates.forEach(d => { h += `<th class="col" data-hd="${d.id}"><span>${esc(dateLabel(d.date))}</span></th>`; });
  h += `<th class="sum">%</th></tr></thead><tbody>`;
  c.students.forEach((s, k) => {
    const ret = s.retirado, st = attStats(c, s.id);
    h += `<tr class="${ret ? 'retirado' : ''}">${rowHead(c, s, k)}`;
    c.dates.forEach(d => {
      const on = !ret && c.att[s.id] && c.att[s.id][d.id];
      h += `<td class="cell ${on ? 'on' : ''}" ${ret ? '' : `data-a="${s.id}|${d.id}"`}>${on ? '✓' : ''}</td>`;
    });
    h += `<td class="sum ${st.pct != null && st.pct < 50 ? 'low' : ''}">${ret || st.pct == null ? '' : st.pct + '%'}</td></tr>`;
  });
  return h + `</tbody></table></div>`;
}

function viewPracticas() {
  const c = C();
  let h = `<div class="toolbar"><button class="btn" data-act="add-item" data-tipo="prac">+ Práctica</button>
    <button class="btn sec" data-act="add-item" data-tipo="inv">+ Investigación</button>
    <span class="grow stat">${c.items.length} columnas</span></div>`;
  if (!c.students.length) return h + noStudents();
  h += `<div class="grid-wrap"><table class="grid"><thead><tr><th class="c-n corner">N°</th><th class="c-name corner">APELLIDOS Y NOMBRES</th>`;
  c.items.forEach(it => { h += `<th class="col ${it.tipo === 'inv' ? 'inv' : 'prac'}" data-hi="${it.id}"><span>${esc(it.name)}</span></th>`; });
  h += `<th class="sum">Prom.</th></tr></thead><tbody>`;
  c.students.forEach((s, k) => {
    const ret = s.retirado, av = average(c, s.id);
    h += `<tr class="${ret ? 'retirado' : ''}">${rowHead(c, s, k)}`;
    c.items.forEach(it => {
      const v = c.grades[s.id] && c.grades[s.id][it.id];
      const has = !ret && v !== undefined && v !== '';
      h += `<td class="cell ${has ? 'on' : 'pend'}" ${ret ? '' : `data-g="${s.id}|${it.id}"`}>${has ? esc(v) : ''}</td>`;
    });
    h += `<td class="sum ${av != null && av < APROBADO ? 'low' : ''}">${ret || av == null ? '' : av}</td></tr>`;
  });
  return h + `</tbody></table></div>`;
}

function viewEstudiantes() {
  const c = C();
  let h = `<div class="toolbar"><button class="btn" data-act="add-student">+ Estudiante</button>
    <button class="btn sec" data-act="paste-students">Pegar lista</button>
    <button class="btn sec" data-act="sort-students">Ordenar A–Z</button></div><div class="list">`;
  if (!c.students.length) h += `<div class="empty">Agrega estudiantes uno por uno, o usa <b>Pegar lista</b> para copiar la columna de nombres desde Excel o Word.</div>`;
  c.students.forEach((s, k) => {
    h += `<div class="stu ${s.retirado ? 'ret' : ''}"><span class="n">${k + 1}</span><span class="nm">${esc(s.name)}${s.retirado ? ' <b>(RETIRADO)</b>' : ''}</span><button data-edit="${s.id}">Editar</button></div>`;
  });
  return h + `</div>`;
}

/* ---------- acciones ---------- */
function addDateDialog() {
  openDlg(`<h3>Nueva fecha de clase</h3>
    <label>Fecha<input type="date" id="dv" value="${todayISO()}"></label>
    <div class="actions"><button type="button" class="btn sec" id="cx">Cancelar</button><button class="btn" id="ok">Agregar</button></div>`,
    f => {
      f.querySelector('#cx').onclick = closeDlg;
      f.querySelector('#ok').onclick = doAdd;
    }, doAdd);
  function doAdd() {
    const v = $('#dv').value; if (!v) return;
    const c = C();
    if (c.dates.some(d => d.date === v)) { toast('Esa fecha ya existe'); return; }
    c.dates.push({ id: uid(), date: v });
    c.dates.sort((a, b) => a.date.localeCompare(b.date));
    save(); closeDlg(); render();
  }
}
function editDateDialog(did) {
  const c = C(), d = c.dates.find(x => x.id === did); if (!d) return;
  openDlg(`<h3>${esc(dateLabel(d.date))}</h3>
    <label>Fecha<input type="date" id="dv" value="${d.date}"></label>
    <div class="actions"><button type="button" class="btn sec" id="all">Todos presentes</button><button type="button" class="btn sec" id="none">Limpiar</button></div>
    <div class="actions"><button type="button" class="btn danger" id="del">Eliminar fecha</button><button type="button" class="btn sec" id="cx">Cancelar</button><button class="btn" id="ok">Guardar</button></div>`,
    f => {
      f.querySelector('#cx').onclick = closeDlg;
      f.querySelector('#all').onclick = () => {
        c.students.forEach(s => { if (!s.retirado) { (c.att[s.id] = c.att[s.id] || {})[d.id] = true; } });
        save(); closeDlg(); render(); toast('Todos marcados como presentes');
      };
      f.querySelector('#none').onclick = () => {
        c.students.forEach(s => { if (c.att[s.id]) delete c.att[s.id][d.id]; });
        save(); closeDlg(); render();
      };
      f.querySelector('#del').onclick = () => {
        if (!confirm('¿Eliminar esta fecha y sus asistencias?')) return;
        c.dates = c.dates.filter(x => x.id !== d.id);
        Object.values(c.att).forEach(m => delete m[d.id]);
        save(); closeDlg(); render();
      };
      f.querySelector('#ok').onclick = doSave;
    }, doSave);
  function doSave() {
    const v = $('#dv').value; if (!v) return;
    if (c.dates.some(x => x.date === v && x.id !== d.id)) { toast('Esa fecha ya existe'); return; }
    d.date = v; c.dates.sort((a, b) => a.date.localeCompare(b.date));
    save(); closeDlg(); render();
  }
}

function itemDialog(iid, tipo) {
  const c = C(), it = iid ? c.items.find(x => x.id === iid) : null;
  const t = it ? it.tipo : tipo;
  const n = c.items.filter(x => x.tipo === t).length + 1;
  const sugg = it ? it.name : (t === 'inv' ? `INVESTIGACION ${n}` : `P${n}-`);
  openDlg(`<h3>${it ? 'Editar columna' : t === 'inv' ? 'Nueva investigación' : 'Nueva práctica'}</h3>
    <label>Nombre<input id="iv" value="${esc(sugg)}" maxlength="40" autocomplete="off"></label>
    <label>Tipo<select id="it"><option value="prac" ${t !== 'inv' ? 'selected' : ''}>Práctica</option><option value="inv" ${t === 'inv' ? 'selected' : ''}>Investigación</option></select></label>
    <div class="actions">${it ? '<button type="button" class="btn danger" id="del">Eliminar</button>' : ''}<button type="button" class="btn sec" id="cx">Cancelar</button><button class="btn" id="ok">Guardar</button></div>`,
    f => {
      f.querySelector('#cx').onclick = closeDlg;
      f.querySelector('#ok').onclick = doSave;
      const del = f.querySelector('#del');
      if (del) del.onclick = () => {
        if (!confirm('¿Eliminar esta columna y sus notas?')) return;
        c.items = c.items.filter(x => x.id !== it.id);
        Object.values(c.grades).forEach(m => delete m[it.id]);
        save(); closeDlg(); render();
      };
      setTimeout(() => { const i = f.querySelector('#iv'); i.focus(); i.select(); }, 50);
    }, doSave);
  function doSave() {
    const name = $('#iv').value.trim(); if (!name) return;
    const tp = $('#it').value;
    if (it) { it.name = name; it.tipo = tp; } else c.items.push({ id: uid(), name, tipo: tp });
    save(); closeDlg(); render();
  }
}

function gradeDialog(sid, iid) {
  const c = C(), s = c.students.find(x => x.id === sid), it = c.items.find(x => x.id === iid);
  if (!s || !it) return;
  const cur = (c.grades[sid] && c.grades[sid][iid]) ?? '';
  const quick = ['100', '90', '80', '70', '60', '50', 'P', 'P1'];
  openDlg(`<h3>${esc(it.name)}</h3><div class="stat">${esc(s.name)}</div>
    <div class="quick">${quick.map(v => `<button type="button" data-v="${v}" class="${v === String(cur) ? 'sel' : ''}">${v}</button>`).join('')}</div>
    <label>Otra nota o texto<input id="gv" value="${esc(cur)}" maxlength="8" autocomplete="off"></label>
    <label style="flex-direction:row;align-items:center;gap:8px;font-size:14px;color:#333"><input type="checkbox" id="adv" style="width:auto" ${db.advance ? 'checked' : ''}> Pasar al siguiente estudiante</label>
    <div class="actions"><button type="button" class="btn sec" id="clr">Borrar nota</button><button type="button" class="btn sec" id="cx">Cerrar</button><button class="btn" id="ok">Guardar</button></div>`,
    f => {
      f.querySelector('#cx').onclick = closeDlg;
      f.querySelectorAll('.quick button').forEach(b => b.onclick = () => commit(b.dataset.v));
      f.querySelector('#clr').onclick = () => commit('');
      f.querySelector('#ok').onclick = () => commit($('#gv').value.trim());
      if (!matchMedia('(pointer:coarse)').matches) setTimeout(() => { const i = f.querySelector('#gv'); i.focus(); i.select(); }, 50);
    }, () => commit($('#gv').value.trim()));
  function commit(v) {
    db.advance = $('#adv').checked;
    c.grades[sid] = c.grades[sid] || {};
    if (v === '') delete c.grades[sid][iid]; else c.grades[sid][iid] = v;
    save(); render();
    if (db.advance) {
      const idx = c.students.findIndex(x => x.id === sid);
      const next = c.students.slice(idx + 1).find(x => !x.retirado);
      if (next) { gradeDialog(next.id, iid); return; }
      toast('Fin de la lista');
    }
    closeDlg();
  }
}

function studentDialog(sid) {
  const c = C(), s = sid ? c.students.find(x => x.id === sid) : null;
  openDlg(`<h3>${s ? 'Editar estudiante' : 'Nuevo estudiante'}</h3>
    <label>Apellidos y nombres<input id="sn" value="${esc(s ? s.name : '')}" maxlength="80" autocomplete="off"></label>
    ${s ? `<label style="flex-direction:row;align-items:center;gap:8px;font-size:14px;color:#333"><input type="checkbox" id="sr" style="width:auto" ${s.retirado ? 'checked' : ''}> Retirado</label>` : ''}
    <div class="actions">${s ? '<button type="button" class="btn danger" id="del">Eliminar</button>' : ''}<button type="button" class="btn sec" id="cx">Cancelar</button><button class="btn" id="ok">Guardar</button></div>`,
    f => {
      f.querySelector('#cx').onclick = closeDlg;
      f.querySelector('#ok').onclick = doSave;
      const del = f.querySelector('#del');
      if (del) del.onclick = () => {
        if (!confirm('¿Eliminar este estudiante y todos sus registros? (Si solo dejó el curso, márcalo como Retirado)')) return;
        c.students = c.students.filter(x => x.id !== s.id);
        delete c.att[s.id]; delete c.grades[s.id];
        save(); closeDlg(); render();
      };
      setTimeout(() => f.querySelector('#sn').focus(), 50);
    }, doSave);
  function doSave() {
    const name = $('#sn').value.trim(); if (!name) return;
    if (s) { s.name = name; s.retirado = $('#sr').checked; }
    else c.students.push({ id: uid(), name, retirado: false });
    save(); closeDlg(); render();
  }
}

function pasteDialog() {
  openDlg(`<h3>Pegar lista de estudiantes</h3>
    <div class="stat">Un estudiante por línea. Si pegas desde Excel con números de lista (1, 2, 3…), se ignoran automáticamente.</div>
    <textarea id="pl" placeholder="APOMA CARMEN NAYELI&#10;ACARAPI MAMANI JOSE MANUEL&#10;…"></textarea>
    <div class="actions"><button type="button" class="btn sec" id="cx">Cancelar</button><button type="button" class="btn" id="ok">Agregar</button></div>`,
    f => {
      f.querySelector('#cx').onclick = closeDlg;
      f.querySelector('#ok').onclick = () => {
        const c = C();
        const lines = $('#pl').value.split(/\r?\n/).map(l => {
          const parts = l.split('\t').map(p => p.trim()).filter(Boolean);
          const withLetters = parts.filter(p => /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(p));
          return (withLetters.sort((a, b) => b.length - a.length)[0] || '').replace(/^\d+[\.\)\-]?\s+/, '').trim();
        }).filter(Boolean);
        lines.forEach(name => c.students.push({ id: uid(), name, retirado: false }));
        save(); closeDlg(); render(); toast(`${lines.length} estudiantes agregados`);
      };
      setTimeout(() => f.querySelector('#pl').focus(), 50);
    });
}

function courseDialog(isNew) {
  const c = isNew ? newCourse() : C();
  const f = (id, label, v, ph) => `<label>${label}<input id="${id}" value="${esc(v)}" placeholder="${esc(ph || '')}" autocomplete="off"></label>`;
  openDlg(`<h3>${isNew ? 'Nuevo curso' : 'Datos del curso'}</h3>
    ${f('c_unidad', 'Unidad', c.unidad, 'LOS ANDES MAÑANA')}
    ${f('c_prof', 'Profesor(a)', c.prof)}
    ${f('c_area', 'Área', c.area, 'COMPUTACIÓN')}
    <div class="row">${f('c_grado', 'Grado', c.grado, '5°')}${f('c_par', 'Paralelo', c.paralelo, 'C')}</div>
    ${f('c_nivel', 'Nivel', c.nivel, 'Secundaria')}
    <div class="row"><label>Trimestre<select id="c_tri">${TRIMESTRES.map(t => `<option ${t === c.trimestre ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    ${f('c_anio', 'Año', c.anio)}</div>
    <div class="actions"><button type="button" class="btn sec" id="cx">Cancelar</button><button class="btn" id="ok">Guardar</button></div>`,
    form => {
      form.querySelector('#cx').onclick = closeDlg;
      form.querySelector('#ok').onclick = doSave;
    }, doSave);
  function doSave() {
    c.unidad = $('#c_unidad').value.trim(); c.prof = $('#c_prof').value.trim(); c.area = $('#c_area').value.trim();
    c.grado = $('#c_grado').value.trim(); c.paralelo = $('#c_par').value.trim(); c.nivel = $('#c_nivel').value.trim();
    c.trimestre = $('#c_tri').value; c.anio = Number($('#c_anio').value) || c.anio;
    if (isNew) { db.courses.push(c); db.current = c.id; }
    save(); closeDlg(); render();
  }
}

function doExportXlsx() {
  download(buildXlsx(db.courses), `registro-escolar-${todayISO()}.xlsx`);
  toast('Excel exportado (todos los cursos, una hoja por curso)');
}
function doExportJson() {
  download(new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' }), `copia-registro-${todayISO()}.json`);
  toast('Copia de seguridad descargada');
}
function doImportJson(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || !Array.isArray(d.courses)) throw new Error('formato');
      if (!confirm('Esto reemplazará TODOS los datos actuales de este dispositivo. ¿Continuar?')) return;
      db = normalizeDB(d); save(); render(); toast('Copia restaurada');
    } catch (e) { toast('Archivo no válido'); }
  };
  r.readAsText(file);
}

function onMenu(act) {
  $('#menu').classList.add('hidden');
  if (act === 'curso-datos') courseDialog(false);
  else if (act === 'curso-nuevo') courseDialog(true);
  else if (act === 'export-xlsx') doExportXlsx();
  else if (act === 'export-json') doExportJson();
  else if (act === 'import-json') $('#fileJson').click();
  else if (act === 'curso-borrar') {
    if (db.courses.length === 1) {
      if (!confirm('Es el único curso. ¿Vaciar todos sus datos?')) return;
      const n = newCourse(); db.courses = [n]; db.current = n.id;
    } else {
      if (!confirm(`¿Eliminar el curso "${courseTitle(C())}" con todos sus datos?`)) return;
      db.courses = db.courses.filter(c => c.id !== db.current); db.current = db.courses[0].id;
    }
    save(); render();
  }
}

function init() {
  db = load();
  $('#courseSel').onchange = e => { db.current = e.target.value; save(); render(); };
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  $('#btnMenu').onclick = e => { e.stopPropagation(); $('#menu').classList.toggle('hidden'); };
  document.addEventListener('click', e => { if (!e.target.closest('#menu')) $('#menu').classList.add('hidden'); });
  $('#menu').addEventListener('click', e => { const b = e.target.closest('button'); if (b) onMenu(b.dataset.act); });
  $('#fileJson').onchange = e => { if (e.target.files[0]) doImportJson(e.target.files[0]); e.target.value = ''; };

  $('#main').addEventListener('click', e => {
    const t = e.target;
    let el;
    if ((el = t.closest('[data-a]'))) {
      const [sid, did] = el.dataset.a.split('|'), c = C();
      c.att[sid] = c.att[sid] || {};
      if (c.att[sid][did]) delete c.att[sid][did]; else c.att[sid][did] = true;
      save(); render();
    } else if ((el = t.closest('[data-g]'))) {
      const [sid, iid] = el.dataset.g.split('|'); gradeDialog(sid, iid);
    } else if ((el = t.closest('[data-hd]'))) editDateDialog(el.dataset.hd);
    else if ((el = t.closest('[data-hi]'))) itemDialog(el.dataset.hi);
    else if ((el = t.closest('[data-edit]'))) studentDialog(el.dataset.edit);
    else if ((el = t.closest('[data-go]'))) { tab = el.dataset.go; render(); }
    else if ((el = t.closest('[data-act]'))) {
      const a = el.dataset.act;
      if (a === 'add-date') addDateDialog();
      else if (a === 'add-item') itemDialog(null, el.dataset.tipo);
      else if (a === 'add-student') studentDialog(null);
      else if (a === 'paste-students') pasteDialog();
      else if (a === 'sort-students') { C().students.sort((x, y) => x.name.localeCompare(y.name, 'es')); save(); render(); toast('Lista ordenada A–Z'); }
    }
  });

  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

if (typeof document !== 'undefined' && document.getElementById) init();
if (typeof module !== 'undefined') module.exports = { buildXlsx, newCourse, attStats, average, dateLabel, normalizeDB };
