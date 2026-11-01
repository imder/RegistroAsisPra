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
  return { v: 1, current: c.id, courses: [c], advance: false, tombstones: [] };
}
function normalizeDB(d) {
  if (!d || !Array.isArray(d.courses) || !d.courses.length) return defaultDB();
  d.courses = d.courses.map(c => Object.assign(newCourse(), c));
  if (!d.courses.some(c => c.id === d.current)) d.current = d.courses[0].id;
  d.advance = !!d.advance;
  d.tombstones = Array.isArray(d.tombstones) ? d.tombstones : [];
  return d;
}
/* ---------- pegar desde Excel (lógica pura) ---------- */
function normName(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}
function parsePaste(text) {
  const rows = String(text || '').replace(/\r/g, '').split('\n').map(l => l.split('\t').map(x => x.trim()));
  while (rows.length && rows[rows.length - 1].every(x => x === '')) rows.pop();
  return rows;
}
const nameLike = v => /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(v) && /\s/.test(v.trim()) && v.trim().length > 6;
function detectNameCol(rows) {
  const maxc = Math.min(3, Math.max(0, ...rows.map(r => r.length)));
  for (let k = 0; k < maxc; k++) {
    const vals = rows.map(r => r[k]).filter(v => v);
    if (vals.length >= 1 && vals.filter(nameLike).length / vals.length >= 0.6) return k;
  }
  return -1;
}
function isNumbering(rows, k) {
  const vals = rows.map(r => r[k]).filter(v => v !== undefined && v !== '');
  return vals.length >= 2 && vals.every((v, i) => /^\d{1,3}$/.test(v) && Number(v) === Number(vals[0]) + i);
}
function looksLikeHeader(rows) {
  if (rows.length < 2) return false;
  const first = rows[0].filter(x => x);
  if (!first.length) return false;
  if (first.some(x => /apellid|nombre|n[°º]/i.test(x))) return true;
  const isData = x => /^[\d.,]+$/.test(x) || /^[✓✔☑✅]/.test(x);
  return first.every(x => !isData(x)) && rows.slice(1).some(r => r.some(isData));
}
const PRESENT = ['✓', '✔', '✔️', '✅', '☑', '☑️', '1', 'si', 'sí', 's', 'true', 'p', 'presente', 'asistio', 'asistió'];
const LICENCIA = ['l', 'lic', 'licencia'], BANDA = ['b', 'banda'];
const ABSENT = ['0', 'f', 'falta', 'n', 'no', 'false', '-', '–', 'ausente'];
function attMark(v) {
  const t = String(v || '').trim().toLowerCase();
  if (PRESENT.includes(t)) return true;
  if (LICENCIA.includes(t)) return 'L';
  if (BANDA.includes(t)) return 'B';
  if (ABSENT.includes(t)) return false;
  return null;
}
/* Calcula qué se escribiría. kind: 'att' | 'prac'. o: {header, labels, clear, startSid, startCol} */
function planPaste(c, kind, rows, o) {
  const cols = kind === 'att' ? c.dates : c.items;
  let r = rows.slice();
  if (o.header) r = r.slice(1);
  const nameIdx = o.labels ? detectNameCol(r) : -1;
  const lead = !o.labels ? 0 : nameIdx >= 0 ? nameIdx + 1 : (isNumbering(r, 0) ? 1 : 0);
  const plan = { writes: [], rows: r.length, dataCols: 0, overflow: 0, unmatched: [], retired: 0, replaced: 0, unknown: 0, byName: false, matched: 0, students: 0 };
  plan.dataCols = Math.max(0, ...r.map(x => x.length - lead));
  const startCol = Math.max(0, cols.findIndex(x => x.id === o.startCol));
  plan.overflow = Math.max(0, plan.dataCols - (cols.length - startCol));
  // a qué estudiante corresponde cada fila
  let targets = [];
  if (nameIdx >= 0) {
    const byKey = new Map(), byTokens = new Map();
    c.students.forEach(s => {
      byKey.set(normName(s.name), s);
      byTokens.set(normName(s.name).split(' ').sort().join(' '), s);
    });
    targets = r.map(row => {
      const n = row[nameIdx]; if (!n) return null;
      const k = normName(n);
      return byKey.get(k) || byTokens.get(k.split(' ').sort().join(' ')) || { missing: n };
    });
    plan.matched = targets.filter(t => t && !t.missing).length;
    plan.byName = plan.matched > 0;
  }
  if (!plan.byName) {
    const si = Math.max(0, c.students.findIndex(x => x.id === o.startSid));
    targets = r.map((_, i) => c.students[si + i] || null);
  }
  const seen = new Set();
  r.forEach((row, i) => {
    const s = targets[i];
    if (s && s.missing) { plan.unmatched.push(s.missing); return; }
    if (!s) return;
    if (s.retirado) { plan.retired++; return; }
    seen.add(s.id);
    for (let j = 0; j < plan.dataCols; j++) {
      const col = cols[startCol + j]; if (!col) break;
      const raw = (row[lead + j] || '').trim();
      if (kind === 'prac') {
        const cur = c.grades[s.id] && c.grades[s.id][col.id];
        const has = cur !== undefined && cur !== '';
        if (raw === '') { if (o.clear && has) { plan.writes.push({ sid: s.id, col: col.id, v: '' }); plan.replaced++; } continue; }
        if (String(cur) === raw) continue;
        if (has) plan.replaced++;
        plan.writes.push({ sid: s.id, col: col.id, v: raw.slice(0, 12) });
      } else {
        const cur = (c.att[s.id] && c.att[s.id][col.id]) || false;
        let m = attMark(raw);
        if (raw === '') { if (!o.clear) continue; m = false; }
        if (m === null) { plan.unknown++; continue; }
        if (m === cur) continue;
        plan.writes.push({ sid: s.id, col: col.id, v: m });
      }
    }
  });
  plan.students = seen.size;
  return plan;
}

const attGlyph = v => v === true ? '✓' : (v || '');
const attClass = v => v === true ? 'on' : v === 'L' ? 'lic' : v === 'B' ? 'ban' : '';
const itemLabel = it => (it.tipo === 'inv' ? '' : '🖥️ ') + it.name;   // las prácticas llevan icono de computadora
function setAtt(c, sid, did, v) {
  c.att[sid] = c.att[sid] || {};
  if (v) c.att[sid][did] = v; else delete c.att[sid][did];
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
<fills count="9"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF4E7D2E"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF9FF5D0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE49EDD"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFDF3E1"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFBDD7EE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFE699"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFB9B9B9"/></left><right style="thin"><color rgb="FFB9B9B9"/></right><top style="thin"><color rgb="FFB9B9B9"/></top><bottom style="thin"><color rgb="FFB9B9B9"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
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
<xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
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
  const colD = 2, colI = 2 + ND, colEst = colI + NI;

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
  c.items.forEach((it, i) => put(H, colI + i, itemLabel(it), it.tipo === 'inv' ? 9 : 6));
  put(H, colEst, 'Estado', 1);

  c.students.forEach((s, k) => {
    const r = H + 1 + k, ret = !!s.retirado;
    put(r, 0, k + 1, ret ? 3 : 4); put(r, 1, s.name, ret ? 3 : 7);
    c.dates.forEach((d, i) => {
      const v = !ret && c.att[s.id] && c.att[s.id][d.id];
      put(r, colD + i, attGlyph(v), ret ? 3 : v === true ? 2 : v === 'L' ? 10 : v === 'B' ? 11 : 4);
    });
    c.items.forEach((it, i) => {
      const v = c.grades[s.id] && c.grades[s.id][it.id];
      const has = !ret && v !== undefined && v !== '';
      put(r, colI + i, has ? (isNumeric(v) ? Number(v) : v) : '', ret ? 3 : has ? 2 : 8);
    });
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
  const cols = `<cols><col min="1" max="1" width="5" customWidth="1"/><col min="2" max="2" width="38" customWidth="1"/><col min="3" max="${colEst}" width="5.5" customWidth="1"/><col min="${colEst + 1}" max="${colEst + 1}" width="12" customWidth="1"/></cols>`;
  const pane = `<pane xSplit="2" ySplit="${H}" topLeftCell="C${H + 1}" activePane="bottomRight" state="frozen"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${xml}</sheetData></worksheet>`;
}
function triShort(t) { const m = /^(\d)/.exec(t || ''); return m ? m[1] + 'T' : (t || ''); }
function courseShort(c) {
  const left = [c.grado, c.paralelo].filter(Boolean).join('');
  const t = [left, c.nivel].filter(Boolean).join(' ');
  return [t || 'Curso sin nombre', triShort(c.trimestre)].filter(Boolean).join('-');
}
function sheetName(c) {
  const lvl = { primaria: 'Prim', secundaria: 'Sec' }[String(c.nivel || '').toLowerCase()] || c.nivel;
  return [c.grado, c.paralelo, lvl].filter(Boolean).join(' ') || 'Hoja';
}
function courseTitle(c) {
  const t = [c.area, [c.grado, c.paralelo].filter(Boolean).join(' ')].filter(Boolean).join(' ').trim();
  return t || 'Curso sin nombre';
}
function buildXlsx(courses) {
  const used = new Set();
  const names = courses.map((c, i) => {
    let n = sheetName(c).replace(/[\[\]:*?\/\\]/g, '-').slice(0, 28) || 'Hoja';
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
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('No se pudo guardar: almacenamiento lleno'); }
}
/* save(): guarda en el dispositivo y marca el curso actual como modificado (se sube a la nube).
   save(null): solo guarda (p. ej. cambiar de curso). save(curso): marca ese curso. */
function save(course) {
  const c = course === undefined ? C() : course;
  if (c) c.updatedAt = Date.now();
  persist();
  if (c && typeof Sync !== 'undefined') Sync.queue();
}
const C = () => db.courses.find(c => c.id === db.current);

/* ---------- sincronización: lógica de fusión (pura) ---------- */
function isPristine(c) {
  return !c.students.length && !c.dates.length && !c.items.length && !c.unidad && !c.prof && !c.area && !c.grado && !c.paralelo && !c.nivel;
}
/* Aplica los cursos recibidos de la nube. Gana la versión con updatedAt más reciente (por curso). */
function mergeRemote(d, docs) {
  let changed = false;
  const tomb = new Map((d.tombstones || []).map(t => [t.id, t.updatedAt || 0]));
  for (const r of docs) {
    const local = d.courses.find(c => c.id === r.id);
    const localTime = local ? (local.updatedAt || 0) : (tomb.get(r.id) || 0);
    if (!(r.updatedAt > localTime)) continue;
    if (r.deleted) {
      if (local) { d.courses = d.courses.filter(c => c.id !== r.id); changed = true; }
      continue;
    }
    let parsed;
    try { parsed = JSON.parse(r.data); } catch (e) { continue; }
    const c = Object.assign(newCourse(), parsed, { id: r.id, updatedAt: r.updatedAt });
    if (local) d.courses[d.courses.indexOf(local)] = c; else d.courses.push(c);
    changed = true;
  }
  if (changed) {
    // el curso vacío de fábrica sobra cuando llegan cursos reales de la nube
    if (d.courses.some(c => !(!c.updatedAt && isPristine(c)))) d.courses = d.courses.filter(c => c.updatedAt || !isPristine(c));
    if (!d.courses.length) { const n = newCourse(); d.courses = [n]; }
    if (!d.courses.some(c => c.id === d.current)) d.current = d.courses[0].id;
  }
  return changed;
}
/* Qué hay que subir: cursos nuevos o más recientes que la nube, y cursos eliminados. */
function pendingWrites(d, remote) {
  const out = [];
  for (const c of d.courses) {
    if (!c.updatedAt) { if (isPristine(c)) continue; c.updatedAt = Date.now(); }
    const r = remote[c.id];
    if (!r || c.updatedAt > r.updatedAt) out.push({ id: c.id, payload: { data: JSON.stringify(c), updatedAt: c.updatedAt, deleted: false } });
  }
  for (const t of d.tombstones || []) {
    const r = remote[t.id];
    if (!d.courses.some(c => c.id === t.id) && (!r || t.updatedAt > r.updatedAt)) out.push({ id: t.id, payload: { data: '', updatedAt: t.updatedAt, deleted: true } });
  }
  return out;
}

/* ---------- sincronización: conexión con Firebase (sync.js) ---------- */
const Sync = {
  tr: null, user: null, state: 'off', msg: '', ready: false, remote: {}, t: null, sent: {},
  set(state, msg) {
    this.state = state; this.msg = msg || '';
    const b = typeof document !== 'undefined' && document.getElementById('btnSync');
    if (b) { b.dataset.s = state; b.title = this.label(); }
  },
  label() {
    return ({
      off: 'Sincronización sin configurar', signedout: 'Sin iniciar sesión', connecting: 'Conectando…',
      ok: 'Sincronizado', syncing: 'Sincronizando…', offline: 'Sin conexión: se subirá al volver', error: 'Error de sincronización'
    })[this.state] || '';
  },
  async init() {
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey || /^PEGA/.test(cfg.apiKey) || !cfg.projectId) { this.set('off'); return; }
    try {
      const m = await import('./sync.js');
      this.tr = m.createTransport(cfg);
    } catch (e) { this.set('error', 'No se pudo cargar Firebase. Abre la app una vez con internet.'); return; }
    this.set('signedout');
    this.tr.onAuth(user => {
      this.user = user; this.ready = false; this.remote = {}; this.sent = {};
      if (!user) { this.tr.unlisten(); this.set('signedout'); return; }
      this.set('connecting');
      this.tr.listen(user.uid, (docs, meta) => this.onRemote(docs, meta), err => this.set('error', err && err.message));
    });
  },
  onRemote(docs, meta) {
    this.remote = {};
    docs.forEach(r => { this.remote[r.id] = r; });
    if (mergeRemote(db, docs)) { persist(); render(); }
    this.ready = true;
    this.flush();
    if (meta && meta.pending) this.set('syncing');
    else if (meta && meta.fromCache && !navigator.onLine) this.set('offline');
    else this.set('ok');
  },
  queue() { clearTimeout(this.t); this.t = setTimeout(() => this.flush(), 600); },
  flush() {
    if (!this.tr || !this.user || !this.ready) return;
    const jobs = pendingWrites(db, this.remote);
    for (const j of jobs) {
      if (this.sent[j.id] === j.payload.updatedAt) continue;
      this.sent[j.id] = j.payload.updatedAt;
      this.set('syncing');
      this.tr.write(this.user.uid, j.id, j.payload).catch(e => { delete this.sent[j.id]; this.set('error', e && e.message); });
    }
    persist();
  },
  dialog() {
    const s = this.state, u = this.user;
    let body;
    if (s === 'off') body = `<p>La sincronización aún no está configurada. Edita el archivo <b>firebase-config.js</b> con los datos de tu proyecto Firebase (instrucciones en <b>SINCRONIZACION.md</b>) y vuelve a subir la app.</p>`;
    else if (!u) body = `<p>Inicia sesión con tu cuenta de Google para sincronizar este dispositivo. Usa la <b>misma cuenta</b> en el celular y en la computadora.</p>${s === 'error' ? `<p class="stat">${esc(this.msg)}</p>` : ''}<div class="actions"><button type="button" class="btn" id="si">Iniciar sesión con Google</button></div>`;
    else body = `<p>Cuenta: <b>${esc(u.email || u.displayName || '')}</b><br>Estado: <b>${esc(this.label())}</b></p>${s === 'error' ? `<p class="stat">${esc(this.msg)}</p>` : ''}<div class="actions"><button type="button" class="btn sec" id="now">Sincronizar ahora</button><button type="button" class="btn danger" id="so">Cerrar sesión</button></div>`;
    openDlg(`<h3>Sincronización</h3>${body}<div class="actions"><button type="button" class="btn sec" id="cx">Cerrar</button></div>`, f => {
      f.querySelector('#cx').onclick = closeDlg;
      const si = f.querySelector('#si');
      if (si) si.onclick = () => { closeDlg(); this.tr.signIn().catch(e => { this.set('error', e && e.message); toast('No se pudo iniciar sesión'); }); };
      const so = f.querySelector('#so');
      if (so) so.onclick = () => { closeDlg(); this.tr.signOut(); };
      const now = f.querySelector('#now');
      if (now) now.onclick = () => { this.sent = {}; this.flush(); closeDlg(); toast('Sincronizando…'); };
    });
  }
};

/* ---------- interfaz ---------- */
let tab = 'asistencia';
let activeSid = null;                       // estudiante que se está calificando / marcando
const QUICK = ['100', '90', '80', '70', '60', '50'];   // notas rápidas del panel de calificación
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
function reserveSheet() {
  const d = $('#dlg');
  const on = d.open && d.classList.contains('sheet');
  document.body.classList.toggle('sheet-open', on);
  $('#main').style.paddingBottom = on ? d.offsetHeight + 'px' : '';
}
function openDlg(html, bind, onEnter, sheet) {
  const dlg = $('#dlg'), form = $('#dlgForm');
  if (dlg.open && dlg.classList.contains('sheet') !== !!sheet) dlg.close();
  dlg.classList.toggle('sheet', !!sheet);
  form.innerHTML = html;
  form.onsubmit = e => { e.preventDefault(); if (onEnter) onEnter(); };
  if (bind) bind(form);
  // el botón Guardar es de tipo submit: su clic ya ejecuta la acción, así que se evita que además se envíe el formulario (duplicaba registros)
  const ok = form.querySelector('#ok');
  if (ok && ok.onclick) { const h = ok.onclick; ok.onclick = e => { e.preventDefault(); h.call(ok, e); }; }
  if (!dlg.open) { if (sheet) dlg.show(); else dlg.showModal(); }
  if (sheet) reserveSheet();
}
function closeDlg() { const d = $('#dlg'); if (d.open) d.close(); }

function renderHeader() {
  const sel = $('#courseSel');
  sel.innerHTML = db.courses.map(c => `<option value="${c.id}" ${c.id === db.current ? 'selected' : ''}>${esc(courseShort(c))}</option>`).join('');
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

function scrollToActive() {
  const wrap = $('#main .grid-wrap'), tr = $('#main tr.active');
  if (!wrap || !tr) return;
  const w = wrap.getBoundingClientRect(), r = tr.getBoundingClientRect();
  const top = w.top + (wrap.querySelector('thead') ? wrap.querySelector('thead').offsetHeight : 0);
  if (r.top < top) wrap.scrollTop -= top - r.top + 4;
  else if (r.bottom > w.bottom) wrap.scrollTop += r.bottom - w.bottom + 4;
}
/* Separa "APELLIDOS NOMBRES": por defecto los 2 primeros apellidos (con partículas DE/LA/DEL…) y el resto son nombres.
   Si el nombre lleva una coma, manda la coma: "QUISPE, JUAN CARLOS". */
const PARTICLES = ['DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'VDA', 'Y'];
function splitName(full) {
  const t = String(full || '').replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ]+/, '').trim();
  if (t.includes(',')) { const i = t.indexOf(','); return [t.slice(0, i).trim(), t.slice(i + 1).trim()]; }
  const w = t.split(/\s+/).filter(Boolean);
  if (w.length <= 1) return [t, ''];
  const group = i => { let j = i; while (j < w.length - 1 && PARTICLES.includes(w[j].toUpperCase())) j++; return j + 1; };
  const e1 = group(0);
  if (e1 >= w.length) return [w.join(' '), ''];
  const e2 = group(e1);
  const end = w.length - e2 >= 1 ? e2 : e1;
  return [w.slice(0, end).join(' '), w.slice(end).join(' ')];
}
function nameHtml(n, ret) {
  const [a, b] = splitName(n);
  const tag = ret ? ' <span class="rt">(R)</span>' : '';
  return b ? `<span class="ap">${esc(a)}</span> <span class="no">${esc(b)}${tag}</span>` : `<span class="ap">${esc(a)}${tag}</span>`;
}
function rowHead(c, s, k) {
  return `<td class="c-n">${k + 1}</td><td class="c-name" ${s.retirado ? '' : `data-sid="${s.id}"`} title="${esc(s.name)}">${nameHtml(s.name, s.retirado)}</td>`;
}
function noStudents() {
  return `<div class="empty">Aún no hay estudiantes.<br><br><button class="btn" data-go="estudiantes">Agregar estudiantes</button></div>`;
}

function viewAsistencia() {
  const c = C();
  let h = `<div class="toolbar"><button class="btn" data-act="add-date">+ Fecha</button>
    <button class="btn sec" data-act="paste-att">Pegar de Excel</button><button class="btn sec" data-act="reorder-dates">Ordenar</button>${undoBtn('att')}
    <span class="grow stat hint">${c.dates.length} fechas</span></div>`;
  if (!c.students.length) return h + noStudents();
  h += `<div class="grid-wrap"><table class="grid"><thead><tr><th class="c-n corner">N°</th><th class="c-name corner">APELLIDOS Y NOMBRES</th>`;
  c.dates.forEach(d => { h += `<th class="col" data-hd="${d.id}"><span>${esc(dateLabel(d.date))}</span></th>`; });
  h += `</tr></thead><tbody>`;
  c.students.forEach((s, k) => {
    const ret = s.retirado;
    h += `<tr class="${ret ? 'retirado' : s.id === activeSid ? 'active' : ''}">${rowHead(c, s, k)}`;
    c.dates.forEach(d => {
      const v = !ret && c.att[s.id] && c.att[s.id][d.id];
      h += `<td class="cell ${attClass(v)}" ${ret ? '' : `data-a="${s.id}|${d.id}"`}>${esc(attGlyph(v))}</td>`;
    });
    h += `</tr>`;
  });
  return h + `</tbody></table></div>`;
}

function viewPracticas() {
  const c = C();
  let h = `<div class="toolbar"><button class="btn" data-act="add-item">+ Actividad</button>
    <button class="btn sec" data-act="paste-prac">Pegar de Excel</button><button class="btn sec" data-act="reorder-items">Ordenar</button>${undoBtn('prac')}
    <span class="grow stat hint">${c.items.length} actividades</span></div>`;
  if (!c.students.length) return h + noStudents();
  h += `<div class="grid-wrap"><table class="grid"><thead><tr><th class="c-n corner">N°</th><th class="c-name corner">APELLIDOS Y NOMBRES</th>`;
  c.items.forEach(it => { h += `<th class="col ${it.tipo === 'inv' ? 'inv' : 'prac'}" data-hi="${it.id}"><span>${it.tipo === 'inv' ? '' : '<i class="ic">🖥️</i> '}${esc(it.name)}</span></th>`; });
  h += `</tr></thead><tbody>`;
  c.students.forEach((s, k) => {
    const ret = s.retirado;
    h += `<tr class="${ret ? 'retirado' : s.id === activeSid ? 'active' : ''}">${rowHead(c, s, k)}`;
    c.items.forEach(it => {
      const v = c.grades[s.id] && c.grades[s.id][it.id];
      const has = !ret && v !== undefined && v !== '';
      h += `<td class="cell ${has ? 'on' : 'pend'}" ${ret ? '' : `data-g="${s.id}|${it.id}"`}>${has ? esc(v) : ''}</td>`;
    });
    h += `</tr>`;
  });
  return h + `</tbody></table></div>`;
}

function viewEstudiantes() {
  const c = C();
  let h = `<div class="toolbar"><button class="btn" data-act="add-student">+ Estudiante</button>
    <button class="btn sec" data-act="paste-students">Pegar lista</button></div><div class="list">`;
  if (!c.students.length) h += `<div class="empty">Agrega estudiantes uno por uno, o usa <b>Pegar lista</b> para copiar la columna de nombres desde Excel o Word.</div>`;
  c.students.forEach((s, k) => {
    h += `<div class="stu ${s.retirado ? 'ret' : ''}"><span class="n">${k + 1}</span><span class="nm">${esc(s.name)}${s.retirado ? ' <b>(R)</b>' : ''}</span><button data-edit="${s.id}">Editar</button></div>`;
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
    d.date = v;
    save(); closeDlg(); render();
  }
}

function itemDialog(iid) {
  const c = C(), it = iid ? c.items.find(x => x.id === iid) : null;
  const suggest = t => `${t === 'inv' ? 'INVESTIGACION' : 'P'}${c.items.filter(x => x.tipo === t).length + 1}${t === 'inv' ? '' : '-'}`;
  const t0 = it ? it.tipo : 'prac';
  openDlg(`<h3>${it ? 'Editar actividad' : 'Nueva actividad'}</h3>
    <label>Tipo<select id="it"><option value="prac" ${t0 !== 'inv' ? 'selected' : ''}>Práctica</option><option value="inv" ${t0 === 'inv' ? 'selected' : ''}>Investigación</option></select></label>
    <label>Nombre<input id="iv" value="${esc(it ? it.name : suggest(t0))}" maxlength="40" autocomplete="off"></label>
    <div class="actions">${it ? '<button type="button" class="btn danger" id="del">Eliminar</button>' : ''}<button type="button" class="btn sec" id="cx">Cancelar</button><button class="btn" id="ok">Guardar</button></div>`,
    f => {
      f.querySelector('#cx').onclick = closeDlg;
      f.querySelector('#ok').onclick = doSave;
      if (!it) {   // al cambiar el tipo se actualiza el nombre sugerido, salvo que ya lo hayas escrito tú
        let last = suggest(t0);
        f.querySelector('#it').onchange = e => {
          const inp = f.querySelector('#iv');
          if (inp.value === last) { last = suggest(e.target.value); inp.value = last; }
        };
      }
      const del = f.querySelector('#del');
      if (del) del.onclick = () => {
        if (!confirm('¿Eliminar esta actividad y sus notas?')) return;
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
  activeSid = sid;
  render();
  openDlg(`<div class="gb-top"><span class="who">${c.students.indexOf(s) + 1} · ${esc(s.name)}</span><small>${esc(itemLabel(it))}</small>
      <label class="adv"><input type="checkbox" id="adv" ${db.advance ? 'checked' : ''}> Siguiente</label><button type="button" class="gb-x" id="cx" aria-label="Cerrar">✕</button></div>
    <div class="gb-row"><div class="quick">${QUICK.map(v => `<button type="button" data-v="${v}" class="${v === String(cur) ? 'sel' : ''}">${v}</button>`).join('')}</div>
    <button type="button" class="btn sec" id="clr" aria-label="Borrar nota">⌫</button></div>
    <div class="gb-hint">Para escribir otra nota: doble toque en la celda</div>`,
    f => {
      f.querySelector('#cx').onclick = closeDlg;
      f.querySelectorAll('.quick button').forEach(b => b.onclick = () => commit(b.dataset.v));
      f.querySelector('#clr').onclick = () => commit('');
    }, null, true);
  scrollToActive();
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

/* ---------- escribir la nota directamente en la celda (doble toque) ---------- */
let lastTap = { key: '', t: 0 };
let lastAtt = { key: '', t: 0, prev: undefined };
function startEdit(sid, iid) {
  const td = $(`#main td[data-g="${sid}|${iid}"]`);
  if (!td) return;
  closeDlg();
  const c = C();
  activeSid = sid; anchor = { sid, col: iid };
  const cur = (c.grades[sid] && c.grades[sid][iid]) ?? '';
  td.innerHTML = `<input class="cell-in" value="${esc(cur)}" maxlength="8" autocomplete="off" enterkeyhint="next">`;
  const inp = td.firstChild;
  let done = false;
  const finish = (move) => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (v !== String(cur)) {
      c.grades[sid] = c.grades[sid] || {};
      if (v === '') delete c.grades[sid][iid]; else c.grades[sid][iid] = v;
      save();
    }
    if (move) {
      const idx = c.students.findIndex(x => x.id === sid);
      const next = c.students.slice(idx + 1).find(x => !x.retirado);
      if (next) { activeSid = next.id; render(); startEdit(next.id, iid); scrollToActive(); return; }
      toast('Fin de la lista');
    }
    render();
  };
  inp.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { done = true; render(); }
  };
  inp.onblur = () => finish(false);
  inp.focus(); inp.select();
}

/* ---------- asistencia: elegir L / B con doble toque ---------- */
function attChooser(sid, did) {
  const c = C(), s = c.students.find(x => x.id === sid), d = c.dates.find(x => x.id === did);
  if (!s || !d) return;
  const cur = c.att[sid] && c.att[sid][did];
  activeSid = sid; render();
  const opts = [['L', 'L', 'Licencia'], ['B', 'B', 'Banda'], ['✓', '✓', 'Presente'], ['', '⌫', 'Borrar']];
  openDlg(`<div class="gb-top"><span class="who">${c.students.indexOf(s) + 1} · ${esc(s.name)}</span><small>${esc(dateLabel(d.date))}</small><span class="grow"></span><button type="button" class="gb-x" id="cx" aria-label="Cerrar">✕</button></div>
    <div class="gb-row"><div class="quick att-q">${opts.map(([v, g, t]) => `<button type="button" data-v="${v}" class="${(v === '✓' ? cur === true : v === cur) ? 'sel' : ''}"><b>${g}</b><small>${t}</small></button>`).join('')}</div></div>`,
    f => {
      f.querySelector('#cx').onclick = closeDlg;
      f.querySelectorAll('.quick button').forEach(b => b.onclick = () => {
        const v = b.dataset.v;
        setAtt(c, sid, did, v === '✓' ? true : v);
        save(); render(); closeDlg();
      });
    }, null, true);
  scrollToActive();
}

/* ---------- ordenar columnas ---------- */
function reorderDialog(kind) {
  const c = C(), arr = kind === 'dates' ? c.dates : c.items;
  const label = x => kind === 'dates' ? dateLabel(x.date) : itemLabel(x);
  let hl = -1;
  openDlg(`<h3>${kind === 'dates' ? 'Ordenar fechas' : 'Ordenar actividades'}</h3>
    <div class="stat">Mueve cada columna con las flechas: ⤒ al inicio · ▲ una antes · ▼ una después · ⤓ al final.</div>
    <div class="ro-list" id="rol"></div>
    <div class="actions">${kind === 'dates' ? '<button type="button" class="btn sec" id="rbd">Ordenar por fecha</button>' : ''}<button type="button" class="btn" id="cx">Listo</button></div>`,
    f => {
      f.querySelector('#cx').onclick = closeDlg;
      const bd = f.querySelector('#rbd');
      if (bd) bd.onclick = () => { arr.sort((a, b) => a.date.localeCompare(b.date)); hl = -1; save(); render(); draw(); toast('Ordenadas de la más antigua a la más reciente'); };
      f.querySelector('#rol').onclick = e => {
        const b = e.target.closest('button[data-m]'); if (!b) return;
        const i = Number(b.closest('.ro-row').dataset.i);
        const j = { top: 0, up: i - 1, down: i + 1, bot: arr.length - 1 }[b.dataset.m];
        if (j < 0 || j >= arr.length || j === i) return;
        const [x] = arr.splice(i, 1); arr.splice(j, 0, x);
        hl = j; save(); render(); draw();
      };
      draw();
    });
  function draw() {
    const box = $('#rol'), top = box.scrollTop;
    box.innerHTML = arr.map((x, i) => `<div class="ro-row ${i === hl ? 'hl' : ''}" data-i="${i}"><span class="ro-n">${i + 1}</span><span class="ro-t">${esc(label(x))}</span>
      <button type="button" data-m="top" ${i === 0 ? 'disabled' : ''}>⤒</button><button type="button" data-m="up" ${i === 0 ? 'disabled' : ''}>▲</button>
      <button type="button" data-m="down" ${i === arr.length - 1 ? 'disabled' : ''}>▼</button><button type="button" data-m="bot" ${i === arr.length - 1 ? 'disabled' : ''}>⤓</button></div>`).join('') || '<div class="stat">No hay columnas.</div>';
    box.scrollTop = top;
    const row = box.querySelector('.ro-row.hl'); if (row) row.scrollIntoView({ block: 'nearest' });
  }
}

/* ---------- pegar desde Excel ---------- */
let anchor = null;          // última celda tocada: punto de partida por defecto del pegado
let pasteUndo = null;
const undoBtn = kind => pasteUndo && pasteUndo.kind === kind && pasteUndo.cid === db.current ? '<button class="btn sec" data-act="undo-paste">↶ Deshacer pegado</button>' : '';
function undoPaste() {
  const u = pasteUndo; if (!u) return;
  const c = db.courses.find(x => x.id === u.cid); if (!c) return;
  if (u.kind === 'att') c.att = JSON.parse(u.snap); else c.grades = JSON.parse(u.snap);
  pasteUndo = null; save(c); render(); toast('Pegado deshecho');
}
function pasteGridDialog(kind, initial) {
  const c = C(), cols = kind === 'att' ? c.dates : c.items;
  if (!c.students.length) { toast('Primero agrega a los estudiantes'); return; }
  if (!cols.length) { toast(kind === 'att' ? 'Primero crea las fechas con + Fecha' : 'Primero crea las actividades con + Actividad'); return; }
  const colLabel = x => kind === 'att' ? dateLabel(x.date) : itemLabel(x);
  const sid0 = anchor && c.students.some(s => s.id === anchor.sid) ? anchor.sid : c.students[0].id;
  const col0 = anchor && cols.some(x => x.id === anchor.col) ? anchor.col : cols[0].id;
  openDlg(`<h3>Pegar desde Excel</h3>
    <div class="stat">En Excel selecciona las celdas, cópialas (Ctrl+C) y pégalas en el cuadro.${kind === 'att' ? ' Reconoce ✓, 1, Sí, P como presente; L como licencia; B como banda; y 0, F, Falta como ausente.' : ''}</div>
    <textarea id="pt" class="pt" placeholder="Pega aquí…"></textarea>
    <div class="row"><label>Empezar en el estudiante<select id="ps">${c.students.map((s, i) => `<option value="${s.id}" ${s.id === sid0 ? 'selected' : ''}>${i + 1} · ${esc(s.name)}</option>`).join('')}</select></label>
    <label>Y en la columna<select id="pc">${cols.map(x => `<option value="${x.id}" ${x.id === col0 ? 'selected' : ''}>${esc(colLabel(x))}</option>`).join('')}</select></label></div>
    <label class="chk"><input type="checkbox" id="p_lab"> Lo copiado incluye N° y nombres (se usan para ubicar a cada estudiante)</label>
    <label class="chk"><input type="checkbox" id="p_hdr"> La primera fila son títulos (se ignora)</label>
    <label class="chk"><input type="checkbox" id="p_clr"> Las celdas vacías borran lo que ya existe</label>
    <div class="stat pv" id="pv"></div>
    <div class="actions"><button type="button" class="btn sec" id="cx">Cancelar</button><button class="btn" id="ok" disabled>Pegar</button></div>`,
    f => {
      const q = id => f.querySelector(id);
      let plan = null;
      const opts = () => ({ header: q('#p_hdr').checked, labels: q('#p_lab').checked, clear: q('#p_clr').checked, startSid: q('#ps').value, startCol: q('#pc').value });
      const refresh = () => {
        const rows = parsePaste(q('#pt').value);
        if (!rows.length) { q('#pv').textContent = ''; q('#ok').disabled = true; plan = null; return; }
        plan = planPaste(c, kind, rows, opts());
        const m = [];
        if (plan.writes.length) m.push(`Se actualizarán ${plan.writes.length} celdas de ${plan.students} estudiantes${plan.replaced ? ` (reemplaza ${plan.replaced} existentes)` : ''}.`);
        else m.push('No hay cambios que pegar con estas opciones.');
        if (plan.byName) m.push(`Ubicados por nombre: ${plan.matched} de ${plan.rows}.`);
        if (plan.unmatched.length) m.push(`Sin coincidencia: ${plan.unmatched.slice(0, 3).join(', ')}${plan.unmatched.length > 3 ? ` y ${plan.unmatched.length - 3} más` : ''}.`);
        if (plan.retired) m.push(`${plan.retired} filas de estudiantes retirados se omiten.`);
        if (plan.overflow) m.push(`⚠ Sobran ${plan.overflow} columnas: agrega más ${kind === 'att' ? 'fechas' : 'actividades'} o empieza en una columna anterior.`);
        if (plan.unknown) m.push(`${plan.unknown} valores no reconocidos se omitieron.`);
        if (!plan.byName && plan.rows + c.students.findIndex(s => s.id === q('#ps').value) > c.students.length) m.push('⚠ Hay más filas que estudiantes desde ese punto.');
        q('#pv').innerHTML = m.map(esc).join('<br>');
        q('#ok').disabled = !plan.writes.length;
      };
      q('#pt').addEventListener('input', () => {
        const rows = parsePaste(q('#pt').value);
        q('#p_hdr').checked = looksLikeHeader(rows);
        q('#p_lab').checked = detectNameCol(rows.slice(looksLikeHeader(rows) ? 1 : 0)) >= 0;
        refresh();
      });
      f.querySelectorAll('select,input[type=checkbox]').forEach(el => el.addEventListener('change', refresh));
      q('#cx').onclick = closeDlg;
      q('#ok').onclick = () => {
        if (!plan || !plan.writes.length) return;
        pasteUndo = { cid: c.id, kind, snap: JSON.stringify(kind === 'att' ? c.att : c.grades) };
        plan.writes.forEach(w => {
          if (kind === 'att') {
            c.att[w.sid] = c.att[w.sid] || {};
            if (w.v) c.att[w.sid][w.col] = w.v; else delete c.att[w.sid][w.col];
          } else {
            c.grades[w.sid] = c.grades[w.sid] || {};
            if (w.v === '') delete c.grades[w.sid][w.col]; else c.grades[w.sid][w.col] = w.v;
          }
        });
        save(); closeDlg(); render(); toast(`Pegado: ${plan.writes.length} celdas`);
      };
      if (initial) { q('#pt').value = initial; q('#pt').dispatchEvent(new Event('input')); }
      else setTimeout(() => q('#pt').focus(), 60);
    });
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
  const c = isNew ? newCourse({ unidad: 'LOS ANDES MAÑANA', area: 'COMPUTACION' }) : C();
  const sel = (id, label, opts, cur) => {
    const list = cur && !opts.includes(cur) ? [cur, ...opts] : opts;
    return `<label>${label}<select id="${id}"><option value="">—</option>${list.map(o => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  };
  const f = (id, label, v, ph) => `<label>${label}<input id="${id}" value="${esc(v)}" placeholder="${esc(ph || '')}" autocomplete="off"></label>`;
  openDlg(`<h3>${isNew ? 'Nuevo curso' : 'Datos del curso'}</h3>
    ${f('c_unidad', 'Unidad', c.unidad, 'LOS ANDES MAÑANA')}
    ${f('c_prof', 'Profesor(a)', c.prof)}
    ${f('c_area', 'Área', c.area, 'COMPUTACIÓN')}
    <div class="row">${sel('c_grado', 'Grado', ['1°', '2°', '3°', '4°', '5°', '6°'], c.grado)}${sel('c_par', 'Paralelo', ['A', 'B', 'C', 'D'], c.paralelo)}</div>
    ${sel('c_nivel', 'Nivel', ['Primaria', 'Secundaria'], c.nivel)}
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
      const oldIds = db.courses.map(c => c.id);
      const old = db.tombstones || [];
      db = normalizeDB(d);
      const now = Date.now();
      db.courses.forEach(c => { c.updatedAt = now; });
      oldIds.filter(id => !db.courses.some(c => c.id === id)).forEach(id => db.tombstones.push({ id, updatedAt: now }));
      old.forEach(t => { if (!db.tombstones.some(x => x.id === t.id) && !db.courses.some(c => c.id === t.id)) db.tombstones.push(t); });
      save(null); Sync.queue(); render(); toast('Copia restaurada');
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
      db.tombstones.push({ id: db.current, updatedAt: Date.now() });
      const n = newCourse(); db.courses = [n]; db.current = n.id;
    } else {
      if (!confirm(`¿Eliminar el curso "${courseTitle(C())}" con todos sus datos?`)) return;
      db.tombstones.push({ id: db.current, updatedAt: Date.now() });
      db.courses = db.courses.filter(c => c.id !== db.current); db.current = db.courses[0].id;
    }
    save(null); Sync.queue(); render();
  }
}

function init() {
  db = load();
  $('#courseSel').onchange = e => { db.current = e.target.value; save(null); render(); };
  $('#btnSync').onclick = () => Sync.dialog();
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  $('#btnMenu').onclick = e => { e.stopPropagation(); $('#menu').classList.toggle('hidden'); };
  document.addEventListener('click', e => { if (!e.target.closest('#menu')) $('#menu').classList.add('hidden'); });
  $('#menu').addEventListener('click', e => { const b = e.target.closest('button'); if (b) onMenu(b.dataset.act); });
  $('#fileJson').onchange = e => { if (e.target.files[0]) doImportJson(e.target.files[0]); e.target.value = ''; };

  const mainEl = $('#main');
  $('#dlg').addEventListener('close', () => { if (!$('#dlg').open) { mainEl.style.paddingBottom = ''; document.body.classList.remove('sheet-open'); } });
  document.addEventListener('paste', e => {
    const tg = e.target;
    if (tg && /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)) return;
    if ($('#dlg').open || (tab !== 'asistencia' && tab !== 'practicas')) return;
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (!text.trim()) return;
    e.preventDefault();
    pasteGridDialog(tab === 'asistencia' ? 'att' : 'prac', text);
  });
  mainEl.addEventListener('click', e => {
    const t = e.target;
    let el;
    if (t.closest('.cell-in')) return;
    if ((el = t.closest('[data-sid]'))) {
      closeDlg();
      activeSid = el.dataset.sid; anchor = { sid: activeSid, col: anchor && anchor.col };
      render(); return;
    }
    if ((el = t.closest('[data-a]'))) {
      const [sid, did] = el.dataset.a.split('|'), c = C();
      const key = el.dataset.a, now = Date.now(), cur = c.att[sid] && c.att[sid][did];
      activeSid = sid; anchor = { sid, col: did };
      if (lastAtt.key === key && now - lastAtt.t < 400) {        // doble toque: deshace el primer toque y ofrece L / B
        setAtt(c, sid, did, lastAtt.prev); lastAtt = { key: '', t: 0, prev: undefined };
        save(); render(); attChooser(sid, did);
      } else {                                                    // un toque: ✓ (si ya tenía algo, se borra)
        lastAtt = { key, t: now, prev: cur };
        setAtt(c, sid, did, cur ? undefined : true);
        save(); render();
      }
    } else if ((el = t.closest('[data-g]'))) {
      const [sid, iid] = el.dataset.g.split('|');
      anchor = { sid, col: iid };
      const now = Date.now(), key = el.dataset.g;
      if (lastTap.key === key && now - lastTap.t < 400) { lastTap = { key: '', t: 0 }; startEdit(sid, iid); }
      else { lastTap = { key, t: now }; gradeDialog(sid, iid); }
    } else if ((el = t.closest('[data-hd]'))) editDateDialog(el.dataset.hd);
    else if ((el = t.closest('[data-hi]'))) itemDialog(el.dataset.hi);
    else if ((el = t.closest('[data-edit]'))) studentDialog(el.dataset.edit);
    else if ((el = t.closest('[data-go]'))) { tab = el.dataset.go; render(); }
    else if ((el = t.closest('[data-act]'))) {
      const a = el.dataset.act;
      if (a === 'add-date') addDateDialog();
      else if (a === 'paste-att') pasteGridDialog('att');
      else if (a === 'paste-prac') pasteGridDialog('prac');
      else if (a === 'reorder-dates') reorderDialog('dates');
      else if (a === 'reorder-items') reorderDialog('items');
      else if (a === 'undo-paste') undoPaste();
      else if (a === 'add-item') itemDialog(null);
      else if (a === 'add-student') studentDialog(null);
      else if (a === 'paste-students') pasteDialog();
    }
  });

  render();
  Sync.init();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

if (typeof document !== 'undefined' && document.getElementById) init();
if (typeof module !== 'undefined') module.exports = { splitName, sheetName, itemLabel, parsePaste, planPaste, detectNameCol, looksLikeHeader, attMark, normName, courseShort, buildXlsx, newCourse, attStats, average, dateLabel, normalizeDB, mergeRemote, pendingWrites, isPristine };
