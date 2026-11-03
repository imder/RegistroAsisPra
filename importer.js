'use strict';
/* Lector de planillas Excel (.xlsx) → cursos de la app. Sin librerías: lee el ZIP, descomprime con
   DecompressionStream y interpreta el XML de las hojas. Funciona con el formato propio de la app
   y con planillas como la tuya (fechas y actividades en columnas, ✓ / L / B / F / A, notas numéricas). */
const Importer = (() => {
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const norm = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const unq = s => String(s).replace(/^[\s"“”'«]+|[\s"“”'»]+$/g, '').trim();
  const pad2 = n => String(n).padStart(2, '0');

  /* ---------- ZIP ---------- */
  async function inflate(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede leer archivos .xlsx. Actualiza Chrome o Edge.');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('El archivo no es un .xlsx válido');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const dec = new TextDecoder(), files = {};
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + el + cl;
      if (!/\.(xml|rels)$/i.test(name)) continue;
      const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true);
      const raw = u8.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
      files[name] = method === 0 ? raw : method === 8 ? await inflate(raw) : null;
    }
    return { text: n => files[n] ? dec.decode(files[n]) : null };
  }

  /* ---------- XML (expresiones regulares: el XML de Excel es muy regular) ---------- */
  const unesc = s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const attrs = str => { const o = {}; String(str).replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, (_, k, v) => { o[k] = unesc(v); return ''; }); return o; };
  const colNum = L => L.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  const tText = x => { let s = ''; x.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, t) => { s += t; return ''; }); return unesc(s); };

  function sharedStrings(xml) {
    if (!xml) return [];
    const out = [];
    xml.replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, (_, si) => { out.push(tText(si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''))); return ''; });
    return out;
  }
  const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  function dateStyles(xml) {
    const flags = [];
    if (!xml) return flags;
    const fmts = {};
    xml.replace(/<numFmt\b([^>]*)\/?>/g, (_, a) => { const o = attrs(a); fmts[o.numFmtId] = o.formatCode || ''; return ''; });
    const cx = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (!cx) return flags;
    cx[1].replace(/<xf\b([^>]*)>/g, (_, a) => {
      const id = Number(attrs(a).numFmtId || 0);
      let isDate = BUILTIN_DATE.has(id);
      if (!isDate && fmts[id]) isDate = /[dmyhs]/i.test(fmts[id].replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, ''));
      flags.push(isDate);
      return '';
    });
    return flags;
  }
  const serialToISO = n => {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  };

  async function readWorkbook(buf) {
    const z = await unzip(buf);
    const wb = z.text('xl/workbook.xml');
    if (!wb) throw new Error('El archivo no parece un libro de Excel');
    const rels = {};
    (z.text('xl/_rels/workbook.xml.rels') || '').replace(/<Relationship\b([^>]*)\/?>/g, (_, a) => { const o = attrs(a); rels[o.Id] = o.Target; return ''; });
    const sst = sharedStrings(z.text('xl/sharedStrings.xml')), dstyle = dateStyles(z.text('xl/styles.xml'));
    const sheets = [];
    const list = [];
    wb.replace(/<sheet\b([^>]*)\/?>/g, (_, a) => { list.push(attrs(a)); return ''; });
    for (const sh of list) {
      let target = rels[sh['r:id']] || '';
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
      const xml = z.text(target);
      if (!xml) continue;
      const cells = {};     // cells[fila][columna] = valor
      let maxR = 0, maxC = 0;
      xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (_, a, inner) => {
        if (inner === undefined) return '';
        const o = attrs(a), m = /^([A-Z]+)(\d+)$/.exec(o.r || ''); if (!m) return '';
        const r = +m[2], c = colNum(m[1]);
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner), t = o.t;
        let val = null;
        if (t === 'inlineStr') val = tText(inner);
        else if (v) {
          const raw = unesc(v[1]);
          if (t === 's') val = sst[+raw];
          else if (t === 'str') val = raw;
          else if (t === 'b') val = raw === '1';
          else if (t === 'e') val = null;
          else { const num = parseFloat(raw); val = isNaN(num) ? null : (dstyle[+o.s] ? { date: serialToISO(num) } : num); }
        }
        if (val === null || val === undefined || val === '') return '';
        (cells[r] = cells[r] || {})[c] = val;
        if (r > maxR) maxR = r; if (c > maxC) maxC = c;
        return '';
      });
      const merges = [];
      xml.replace(/<mergeCell\b([^>]*)\/?>/g, (_, a) => {
        const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(attrs(a).ref || '');
        if (m) merges.push({ r1: +m[2], c1: colNum(m[1]), r2: +m[4], c2: colNum(m[3]) });
        return '';
      });
      sheets.push({ name: sh.name, cells, merges, maxR, maxC });
    }
    return sheets;
  }

  /* ---------- interpretación de la planilla ---------- */
  function dateFromHeader(v, year) {
    if (v && typeof v === 'object' && v.date) return v.date;
    if (typeof v !== 'string') return null;
    const t = v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(t);
    if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
    m = /^(?:[a-z]{2,9}[,.\s]*)?(\d{1,2})\s*(?:de\s+)?([a-z]{3,})\.?(?:\s*(?:de\s+)?(\d{4}))?$/.exec(t);
    if (m) {
      const mi = MESES.indexOf(m[2].slice(0, 3).replace('set', 'sep'));
      if (mi >= 0 && +m[1] >= 1 && +m[1] <= 31) return `${m[3] || year}-${pad2(mi + 1)}-${pad2(m[1])}`;
    }
    return null;
  }
  const cleanNum = v => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)) : String(v).trim();

  function parseSheet(sh, ctx) {
    // las celdas combinadas solo valen por su esquina superior izquierda (las demás pueden guardar restos)
    const hidden = new Set();
    sh.merges.forEach(m => { for (let r = m.r1; r <= Math.min(m.r2, sh.maxR); r++) for (let c = m.c1; c <= Math.min(m.c2, sh.maxC); c++) if (r !== m.r1 || c !== m.c1) hidden.add(r * 100000 + c); });
    const cell = (r, c) => hidden.has(r * 100000 + c) ? undefined : (sh.cells[r] || {})[c];
    // 1) fila del encabezado "APELLIDOS Y NOMBRES"
    let r0 = 0, c0 = 0;
    outer: for (let r = 1; r <= Math.min(sh.maxR, 80); r++)
      for (const [c, v] of Object.entries(sh.cells[r] || {})) if (typeof v === 'string' && /apellidos/i.test(v) && cell(r, +c) !== undefined) { r0 = r; c0 = +c; break outer; }
    if (!r0) return null;
    const mg = sh.merges.find(m => m.r1 <= r0 && m.r2 >= r0 && m.c1 <= c0 && m.c2 >= c0);
    const cStart = (mg ? mg.c2 : c0) + 1;

    // 2) datos del curso (zona superior)
    const info = { unidad: '', prof: '', area: '', grado: '', paralelo: '', nivel: '', trimestre: '', anio: 0 };
    const right = (r, c) => { for (let k = c + 1; k <= c + 4; k++) { const v = cell(r, k); if (v !== undefined && !(typeof v === 'string' && /:\s*$/.test(v))) return v; } return ''; };
    for (let r = 1; r < r0; r++) {
      for (const [cs, v0] of Object.entries(sh.cells[r] || {})) {
        const c = +cs, v = cell(r, c); if (v === undefined) continue;
        void v0;
        if (typeof v === 'number' && !info.anio && v >= 2000 && v <= 2100 && c <= 4) info.anio = v;
        if (typeof v !== 'string') continue;
        const tri = /(\d)\s*(?:er|ro|do|to|º|°)?\s*trimestre/i.exec(v);
        if (tri && !info.trimestre) info.trimestre = tri[1];
        const lab = norm(v);
        const below = cell(r + 1, c);
        const val = k => { const x = (below !== undefined && r + 1 < r0 && !/^[A-Z ]+$/.test(String(below).trim()) ? below : right(r, c)); return unq(String(x)); };
        if (lab === 'UNIDAD') info.unidad = unq(String(right(r, c)));
        else if (/^PROF(ESOR|ESORA)?( A)?$/.test(lab)) info.prof = unq(String(right(r, c)));
        else if (lab === 'AREA') info.area = unq(String(right(r, c)));
        else if (lab === 'GRADO') {
          const x = String(below !== undefined && r + 1 < r0 ? below : right(r, c));
          const g = /(\d)\s*[°º]?/.exec(x); if (g) info.grado = g[1] + '°';
          const p = /PARALELO\s*:\s*"?([A-Z])/i.exec(x); if (p) info.paralelo = p[1].toUpperCase();
          const n = /NIVEL\s*:\s*"?([A-Za-zÁÉÍÓÚáéíóú]+)/.exec(x); if (n) info.nivel = n[1];
        } else if (lab === 'PARALELO') { const x = unq(String(below !== undefined && r + 1 < r0 ? below : right(r, c))); if (/^[A-Za-z]$/.test(x)) info.paralelo = x.toUpperCase(); }
        else if (lab === 'NIVEL') { const x = unq(String(below !== undefined && r + 1 < r0 ? below : right(r, c))); if (x) info.nivel = x; }
        void val;
      }
    }
    const nv = norm(info.nivel);
    info.nivel = nv.startsWith('PRIM') ? 'Primaria' : nv.startsWith('SEC') ? 'Secundaria' : info.nivel;
    const year = info.anio || ctx.year;

    // 3) estudiantes
    const students = [], rowOf = [];
    let empties = 0;
    for (let r = r0 + 1; r <= sh.maxR; r++) {
      const raw = cell(r, c0);
      const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
      if (!name) { if (students.length && ++empties > 8) break; continue; }
      empties = 0;
      const row = {}; for (const k of Object.keys(sh.cells[r] || {})) { const x = cell(r, +k); if (x !== undefined) row[k] = x; }
      let ret = /\(R\)\s*$/.test(name) || Object.values(row).some(x => typeof x === 'string' && /^\s*retirad[oa]\s*$/i.test(x));
      students.push({ name: name.replace(/\s*\(R\)\s*$/, ''), retirado: ret });
      rowOf.push(r);
    }
    if (!students.length) return null;

    // 4) columnas: fechas (asistencia) y actividades
    const SKIP = /^(estado|asist\.?|%|prom\.?|promedio|total|observaci[oó]n(es)?|n[°º]?)$/i;
    const hdrTop = Math.max(1, r0 - 5);
    const dates = [], items = [], dateCols = [], itemCols = [];
    const warnings = [];
    let anyIcon = false;
    const colsInfo = [];
    for (let c = cStart; c <= sh.maxC; c++) {
      let h;
      for (let r = r0; r >= hdrTop && h === undefined; r--) h = cell(r, c);
      const hasData = rowOf.some(r => cell(r, c) !== undefined);
      if (h === undefined) { if (hasData) warnings.push(`Una columna con datos no tiene título y se omitió (${colLetter(c)}).`); continue; }
      if (typeof h === 'string' && SKIP.test(h.trim())) continue;
      const d = dateFromHeader(h, year);
      if (d) { if (!dates.some(x => x.date === d)) { dates.push({ date: d }); dateCols.push(c); } continue; }
      let txt = typeof h === 'string' ? h : cleanNum(h);
      const icon = /^[\s\u{1F300}-\u{1FAFF}☀-➿️]+/u.exec(txt);
      if (icon && /[\u{1F300}-\u{1FAFF}☀-➿]/u.test(icon[0])) anyIcon = true;
      colsInfo.push({ c, name: txt.replace(/^[\s\u{1F300}-\u{1FAFF}☀-➿️]+/u, '').replace(/\s+/g, ' ').trim(), icon: !!(icon && /[\u{1F300}-\u{1FAFF}☀-➿]/u.test(icon[0])) });
    }
    for (const ci of colsInfo) {
      if (!ci.name) continue;
      const tipo = anyIcon ? (ci.icon ? 'prac' : 'inv') : (/^investig/i.test(ci.name) ? 'inv' : 'prac');
      items.push({ name: ci.name, tipo }); itemCols.push(ci.c);
    }

    // 5) valores
    const att = [], grades = [];
    let unknownAtt = 0;
    rowOf.forEach((r, si) => {
      if (students[si].retirado) return;
      dateCols.forEach((c, di) => {
        const v = cell(r, c); if (v === undefined) return;
        const m = ctx.attMark(typeof v === 'string' ? v : cleanNum(v));
        if (m) att.push({ s: si, d: di, v: m }); else if (m === null) unknownAtt++;
      });
      itemCols.forEach((c, ii) => {
        const v = cell(r, c); if (v === undefined) return;
        grades.push({ s: si, i: ii, v: cleanNum(v).slice(0, 12) });
      });
    });
    if (unknownAtt) warnings.push(`${unknownAtt} marcas de asistencia no reconocidas se omitieron.`);
    return { sheet: sh.name, info, students, dates, items, att, grades, warnings };
  }
  function colLetter(n) { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }

  /* ctx: { attMark, year } */
  async function parseWorkbook(buf, ctx) {
    const sheets = await readWorkbook(buf);
    return sheets.map(s => parseSheet(s, ctx)).filter(Boolean);
  }
  return { parseWorkbook, readWorkbook, parseSheet, dateFromHeader };
})();
if (typeof module !== 'undefined') module.exports = Importer;
