/**
 * PSP404TC Code Understanding Study: Google Sheet backend.
 *
 * Every finished session from the study app becomes one row in the "Sessions" tab,
 * with its columns grouped by hypothesis:
 *   H1  completion time            (time_sec)
 *   H2  hidden tests passed /10    (Task 1 /3 + Task 2 /3 + Task 3 /4)
 *   H3  code understanding /10     (Q1 /2 + Q2 /2 + Q3 /2 + code change /4)
 * The "Summary" tab compares the AI and Control groups for each measure and updates by itself.
 *
 * Setup (once): see README.md in the repository.
 *   1. Change GROUP_KEY below to a phrase only your group knows.
 *   2. Run setup() once from the editor and allow access.
 *   3. Deploy > New deployment > Web app; Execute as: Me; Who has access: Anyone.
 *   4. Put the web-app URL in config.js.
 */

const GROUP_KEY = 'change-me';   // <- change this in YOUR copy of the script; never commit the real key

// Only needed if you made this script at script.google.com instead of from the sheet
// (Extensions > Apps Script). Paste the sheet's ID: the long code in the sheet's address
// between /d/ and /edit, e.g. https://docs.google.com/spreadsheets/d/THIS_PART/edit
const SHEET_ID = '';
const VERSION = 2;

// Open link: people who join through it are placed in a group by this script, never by choice.
const DEFAULT_PLACES = 5;   // places per group until you change it on the Run session page (Admin)
const HOLD_MINUTES = 120;   // a place someone has started keeps being held for this long

const SESSIONS = 'Sessions', CONSENTS = 'Consents', SUMMARY = 'Summary', PLACES = 'Places';

// [key, column header, band] — the header text is how columns are found, so don't rename headers.
const COLUMNS = [
  ['id', 'Session id', 'who'],
  ['code', 'Participant', 'who'],
  ['group', 'Group', 'who'],
  ['level', 'Python courses', 'who'],
  ['practice', 'Practice run (1 = yes)', 'who'],
  ['assigned', 'Group set by', 'who'],
  ['excluded', 'Excluded (1 = yes)', 'who'],
  ['date', 'Date', 'who'],
  ['time_sec', 'H1 · Time (s)', 'h1'],
  ['finished', 'H1 · Finished before 10:00 (1 = yes)', 'h1'],
  ['t1_score', 'H2 · Task 1 /3', 'h2'],
  ['t2_score', 'H2 · Task 2 /3', 'h2'],
  ['t3_score', 'H2 · Task 3 /4', 'h2'],
  ['tests_passed', 'H2 · Tests passed /10', 'h2'],
  ['q1_marker1', 'H3 · Q1 marker 1', 'h3'],
  ['q1_marker2', 'H3 · Q1 marker 2', 'h3'],
  ['q1', 'H3 · Q1 final /2', 'h3'],
  ['q2_marker1', 'H3 · Q2 marker 1', 'h3'],
  ['q2_marker2', 'H3 · Q2 marker 2', 'h3'],
  ['q2', 'H3 · Q2 final /2', 'h3'],
  ['q3', 'H3 · Q3 /2 (auto)', 'h3'],
  ['change_score', 'H3 · Code change /4 (auto)', 'h3'],
  ['understanding', 'H3 · Understanding /10', 'h3'],
  ['questions_time_sec', 'Questions time (s)', 'other'],
  ['python_months', 'Months of Python', 'other'],
  ['python_self_rating', 'Python skill 1-5', 'other'],
  ['ai_tool_use', 'AI use when coding 1-5', 'other'],
  ['used_counter_before', 'Used Counter before', 'other'],
  ['ai_app', 'AI app used', 'ai'],
  ['prompts', 'Prompts sent', 'ai'],
  ['ai_use_coder1', 'AI use · coder 1', 'ai'],
  ['ai_use_coder2', 'AI use · coder 2', 'ai'],
  ['ai_use', 'AI use · agreed', 'ai'],
  ['notes', 'Notes', 'other'],
  ['json', 'Raw answers (JSON)', 'raw']
];
const BAND_COLORS = { who: '#e8eaf6', h1: '#d6e9ff', h2: '#d9f2e3', h3: '#ece3ff', other: '#f1f1f4', ai: '#fff1d6', raw: '#f1f1f4' };

/* ---------------- web app ---------------- */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'ping') return out({ ok: true, version: VERSION });
    if (p.key !== GROUP_KEY) return out({ ok: false, error: 'wrong key' });
    ensureSetup();
    if (p.action === 'check') return out({ ok: true });
    if (p.action === 'list') return out({ ok: true, sessions: listSessions() });
    if (p.action === 'consents') return out({ ok: true, consents: listConsents() });
    if (p.action === 'places') return out(placesStatus());
    return out({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    ensureSetup();
    if (body.action === 'submit') return out(submitSession(body.session));
    if (body.action === 'consent') return out(addConsent(body.consent));
    if (body.action === 'assign') return out(assignPlace(body));
    if (body.key !== GROUP_KEY) return out({ ok: false, error: 'wrong key' });
    if (body.action === 'update') return out(updateSession(body.id, body.patch || {}));
    if (body.action === 'delete') return out(deleteSession(body.id));
    if (body.action === 'places') return out(setPlaces(body));
    return out({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- sessions ---------------- */

function submitSession(s) {
  if (!s || typeof s !== 'object' || !s.id || !s.code) return { ok: false, error: 'missing session' };
  const sh = sheet(SESSIONS), col = columnMap(sh);
  if (findRow(sh, col, s.id)) return { ok: true, duplicate: true };
  const sc = s.scores || {};
  const q = s.questionnaire || {};
  const v = {
    id: s.id, code: clean(s.code, 20), group: s.group === 'AI' ? 'AI' : 'Control', level: clean(s.level, 4),
    practice: s.pilot ? 1 : 0, assigned: clean(s.assigned, 12), excluded: 0, date: s.created_at ? new Date(Number(s.created_at)) : new Date(),
    time_sec: num(s.time_sec), finished: s.finished ? 1 : 0,
    t1_score: num(sc.t1), t2_score: num(sc.t2), t3_score: num(sc.t3),
    q3: num(s.q3), change_score: num(sc.mod),
    questions_time_sec: num(s.u_time_sec),
    python_months: num(q.python_months), python_self_rating: num(q.python_self_rating), ai_tool_use: num(q.ai_tool_use),
    used_counter_before: clean(q.used_counter_before, 10),
    ai_app: clean(s.model, 60), notes: '',
    json: JSON.stringify(s).slice(0, 49000)
  };
  const row = new Array(sh.getLastColumn()).fill('');
  Object.keys(v).forEach(function (k) { if (col[k]) row[col[k] - 1] = v[k] === null ? '' : v[k]; });
  sh.appendRow(row);
  setRowFormulas(sh, col, sh.getLastRow());
  return { ok: true };
}

function updateSession(id, patch) {
  const sh = sheet(SESSIONS), col = columnMap(sh), r = findRow(sh, col, id);
  if (!r) return { ok: false, error: 'not found' };
  const set = function (k, val) { if (col[k] && val !== undefined) sh.getRange(r, col[k]).setValue(val === null ? '' : val); };
  if (patch.scores) { set('t1_score', num(patch.scores.t1)); set('t2_score', num(patch.scores.t2)); set('t3_score', num(patch.scores.t3)); set('change_score', num(patch.scores.mod)); }
  if (patch.q3 !== undefined) set('q3', num(patch.q3));
  const m = patch.marks;
  if (m) {
    set('q1_marker1', num(m.q1A)); set('q1_marker2', num(m.q1B));
    set('q2_marker1', num(m.q2A)); set('q2_marker2', num(m.q2B));
    ['q1', 'q2'].forEach(function (q) {
      const a = num(m[q + 'A']), b = num(m[q + 'B']);
      if (a !== null && a === b) sh.getRange(r, col[q]).setFormula(finalFormula(col, q, r)); // markers agree: formula fills it
      else if (num(m[q]) !== null) sh.getRange(r, col[q]).setValue(num(m[q]));               // disagreement settled
      else if (a !== null && b !== null) sh.getRange(r, col[q]).setValue('');                // disagreement still open
    });
  }
  const ai = patch.ai;
  if (ai) { set('prompts', num(ai.prompts)); set('ai_use_coder1', clean(ai.catA, 20)); set('ai_use_coder2', clean(ai.catB, 20)); set('ai_use', clean(ai.category, 20)); }
  if (patch.notes !== undefined) set('notes', clean(patch.notes, 2000));
  if (patch.excluded !== undefined) set('excluded', patch.excluded ? 1 : 0);
  if (patch.assigned !== undefined) set('assigned', clean(patch.assigned, 12));
  return { ok: true };
}

function deleteSession(id) {
  const sh = sheet(SESSIONS), col = columnMap(sh), r = findRow(sh, col, id);
  if (r) sh.deleteRow(r);
  return { ok: true };
}

// Rows come back as session objects; values typed into the sheet (marks, coding, exclusions) win over the raw JSON.
function listSessions() {
  const sh = sheet(SESSIONS), col = columnMap(sh);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const g = function (row, k) { return col[k] ? row[col[k] - 1] : ''; };
  return rows.filter(function (row) { return g(row, 'id'); }).map(function (row) {
    let s = {};
    try { s = JSON.parse(g(row, 'json') || '{}'); } catch (e) { s = {}; }
    s.id = String(g(row, 'id')); s.code = String(g(row, 'code')); s.group = String(g(row, 'group'));
    s.level = String(g(row, 'level')); s.pilot = Number(g(row, 'practice')) === 1; s.excluded = Number(g(row, 'excluded')) === 1;
    s.notes = String(g(row, 'notes') || '');
    s.assigned = String(g(row, 'assigned') || '') || s.assigned || '';
    s.marks = { q1A: num(g(row, 'q1_marker1')), q1B: num(g(row, 'q1_marker2')), q1: num(g(row, 'q1')),
                q2A: num(g(row, 'q2_marker1')), q2B: num(g(row, 'q2_marker2')), q2: num(g(row, 'q2')) };
    s.ai = { prompts: num(g(row, 'prompts')), catA: String(g(row, 'ai_use_coder1') || '') || null,
             catB: String(g(row, 'ai_use_coder2') || '') || null, category: String(g(row, 'ai_use') || '') || null };
    const t1 = num(g(row, 't1_score')), t2 = num(g(row, 't2_score')), t3 = num(g(row, 't3_score')), mod = num(g(row, 'change_score'));
    s.scores = (t1 !== null && t2 !== null && t3 !== null && mod !== null) ? { t1: t1, t2: t2, t3: t3, mod: mod } : null;
    s.from_sheet = true;
    return s;
  });
}

/* ---------------- open link: places per group ---------------- */
// Someone opening the open link is placed in a group with room: the smaller group, or at random when both are the
// same size. Counted sessions fill places; a place someone has started is held for HOLD_MINUTES.

function settings_() {
  const p = PropertiesService.getScriptProperties();
  const cap = p.getProperty('places'), open = p.getProperty('open');
  return { places: cap === null ? DEFAULT_PLACES : Number(cap), open: open !== '0' };
}
function setPlaces(b) {
  const p = PropertiesService.getScriptProperties();
  if (b.places !== undefined) { const n = Math.max(0, Math.min(500, Math.floor(Number(b.places) || 0))); p.setProperty('places', String(n)); }
  if (b.open !== undefined) p.setProperty('open', b.open ? '1' : '0');
  return placesStatus();
}
function placeCounts_() {
  const sh = sheet(SESSIONS), col = columnMap(sh), last = sh.getLastRow();
  const c = { AI: { done: 0, started: 0 }, Control: { done: 0, started: 0 } }, codes = {};
  if (last >= 2) sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues().forEach(function (r) {
    const g = String(r[col.group - 1]); codes[String(r[col.code - 1])] = true;
    if (c[g] && Number(r[col.practice - 1]) !== 1 && Number(r[col.excluded - 1]) !== 1 && r[col.id - 1]) c[g].done++;
  });
  const pl = sheet(PLACES), pLast = pl.getLastRow(), now = Date.now();
  const rows = pLast >= 2 ? pl.getRange(2, 1, pLast - 1, 6).getValues() : [];
  rows.forEach(function (r) {
    const when = r[0] instanceof Date ? r[0].getTime() : Number(new Date(r[0]));
    if (c[r[2]] && !codes[String(r[1])] && now - when < HOLD_MINUTES * 60000) c[r[2]].started++;
  });
  return { counts: c, rows: rows, codes: codes };
}
function placesStatus() {
  const st = settings_(), pc = placeCounts_();
  return { ok: true, places: st.places, open: st.open, counts: pc.counts };
}
function assignPlace(b) {
  const device = String(b.device || '');
  if (!/^[A-Za-z0-9]{8,40}$/.test(device)) return { ok: false, error: 'bad device' };
  // a practice run by the group gets a random group and uses no place
  if (b.practice) return { ok: true, code: 'PR' + Math.floor(Math.random() * 900 + 100), group: Math.random() < 0.5 ? 'AI' : 'Control', practice: true };
  const st = settings_(), pc = placeCounts_();
  // the same device always gets the same place back, so reopening the link can't change the group
  for (let i = 0; i < pc.rows.length; i++) if (String(pc.rows[i][3]) === device) {
    const code0 = String(pc.rows[i][1]);
    if (pc.codes[code0]) return { ok: true, already: true }; // this device has already finished
    return { ok: true, code: code0, group: String(pc.rows[i][2]), again: true };
  }
  if (!st.open) return { ok: true, full: true, closed: true };
  const used = function (g) { return pc.counts[g].done + pc.counts[g].started; };
  const room = ['AI', 'Control'].filter(function (g) { return !st.places || used(g) < st.places; });
  if (!room.length) return { ok: true, full: true };
  let group = room[0];
  if (room.length === 2) group = used('AI') < used('Control') ? 'AI' : used('Control') < used('AI') ? 'Control' : (Math.random() < 0.5 ? 'AI' : 'Control');
  let n = pc.rows.length + 1, code;
  do { code = 'R' + (n < 10 ? '0' : '') + n; n++; } while (pc.codes[code]);
  sheet(PLACES).appendRow([new Date(), code, group, device, clean(b.lang, 4), clean(b.level, 4)]);
  return { ok: true, code: code, group: group };
}

/* ---------------- consents (initials + date only, never linked to answers) ---------------- */

function addConsent(c) {
  if (!c) return { ok: false, error: 'missing consent' };
  const initials = String(c.initials || '').replace(/[^A-Za-z]/g, '').slice(0, 6).toUpperCase();
  if (!initials) return { ok: false, error: 'missing initials' };
  sheet(CONSENTS).appendRow([clean(c.date, 10), initials, clean(c.form, 20)]);
  return { ok: true };
}
function listConsents() {
  const sh = sheet(CONSENTS), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 3).getValues().map(function (r) {
    const d = r[0] instanceof Date ? Utilities.formatDate(r[0], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[0]);
    return { date: d, initials: String(r[1]), form: String(r[2]) };
  });
}

/* ---------------- sheet set-up ---------------- */

function setup() {
  const book = ss_();
  ensureSetup();
  Logger.log('Done. The sheet "' + book.getName() + '" now has the tabs: ' +
    book.getSheets().map(function (s) { return s.getName(); }).join(', ') +
    '. Open (or refresh) that sheet to see them, then deploy as a web app (see README).');
}

// The spreadsheet this script writes to.
function ss_() {
  let book = null;
  try { book = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { book = null; }
  if (!book && SHEET_ID) book = SpreadsheetApp.openById(SHEET_ID);
  if (!book) throw new Error('This script is not attached to a Google Sheet. Either open your sheet and use Extensions > Apps Script, ' +
    'or paste the sheet ID into SHEET_ID at the top of this script, then run setup again.');
  return book;
}

function ensureSetup() {
  const ss = ss_();
  if (!ss.getSheetByName(SESSIONS)) {
    const sh = ss.insertSheet(SESSIONS, 0);
    sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS.map(function (c) { return c[1]; })]).setFontWeight('bold').setWrap(true).setVerticalAlignment('top');
    COLUMNS.forEach(function (c, i) { sh.getRange(1, i + 1).setBackground(BAND_COLORS[c[2]]); });
    sh.setFrozenRows(1); sh.setFrozenColumns(3); sh.setRowHeight(1, 48);
    sh.hideColumns(1); sh.hideColumns(COLUMNS.length);
  }
  if (!ss.getSheetByName(CONSENTS)) {
    const c = ss.insertSheet(CONSENTS);
    c.getRange(1, 1, 1, 3).setValues([['Date', 'Initials', 'Form']]).setFontWeight('bold');
    c.setFrozenRows(1);
  }
  if (!ss.getSheetByName(PLACES)) {
    const p = ss.insertSheet(PLACES);
    p.getRange(1, 1, 1, 6).setValues([['Date', 'Participant', 'Group', 'Device', 'Language', 'Python courses']]).setFontWeight('bold');
    p.setFrozenRows(1);
  }
  // columns added in later versions go at the end of an existing Sessions tab
  const sh = ss.getSheetByName(SESSIONS), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  COLUMNS.forEach(function (c) {
    if (head.indexOf(c[1]) < 0) { const n = sh.getLastColumn() + 1; sh.getRange(1, n).setValue(c[1]).setFontWeight('bold').setBackground(BAND_COLORS[c[2]]); head.push(c[1]); }
  });
  if (!ss.getSheetByName(SUMMARY)) buildSummary(ss);
}

function buildSummary(ss) {
  const sh = ss.insertSheet(SUMMARY, 0);
  const col = {}; COLUMNS.forEach(function (c, i) { col[c[0]] = i + 1; });
  const R = function (k) { const L = letter(col[k]); return SESSIONS + '!$' + L + '$2:$' + L; };
  const keep = function (grp, k) { return '(' + R('group') + '="' + grp + '")*(' + R('practice') + '<>1)*(' + R('excluded') + '<>1)*ISNUMBER(' + R(k) + ')'; };
  const measures = [
    ['H1 · Completion time (s)', 'AI group faster (lower)', 'time_sec'],
    ['H2 · Tests passed /10', 'AI group higher', 'tests_passed'],
    ['H2 · Task 3 only /4', 'AI group higher', 't3_score'],
    ['H3 · Understanding /10', 'AI group lower', 'understanding'],
    ['H3 · Q1 /2', 'AI group lower', 'q1'],
    ['H3 · Q2 /2', 'AI group lower', 'q2'],
    ['H3 · Q3 /2', 'AI group lower', 'q3'],
    ['H3 · Code change /4', 'AI group lower', 'change_score']
  ];
  sh.getRange('A1').setValue('PSP404 study summary').setFontSize(14).setFontWeight('bold');
  sh.getRange('A2').setValue('Updates by itself. Practice runs and excluded sessions are not counted. For p-values (Mann–Whitney U), open the Analysis page of the study app.');
  const head = ['Measure', 'Prediction', 'AI n', 'AI median', 'AI mean', 'Control n', 'Control median', 'Control mean', 'Median difference (AI − Control)'];
  sh.getRange(4, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#e8eaf6');
  measures.forEach(function (m, i) {
    const r = 5 + i;
    sh.getRange(r, 1, 1, 2).setValues([[m[0], m[1]]]);
    sh.getRange(r, 3).setFormula('=SUMPRODUCT(' + keep('AI', m[2]) + ')');
    sh.getRange(r, 4).setFormula('=IFERROR(MEDIAN(FILTER(' + R(m[2]) + ',' + keep('AI', m[2]) + ')),"")');
    sh.getRange(r, 5).setFormula('=IFERROR(ROUND(AVERAGE(FILTER(' + R(m[2]) + ',' + keep('AI', m[2]) + ')),2),"")');
    sh.getRange(r, 6).setFormula('=SUMPRODUCT(' + keep('Control', m[2]) + ')');
    sh.getRange(r, 7).setFormula('=IFERROR(MEDIAN(FILTER(' + R(m[2]) + ',' + keep('Control', m[2]) + ')),"")');
    sh.getRange(r, 8).setFormula('=IFERROR(ROUND(AVERAGE(FILTER(' + R(m[2]) + ',' + keep('Control', m[2]) + ')),2),"")');
    sh.getRange(r, 9).setFormula('=IF(AND(ISNUMBER(D' + r + '),ISNUMBER(G' + r + ')),D' + r + '-G' + r + ',"")');
  });
  sh.getRange(5, 1, 3, 9).setBackground('#f4f9ff');
  sh.getRange(8, 1, 5, 9).setBackground('#f8f4ff');
  const pr = 5 + measures.length + 2;
  sh.getRange(pr, 1).setValue('Participants').setFontWeight('bold');
  sh.getRange(pr + 1, 1, 1, 3).setValues([['', 'AI', 'Control']]).setFontWeight('bold');
  const cnt = function (grp, extra) { return '=SUMPRODUCT((' + R('group') + '="' + grp + '")*(' + R('practice') + '<>1)*(' + R('excluded') + '<>1)*(' + R('id') + '<>"")' + (extra || '') + ')'; };
  sh.getRange(pr + 2, 1, 4, 3).setValues([['Counted sessions', '', ''], ['One Python course', '', ''], ['Two or more courses', '', ''], ['Still to mark (Q1 or Q2 has no final score)', '', '']]);
  [['AI', 2], ['Control', 3]].forEach(function (g) {
    sh.getRange(pr + 2, g[1]).setFormula(cnt(g[0]));
    sh.getRange(pr + 3, g[1]).setFormula(cnt(g[0], '*(' + R('level') + '&""="1")'));
    sh.getRange(pr + 4, g[1]).setFormula(cnt(g[0], '*(' + R('level') + '&""="2+")'));
    sh.getRange(pr + 5, g[1]).setFormula(cnt(g[0], '*((' + R('q1') + '="")+(' + R('q2') + '="")>0)'));
  });
  sh.setColumnWidth(1, 260); sh.setColumnWidth(2, 190); sh.setColumnWidth(9, 220);
}

function setRowFormulas(sh, col, r) {
  const L = function (k) { return letter(col[k]) + r; };
  sh.getRange(r, col.tests_passed).setFormula('=IF(COUNT(' + L('t1_score') + ',' + L('t2_score') + ',' + L('t3_score') + ')=3,' + L('t1_score') + '+' + L('t2_score') + '+' + L('t3_score') + ',"")');
  sh.getRange(r, col.q1).setFormula(finalFormula(col, 'q1', r));
  sh.getRange(r, col.q2).setFormula(finalFormula(col, 'q2', r));
  sh.getRange(r, col.understanding).setFormula('=IF(COUNT(' + L('q1') + ',' + L('q2') + ',' + L('q3') + ',' + L('change_score') + ')=4,' + L('q1') + '+' + L('q2') + '+' + L('q3') + '+' + L('change_score') + ',"")');
}
function finalFormula(col, q, r) {
  const a = letter(col[q + '_marker1']) + r, b = letter(col[q + '_marker2']) + r;
  return '=IF(AND(ISNUMBER(' + a + '),ISNUMBER(' + b + '),' + a + '=' + b + '),' + a + ',"")';
}

/* ---------------- helpers ---------------- */

function sheet(name) { return ss_().getSheetByName(name); }
function columnMap(sh) {
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = {};
  COLUMNS.forEach(function (c) { const i = head.indexOf(c[1]); if (i >= 0) col[c[0]] = i + 1; });
  return col;
}
function findRow(sh, col, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, col.id, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}
function num(v) { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return isNaN(n) ? null : n; }
function clean(v, max) { return v === null || v === undefined ? '' : String(v).replace(/^[=+\-@]/, "'$&").slice(0, max || 200); }
function letter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
