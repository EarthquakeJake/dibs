/**
 * MOVE — backend for the GitHub Pages front end
 * ------------------------------------------------------------------
 * Lives inside a Google Sheet (Extensions → Apps Script).
 *  • Items and claims are rows in the "Items" tab (you can edit them by hand).
 *  • Pickup times you offer live in the "Slots" tab (manage them from the site: Pickups → Times you're around).
 *  • Every claim, release and waitlist change is written to the "Log" tab.
 *  • Photos are stored in a Drive folder, shared view-only by link.
 *  • You get an email when someone claims, releases, or changes their pickup time.
 *  • Items with status "keep" are yours to keep: friends never receive them. The owner-only
 *    "export" action returns the inventory (no names, notes or photos) for storage planning.
 *  • "dimLines" holds the dimension arrows drawn on one photo (positions only; the numbers come from "dimensions").
 *
 * After ANY change to this file: Deploy → Manage deployments → ✏️ → Version: "New version" → Deploy.
 * (The web-app URL stays the same.)
 */

// ===================== 1. YOUR SETTINGS =====================
const SETTINGS = {
  FRIEND_CODE: 'change-me', // code for friends & family (goes inside the invite link)
  OWNER_CODE: 'change-me-too', // YOUR private code: add/edit items, see claim notes
  STORAGE_CODE: 'change-me-three', // read-only code for the storage-planning app: it can ONLY export the inventory
  NOTIFY_EMAIL: '',               // where claim emails go — leave blank for this Google account
  SITE_URL: 'https://yourname.github.io/dibs/', // your GitHub Pages address
  SITE_NAME: 'MOVE',
};
// ============ nothing below this line needs changing ============

const COLS = ['id', 'title', 'description', 'category', 'condition', 'dimensions', 'price', 'room', 'pickup',
  'photos', 'status', 'claimedBy', 'claimedAt', 'claimMessage', 'claimToken', 'created', 'updated', 'waitlist', 'pickupSlot',
  'quantity', 'measured', 'dimLines', 'claimAnon'];
const STATUSES = ['available', 'claimed', 'gone', 'keep'];
const TEXT_FIELDS = { title: 120, description: 4000, category: 40, condition: 30, dimensions: 80, price: 30, room: 60, pickup: 300 };
const MAX_PHOTOS = 10;
const MAX_QUEUE = 20;
const MAX_SLOTS = 60;
const MAX_UPLOAD_CHARS = 12 * 1024 * 1024; // base64 characters (~9 MB image)

// ---------- HTTP entry points ----------
function doGet() {
  return json_({ ok: true, service: 'move', note: 'This endpoint only answers POST requests from the ' + SETTINGS.SITE_NAME + ' page.' });
}

function doPost(e) {
  let res;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    res = handle_(req);
  } catch (err) {
    res = fail_(err && err.message ? err.message : String(err), 'ERROR');
  }
  return json_(res);
}

function handle_(req) {
  const role = roleFor_(req.key);
  if (!role) {
    Utilities.sleep(700); // slows down guessing
    return fail_('That access code is not right.', 'AUTH');
  }
  if (role === 'storage') { // read-only: never reaches list, claim or any owner action
    if (req.action === 'export') return export_();
    return fail_('This code can only export the inventory.', 'FORBIDDEN');
  }
  switch (req.action) {
    case 'list': return list_(req, role);
    case 'claim': return claim_(req, role);
    case 'unclaim': return unclaim_(req, role);
    case 'queue': return queue_(req, role);
    case 'leaveQueue': return leaveQueue_(req, role);
    case 'setSlot': return setSlot_(req, role);
  }
  if (role !== 'owner') return fail_('Only the owner can do that.', 'FORBIDDEN');
  switch (req.action) {
    case 'saveItem': return saveItem_(req);
    case 'deleteItem': return deleteItem_(req);
    case 'setStatus': return setStatus_(req);
    case 'uploadPhoto': return uploadPhoto_(req);
    case 'saveSlots': return saveSlots_(req);
    case 'export': return export_();
    case 'saveArrows': return saveArrows_(req);
  }
  return fail_('Unknown action: ' + req.action, 'BAD_ACTION');
}

// ---------- actions ----------
function list_(req, role) {
  const items = readItems_();
  const tokens = Array.isArray(req.tokens) ? req.tokens.slice(0, 300).map(String) : [];
  const out = {
    ok: true, role: role, now: Date.now(),
    items: items.filter(function (it) { return !hidden_(it, role); }).map(function (it) { return view_(it, role); }),
    slots: readSlots_(),
    you: you_(items, tokens), // which items this browser holds a claim or waitlist place on
  };
  if (role === 'owner') out.friendCode = String(SETTINGS.FRIEND_CODE);
  return out;
}

function claim_(req, role) {
  const name = clip_(req.name, 60).replace(/\s+/g, ' ');
  const message = clip_(req.message, 500);
  const anon = req.anon === true;
  if (!name) return fail_('Please enter your name.', 'INVALID');
  const slots = readSlots_();
  let it;
  const lock = lock_();
  try {
    // re-read inside the lock, so two people claiming at the same moment can't both win
    it = findItem_(req.id);
    if (!it || hidden_(it, role)) return fail_('This item no longer exists.', 'NOT_FOUND');
    if (it.status === 'claimed') {
      return fail_('Too late — ' + (shownName_(it, role) || 'someone') + ' already claimed this. You can join the waitlist.', 'TAKEN', { item: view_(it, role) });
    }
    if (it.status && it.status !== 'available') {
      return fail_('This item is no longer available.', 'UNAVAILABLE', { item: view_(it, role) });
    }
    it.status = 'claimed';
    it.claimedBy = name;
    it.claimedAt = String(Date.now());
    it.claimMessage = message;
    it.claimToken = Utilities.getUuid();
    it.claimAnon = anon ? '1' : '';
    it.pickupSlot = cleanSlot_(req.slot, slots);
    it.waitlist = '[]';
    it.updated = String(Date.now());
    writeItem_(it);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  log_('claim', it, name, message);
  const when = pickupLabel_(it.pickupSlot, slots);
  notify_(
    name + ' claimed "' + it.title + '"',
    name + ' claimed "' + it.title + '".' + (anon ? ' (Their name is hidden from other people.)' : '') + '\n\n' +
    (when ? 'Pickup: ' + when + '\n\n' : '') +
    (message ? 'Their note:\n' + message + '\n\n' : '') +
    siteLine_() +
    'All claims are also in the "Items" tab of your Google Sheet.'
  );
  return { ok: true, token: it.claimToken, item: view_(it, role) };
}

function unclaim_(req, role) {
  let it, who, next = '';
  const lock = lock_();
  try {
    it = findItem_(req.id);
    if (!it || hidden_(it, role)) return fail_('This item no longer exists.', 'NOT_FOUND');
    if (it.status !== 'claimed') return { ok: true, item: view_(it, role) };
    const tokenOk = req.token && String(req.token) === String(it.claimToken);
    if (!tokenOk && role !== 'owner') return fail_('Only the person who claimed it (or the owner) can release this.', 'FORBIDDEN');
    who = it.claimedBy;
    next = handOn_(it);
    it.updated = String(Date.now());
    writeItem_(it);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  log_('release', it, who, (role === 'owner' && !req.token ? 'by owner' : '') + (next ? ' → passed to ' + next : ''));
  if (role !== 'owner') {
    notify_(who + ' released "' + it.title + '"', who + ' no longer wants "' + it.title + '". ' +
      (next ? 'It passed automatically to ' + next + ', who was next on the waitlist.' : 'It is available again.') +
      '\n\n' + siteLine_());
  }
  return { ok: true, item: view_(it, role) };
}

function queue_(req, role) {
  const name = clip_(req.name, 60).replace(/\s+/g, ' ');
  const message = clip_(req.message, 500);
  if (!name) return fail_('Please enter your name.', 'INVALID');
  const slots = readSlots_();
  let it, entry, pos;
  const lock = lock_();
  try {
    it = findItem_(req.id);
    if (!it || hidden_(it, role)) return fail_('This item no longer exists.', 'NOT_FOUND');
    if (!it.status || it.status === 'available') return fail_('Good news — this is available again. You can claim it now.', 'AVAILABLE', { item: view_(it, role) });
    if (it.status !== 'claimed') return fail_('This item is no longer available.', 'UNAVAILABLE', { item: view_(it, role) });
    const q = parseQueue_(it.waitlist);
    if (q.length >= MAX_QUEUE) return fail_('The waitlist for this item is full.', 'FULL', { item: view_(it, role) });
    entry = { name: name, message: message, slot: cleanSlot_(req.slot, slots), token: Utilities.getUuid(), at: Date.now() };
    if (req.anon === true) entry.anon = true;
    q.push(entry);
    pos = q.length;
    it.waitlist = JSON.stringify(q);
    it.updated = String(Date.now());
    writeItem_(it);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  log_('waitlist', it, name, '#' + pos + (message ? ' — ' + message : ''));
  return { ok: true, token: entry.token, position: pos, item: view_(it, role) };
}

function leaveQueue_(req, role) {
  let it, gone;
  const lock = lock_();
  try {
    it = findItem_(req.id);
    if (!it || hidden_(it, role)) return { ok: true };
    const q = parseQueue_(it.waitlist);
    let i = -1;
    if (role === 'owner' && req.index != null && !req.token) i = Number(req.index);
    else if (req.token) i = q.map(function (e) { return e.token; }).indexOf(String(req.token));
    if (i < 0 || i >= q.length) return { ok: true, item: view_(it, role) };
    gone = q.splice(i, 1)[0];
    it.waitlist = JSON.stringify(q);
    it.updated = String(Date.now());
    writeItem_(it);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  if (gone) log_('left waitlist', it, gone.name, role === 'owner' && !req.token ? 'removed by owner' : '');
  return { ok: true, item: view_(it, role) };
}

function setSlot_(req, role) {
  const slots = readSlots_();
  const slot = cleanSlot_(req.slot, slots);
  const claims = Array.isArray(req.claims) ? req.claims.slice(0, 100) : [];
  const out = [], changed = [];
  const lock = lock_();
  try {
    const items = readItems_();
    claims.forEach(function (c) {
      const it = items.filter(function (x) { return x.id === String(c && c.id); })[0];
      if (!it || it.status !== 'claimed') return;
      const ok = role === 'owner' || (c.token && String(c.token) === String(it.claimToken));
      if (!ok) return;
      if ((it.pickupSlot || '') !== slot) {
        it.pickupSlot = slot;
        it.updated = String(Date.now());
        writeItem_(it);
        changed.push(it);
      }
      out.push(it);
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  if (changed.length && role !== 'owner') {
    const who = changed[0].claimedBy;
    notify_(who + ' changed their pickup time',
      who + ' will pick up: ' + (pickupLabel_(slot, slots) || 'no time chosen') + '\n\n' +
      changed.map(function (it) { return '• ' + it.title; }).join('\n') + '\n\n' + siteLine_());
  }
  return { ok: true, items: out.map(function (it) { return view_(it, role); }) };
}

function saveItem_(req) {
  const src = req.item || {};
  if (!clip_(src.title, TEXT_FIELDS.title)) return fail_('A title is needed.', 'INVALID');
  const photos = (Array.isArray(src.photos) ? src.photos : [])
    .map(String).filter(function (p) { return /^[\w-]{10,}$/.test(p); }).slice(0, MAX_PHOTOS);
  let it, removed = [];
  const lock = lock_();
  try {
    it = src.id ? findItem_(src.id) : null;
    if (src.id && !it) return fail_('This item no longer exists — it may have been deleted.', 'NOT_FOUND');
    if (!it) it = { id: newId_(), status: 'available', created: String(Date.now()) };
    // "keep" only applies to items nobody has claimed; older pages don't send these fields, so leave them alone then
    if (src.keep === true && it.status !== 'keep') {
      if (it.status === 'claimed') return fail_('Release the claim before keeping this item.', 'INVALID');
      if (it.status === 'gone') return fail_('This item has already gone.', 'INVALID');
      it.status = 'keep';
      it.waitlist = '[]';
    } else if (src.keep === false && it.status === 'keep') {
      it.status = 'available';
    }
    if ('quantity' in src) it.quantity = String(qty_(src.quantity));
    if ('measured' in src) it.measured = src.measured ? 'yes' : '';
    const oldPhotos = parsePhotos_(it.photos);
    Object.keys(TEXT_FIELDS).forEach(function (k) { it[k] = clip_(src[k], TEXT_FIELDS[k]); });
    it.photos = JSON.stringify(photos);
    it.updated = String(Date.now());
    const arrows = parseArrows_(it.dimLines);
    if (arrows && photos.indexOf(arrows.photo) < 0) it.dimLines = ''; // their photo was removed
    writeItem_(it);
    SpreadsheetApp.flush();
    removed = oldPhotos.filter(function (p) { return photos.indexOf(p) < 0; });
  } finally {
    lock.releaseLock();
  }
  trashPhotos_(removed);
  return { ok: true, item: view_(it, 'owner') };
}

function deleteItem_(req) {
  let it;
  const lock = lock_();
  try {
    it = findItem_(req.id);
    if (!it) return { ok: true };
    sheet_().deleteRow(it._row);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  trashPhotos_(parsePhotos_(it.photos));
  log_('delete', it, 'owner', '');
  return { ok: true };
}

function setStatus_(req) {
  const status = String(req.status || '');
  if (status !== 'available' && status !== 'gone' && status !== 'keep') return fail_('Status must be "available", "gone" or "keep".', 'INVALID');
  let it, next = '';
  const lock = lock_();
  try {
    it = findItem_(req.id);
    if (!it) return fail_('This item no longer exists.', 'NOT_FOUND');
    if (status === 'keep') {
      if (it.status !== 'available' && it.status !== 'keep') return fail_('Only an unclaimed item can be kept.', 'INVALID');
      it.status = 'keep';
      it.waitlist = '[]';
    } else if (status === 'available') {
      if (it.status === 'claimed') next = handOn_(it); // releasing a claim passes it down the waitlist
      else { clearClaim_(it); it.status = 'available'; it.waitlist = '[]'; }
    } else {
      it.status = 'gone';
      it.waitlist = '[]';
    }
    it.updated = String(Date.now());
    writeItem_(it);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  log_(status === 'gone' ? 'handed over' : status === 'keep' ? 'keeping' : next ? 'released → passed to ' + next : 'made available', it, 'owner', '');
  return { ok: true, item: view_(it, 'owner') };
}

function saveSlots_(req) {
  const src = Array.isArray(req.slots) ? req.slots.slice(0, MAX_SLOTS) : [];
  const out = [];
  src.forEach(function (s) {
    const start = num_(s && s.start), end = num_(s && s.end);
    if (!start || !(end > start) || end - start > 7 * 864e5) return;
    const id = /^[\w-]{2,40}$/.test(String((s && s.id) || '')) ? String(s.id) : newId_();
    out.push({ id: id, start: start, end: end });
  });
  out.sort(function (a, b) { return a.start - b.start; });
  const lock = lock_();
  try {
    writeSlots_(out);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, slots: out };
}

/** Owner-only: save (or with arrows = null, remove) the dimension arrows drawn on one of the item's photos. */
function saveArrows_(req) {
  let it;
  const lock = lock_();
  try {
    it = findItem_(req.id);
    if (!it) return fail_('This item no longer exists.', 'NOT_FOUND');
    if (req.arrows == null) it.dimLines = '';
    else {
      const a = cleanArrows_(req.arrows, parsePhotos_(it.photos));
      if (!a) return fail_('Those arrows don’t belong to a photo of this item.', 'INVALID');
      it.dimLines = JSON.stringify(a);
    }
    it.updated = String(Date.now());
    writeItem_(it);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, item: view_(it, 'owner') };
}

// { photo: '<photo id>', lines: { w: [[x, y], [x, y]], d: …, h: … } } with x, y as fractions of the photo's width and height
function cleanArrows_(a, photos) {
  if (!a || typeof a !== 'object' || photos.indexOf(String(a.photo)) < 0) return null;
  const lines = {};
  ['w', 'd', 'h'].forEach(function (k) {
    const L = a.lines && a.lines[k];
    if (!Array.isArray(L) || L.length !== 2) return;
    const pts = L.map(function (p) {
      return Array.isArray(p) && p.length === 2 ? p.map(function (v) { const n = Number(v); return isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 1e4) / 1e4 : NaN; }) : null;
    });
    if (pts.every(function (p) { return p && !isNaN(p[0]) && !isNaN(p[1]); })) lines[k] = pts;
  });
  return Object.keys(lines).length ? { photo: String(a.photo), lines: lines } : null;
}
function parseArrows_(v) {
  if (!v) return null;
  try { const a = JSON.parse(v); return a && a.photo && a.lines ? a : null; } catch (e) { return null; }
}

/** Owner-only inventory export for storage planning. Deliberately leaves out names, notes, tokens, prices and photos. */
function export_() {
  return {
    ok: true, format: 'move-inventory', version: 1, exportedAt: new Date().toISOString(), source: SETTINGS.SITE_URL || '',
    items: readItems_().map(function (it) {
      const status = status_(it);
      return {
        id: it.id, title: it.title || '', category: it.category || '', room: it.room || '',
        status: status, disposition: status === 'keep' ? 'store' : 'give',
        quantity: qty_(it.quantity), measured: measured_(it.measured),
        dimensions: dimsCm_(it.dimensions || ''), dimensionsRaw: it.dimensions || '', updated: num_(it.updated),
      };
    }),
  };
}

// Same parsing as the page's parseDims/toCm/dimsCm: { w, d, h, unit: 'cm' } when width, depth and height
// are all known (mm/cm/m/in converted to cm, rounded to 0.1), otherwise null.
const UNIT_TO_CM_ = { mm: 0.1, cm: 1, m: 100, in: 2.54 };
function parseDims_(s) {
  s = String(s || '');
  const g = function (k) { return (s.match(new RegExp('\\b' + k + '\\s*([\\d.,]+)', 'i')) || [])[1] || ''; };
  const unit = (s.match(/\b(mm|cm|m|in)\b/i) || [])[1] || 'cm';
  const out = { w: g('W'), d: g('D'), h: g('H'), unit: unit.toLowerCase() };
  out.parsed = !s.trim() || !!(out.w || out.d || out.h);
  return out;
}
function toCm_(v, unit) {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  if (!isFinite(n) || n <= 0 || !(unit in UNIT_TO_CM_)) return null;
  return Math.round(n * UNIT_TO_CM_[unit] * 10) / 10;
}
function dimsCm_(raw) {
  if (!String(raw || '').trim()) return null;
  const p = parseDims_(raw);
  if (!p.parsed) return null;
  const w = toCm_(p.w, p.unit), d = toCm_(p.d, p.unit), h = toCm_(p.h, p.unit);
  return w != null && d != null && h != null ? { w: w, d: d, h: h, unit: 'cm' } : null;
}

function uploadPhoto_(req) {
  const data = String(req.data || '');
  if (!data) return fail_('No photo received.', 'INVALID');
  if (data.length > MAX_UPLOAD_CHARS) return fail_('That photo is too large.', 'TOO_LARGE');
  const mime = /^image\/(jpeg|png|webp|gif)$/.test(req.mime) ? req.mime : 'image/jpeg';
  const name = clip_(req.name, 80) || ('photo-' + Date.now() + '.jpg');
  const blob = Utilities.newBlob(Utilities.base64Decode(data), mime, name);
  const file = photoFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, id: file.getId() };
}

// ---------- claims & waitlist ----------
/** Passes a claimed item to the next person on its waitlist, or makes it available. Call inside the lock. */
function handOn_(it) {
  const q = parseQueue_(it.waitlist);
  const next = q.shift();
  it.waitlist = JSON.stringify(q);
  if (!next) {
    clearClaim_(it);
    it.status = 'available';
    return '';
  }
  it.status = 'claimed';
  it.claimedBy = next.name;
  it.claimedAt = String(Date.now());
  it.claimMessage = next.message || '';
  it.claimToken = next.token; // the waitlist token becomes the claim token, so their browser knows it's theirs
  it.claimAnon = next.anon ? '1' : '';
  it.pickupSlot = next.slot || '';
  return next.name;
}

function you_(items, tokens) {
  const set = {};
  tokens.forEach(function (t) { if (t) set[t] = true; });
  const you = {};
  items.forEach(function (it) {
    if (it.claimToken && set[it.claimToken]) { you[it.id] = 'claim'; return; }
    const q = parseQueue_(it.waitlist);
    for (let i = 0; i < q.length; i++) if (q[i].token && set[q[i].token]) { you[it.id] = i + 1; return; }
  });
  return you;
}

function parseQueue_(v) {
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.filter(function (e) { return e && e.name; }) : []; } catch (e) { return []; }
}

// ---------- pickup slots ----------
function slotSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Slots');
  if (!sh) {
    sh = ss.insertSheet('Slots');
    sh.getRange(1, 1, 1, 4).setValues([['id', 'start', 'end', 'when']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readSlots_() {
  const sh = slotSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 3).getDisplayValues()
    .map(function (r) { return { id: String(r[0]), start: num_(r[1]), end: num_(r[2]) }; })
    .filter(function (s) { return s.id && s.start && s.end > s.start; })
    .sort(function (a, b) { return a.start - b.start; });
}

function writeSlots_(slots) {
  const sh = slotSheet_();
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, 4).clearContent();
  if (!slots.length) return;
  const rows = slots.map(function (s) { return [s.id, String(s.start), String(s.end), slotLabel_(s)]; });
  const range = sh.getRange(2, 1, rows.length, 4);
  range.setNumberFormat('@');
  range.setValues(rows);
}

function cleanSlot_(v, slots) {
  v = String(v || '');
  if (v === 'other') return 'other';
  return (slots || []).some(function (s) { return s.id === v; }) ? v : '';
}

function slotLabel_(s) {
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return Utilities.formatDate(new Date(s.start), tz, 'EEE d MMM, HH:mm') + '–' + Utilities.formatDate(new Date(s.end), tz, 'HH:mm');
}

function pickupLabel_(id, slots) {
  if (id === 'other') return 'none of your times work — they’d like to arrange another';
  const s = (slots || readSlots_()).filter(function (x) { return x.id === id; })[0];
  return s ? slotLabel_(s) : '';
}

// ---------- sheet storage ----------
function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Items');
  if (!sh) sh = ss.insertSheet('Items');
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function header_(sh) {
  const width = Math.max(sh.getLastColumn(), 1);
  const header = sh.getRange(1, 1, 1, width).getDisplayValues()[0].map(String);
  const missing = COLS.filter(function (c) { return header.indexOf(c) < 0; });
  if (missing.length) {
    sh.getRange(1, header.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    return header.concat(missing);
  }
  return header;
}

function readItems_() {
  const sh = sheet_();
  const header = header_(sh);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, header.length).getDisplayValues();
  const items = [];
  rows.forEach(function (r, i) {
    const it = { _row: i + 2 };
    header.forEach(function (h, j) { if (h) it[h] = r[j]; });
    if (it.id) items.push(it);
  });
  return items;
}

function findItem_(id) {
  id = String(id || '');
  if (!id) return null;
  const items = readItems_();
  for (let i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
  return null;
}

function writeItem_(it) {
  const sh = sheet_();
  const header = header_(sh);
  const row = header.map(function (h) {
    const v = it[h] == null ? '' : String(it[h]);
    return v.charAt(0) === '=' ? "'" + v : v; // never let text become a formula
  });
  let r = it._row;
  if (!r) {
    r = sh.getLastRow() + 1;
    if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 20);
  }
  const range = sh.getRange(r, 1, 1, header.length);
  range.setNumberFormat('@'); // keep "1/2" or "007" as typed
  range.setValues([row]);
  it._row = r;
}

// a claimer can hide their name: then only the owner gets it, everyone else gets '' plus anon: true
const isAnon_ = function (it) { return String(it.claimAnon || '') === '1'; };
function shownName_(it, role) { return role === 'owner' || !isAnon_(it) ? (it.claimedBy || '') : ''; }
function view_(it, role) {
  const owner = role === 'owner';
  const v = {
    id: it.id, title: it.title || '', description: it.description || '', category: it.category || '',
    condition: it.condition || '', dimensions: it.dimensions || '', price: it.price || '', room: it.room || '',
    pickup: it.pickup || '', photos: parsePhotos_(it.photos), status: status_(it), quantity: qty_(it.quantity),
    claimedBy: shownName_(it, role), anon: !!it.claimedBy && isAnon_(it), claimedAt: num_(it.claimedAt), created: num_(it.created), updated: num_(it.updated),
    pickupSlot: it.pickupSlot || '', dimLines: parseArrows_(it.dimLines),
    waitlist: parseQueue_(it.waitlist).map(function (e) {
      const anon = e.anon === true;
      return owner ? { name: e.name, at: e.at, message: e.message || '', slot: e.slot || '', anon: anon } : { name: anon ? '' : e.name, at: e.at, anon: anon };
    }),
  };
  if (owner) { v.claimMessage = it.claimMessage || ''; v.measured = measured_(it.measured); }
  return v;
}

function clearClaim_(it) { it.claimedBy = ''; it.claimedAt = ''; it.claimMessage = ''; it.claimToken = ''; it.pickupSlot = ''; it.claimAnon = ''; }

// ---------- helpers ----------
function roleFor_(key) {
  key = String(key == null ? '' : key).trim();
  if (!key) return null;
  if (key === String(SETTINGS.OWNER_CODE)) return 'owner';
  if (key === String(SETTINGS.FRIEND_CODE)) return 'friend';
  if (String(SETTINGS.STORAGE_CODE || '').trim() && key === String(SETTINGS.STORAGE_CODE).trim()) return 'storage';
  return null;
}
/** One request at a time touches the sheet. Waits up to 20 s, then asks the visitor to retry. */
function lock_() {
  const l = LockService.getScriptLock();
  if (!l.tryLock(20000)) throw new Error('Lots of people are using the page right now — please try again in a moment.');
  return l;
}
function status_(it) { return STATUSES.indexOf(it.status) >= 0 ? it.status : 'available'; }
function hidden_(it, role) { return role !== 'owner' && status_(it) === 'keep'; }
function qty_(v) { const n = Math.floor(num_(v)); return n >= 1 ? Math.min(n, 999) : 1; }
function measured_(v) { return /^(yes|true|y|1|x)$/i.test(String(v == null ? '' : v).trim()); }
function clip_(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }
function num_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function newId_() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function fail_(error, code, extra) { return Object.assign({ ok: false, error: error, code: code || 'ERROR' }, extra || {}); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function siteLine_() { return SETTINGS.SITE_URL ? 'Open the site: ' + SETTINGS.SITE_URL + '\n' : ''; }

function parsePhotos_(v) {
  if (Array.isArray(v)) return v.map(String);
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch (e) { return []; }
}

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* recreate below */ }
  }
  const folder = DriveApp.createFolder(SETTINGS.SITE_NAME + ' photos');
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function trashPhotos_(ids) {
  (ids || []).forEach(function (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* already gone */ } });
}

function log_(action, it, who, note) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('Log');
    if (!sh) {
      sh = ss.insertSheet('Log');
      sh.appendRow(['when', 'action', 'item id', 'item', 'who', 'note']);
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), action, it.id, it.title, who || '', note || '']);
  } catch (e) { console.error('log failed', e); }
}

function notify_(subject, body) {
  try {
    const to = SETTINGS.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
    MailApp.sendEmail({ to: to, subject: subject, body: body, name: SETTINGS.SITE_NAME });
  } catch (e) { console.error('email failed', e); }
}

// ---------- run these from the editor ----------
/** Run once after pasting: creates the tabs + photo folder and asks for permissions. Safe to run again. */
function setup() {
  sheet_();
  header_(sheet_()); // adds any new columns (waitlist, pickupSlot, quantity, measured, dimLines, claimAnon) to an existing sheet
  slotSheet_();
  const folder = photoFolder_();
  const want = SETTINGS.SITE_NAME + ' photos';
  if (folder.getName() !== want) folder.setName(want); // e.g. renames "Dibs photos" → "MOVE photos"
  const email = SETTINGS.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  MailApp.getRemainingDailyQuota(); // triggers the email permission prompt
  if (/^change-me/.test(SETTINGS.FRIEND_CODE) || /^change-me/.test(SETTINGS.OWNER_CODE)) {
    Logger.log('⚠️  Change FRIEND_CODE and OWNER_CODE in SETTINGS before sharing anything.');
  }
  if (SETTINGS.FRIEND_CODE === SETTINGS.OWNER_CODE) Logger.log('⚠️  FRIEND_CODE and OWNER_CODE must be different.');
  Logger.log('✅ Ready. Claim emails go to ' + email);
  Logger.log('📁 Photos folder: ' + folder.getUrl());
}

/** Optional: sends yourself a test notification. */
function sendTestEmail() {
  notify_(SETTINGS.SITE_NAME + ' test email', 'If you can read this, claim notifications work.');
  Logger.log('Sent. Check your inbox (and spam folder).');
}
