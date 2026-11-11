// Customer-experience features: paid inspection bookings, buyer-agent chat, reminders, favourites and
// saved searches, receipts and a document vault, reviews, title checks, referrals and the SPV unit market.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { db, addColumn, getSetting } = require('./db');
const { HttpError, requireAuth, requireRole } = require('./auth');
const listings = require('./listings');
const payments = require('./payments');
const push = require('./push');
const whatsapp = require('./whatsapp');

db.exec(`
CREATE TABLE IF NOT EXISTS inspections (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  agent_id INTEGER NOT NULL REFERENCES users(id),
  slot TEXT NOT NULL,                          -- local date-time, YYYY-MM-DDTHH:MM
  note TEXT NOT NULL DEFAULT '',
  fee INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'awaiting_payment', -- awaiting_payment | confirmed | completed | no_show | cancelled
  reminded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),
  buyer_seen INTEGER NOT NULL DEFAULT 0,
  seller_seen INTEGER NOT NULL DEFAULT 0,
  last_id INTEGER NOT NULL DEFAULT 0,
  UNIQUE (property_id, buyer_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS favourites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, property_id)
);
CREATE TABLE IF NOT EXISTS saved_searches (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  query TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id INTEGER,
  title TEXT NOT NULL,
  file TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  agent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, property_id)
);
CREATE TABLE IF NOT EXISTS title_checks (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  fee INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_payment', -- awaiting_payment | requested | completed
  result TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS unit_listings (
  id INTEGER PRIMARY KEY,
  spv_id INTEGER NOT NULL REFERENCES spvs(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),
  buyer_id INTEGER,
  units INTEGER NOT NULL,
  price_per_unit INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',         -- open | sold | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
void addColumn;

const DOCS_DIR = path.join(config.DATA_DIR, 'docs'); // private
fs.mkdirSync(DOCS_DIR, { recursive: true });
const DOC_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const docUpload = multer({ dest: config.TMP_DIR, limits: { fileSize: 15 * 1024 * 1024, files: 1 }, fileFilter: (_r, f, cb) => cb(null, Boolean(DOC_TYPES[f.mimetype])) });

const { int, str, naira } = listings;
const r = express.Router();
const num = (v) => Number(v) || 0;
const userById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
/** WhatsApp is best-effort: outside Meta's 24-hour window a plain message may be refused. */
const wa = (phone, text) => whatsapp.sendText(phone, text).catch(() => {});
const when = (slot) => { const d = new Date(slot); return `${d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} at ${slot.slice(11, 16)}`; };
const fullAccess = (user, p) => listings.canManage(user, p) || listings.unlockFee(p) === 0 || listings.hasUnlocked(user, p);

// =========================================================== inspections (fee confirms the booking)

function parseSlot(v) {
  const s = String(v || '').slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) || Number.isNaN(new Date(s).getTime())) throw new HttpError(400, 'Choose a date and time.');
  if (new Date(s).getTime() < Date.now() + 2 * 3600 * 1000) throw new HttpError(400, 'Please choose a time at least 2 hours from now.');
  const hour = Number(s.slice(11, 13));
  if (hour < 8 || hour >= 18) throw new HttpError(400, 'Inspections run between 8am and 6pm.');
  return s;
}

function confirmInspection(i, after) {
  db.prepare("UPDATE inspections SET status = 'confirmed' WHERE id = ?").run(i.id);
  // The buyer needs the address to attend, so a paid inspection also unlocks the listing.
  db.prepare('INSERT OR IGNORE INTO unlocks(user_id, property_id) VALUES(?,?)').run(i.user_id, i.property_id);
  const p = listings.getProperty(i.property_id);
  const buyer = userById(i.user_id), agent = userById(i.agent_id);
  after.push(() => {
    push.notify({ userId: agent.id, title: 'Inspection confirmed (fee paid)', body: `${buyer.name || 'A buyer'} · ${p.title} · ${when(i.slot)}`, url: '/dashboard?tab=inspections' });
    push.notify({ userId: buyer.id, title: 'Inspection confirmed', body: `${p.title} · ${when(i.slot)}`, url: '/dashboard?tab=inspections' });
    wa(agent.phone, `Inspection CONFIRMED - the buyer has paid the inspection fee.\n${p.title} (#${p.id})\n${when(i.slot)}\nBuyer: ${buyer.name} +${buyer.phone}${i.note ? `\nNote: ${i.note}` : ''}`);
    wa(buyer.phone, `Your inspection is confirmed.\n${p.title}\n${when(i.slot)}\nAddress: ${p.address || listings.place(p)}\nContact: ${p.contact_phone}\nYour fee is credited towards the price if you buy through ${config.SITE_NAME} escrow.`);
  });
}

payments.handlers.inspection = (pay, already, after) => {
  const i = db.prepare('SELECT * FROM inspections WHERE id = ?').get(pay.target_id);
  if (!already && i && i.status === 'awaiting_payment') confirmInspection(i, after);
  return { redirect: '/dashboard?tab=inspections', message: 'Inspection confirmed. The agent has been notified.' };
};

r.post('/properties/:id/inspections', requireAuth, async (req, res) => {
  const p = listings.mustGet(req.params.id);
  if (p.status !== 'active') throw new HttpError(409, 'This property is no longer available.');
  if (p.owner_id === req.user.id) throw new HttpError(400, 'This is your own listing.');
  const slot = parseSlot(req.body.slot);
  const clash = db.prepare("SELECT 1 FROM inspections WHERE property_id = ? AND slot = ? AND status = 'confirmed'").get(p.id, slot);
  if (clash) throw new HttpError(409, 'That time is already booked. Please choose another.');
  const open = db.prepare("SELECT id FROM inspections WHERE property_id = ? AND user_id = ? AND status = 'confirmed'").get(p.id, req.user.id);
  if (open) throw new HttpError(409, 'You already have a confirmed inspection for this property. You can reschedule it from your dashboard.');
  db.prepare("DELETE FROM inspections WHERE property_id = ? AND user_id = ? AND status = 'awaiting_payment'").run(p.id, req.user.id);
  const fee = int(getSetting('inspection_fee'));
  const id = db.prepare('INSERT INTO inspections(property_id, user_id, agent_id, slot, note, fee) VALUES(?,?,?,?,?,?)')
    .run(p.id, req.user.id, p.owner_id, slot, str(req.body.note, 300), fee).lastInsertRowid;
  if (fee === 0) {
    const after = [];
    confirmInspection(db.prepare('SELECT * FROM inspections WHERE id = ?').get(id), after);
    after.forEach((fn) => fn());
    return res.json({ confirmed: true });
  }
  res.json(await payments.start(req.user, 'inspection', id, fee));
});

const inspectionRows = (where, ...args) => db
  .prepare(`SELECT i.*, p.title AS property_title, p.address, b.name AS buyer_name, b.phone AS buyer_phone, a.name AS agent_name, p.contact_phone
              FROM inspections i JOIN properties p ON p.id = i.property_id JOIN users b ON b.id = i.user_id JOIN users a ON a.id = i.agent_id
             WHERE ${where} ORDER BY i.slot DESC LIMIT 200`).all(...args);

r.get('/my/inspections', requireAuth, (req, res) => {
  res.json(inspectionRows("(i.user_id = ? OR (i.agent_id = ? AND i.status != 'awaiting_payment'))", req.user.id, req.user.id)
    .map((i) => ({ ...i, role: i.user_id === req.user.id ? 'buyer' : 'agent' })));
});

function mustInspection(req) {
  const i = db.prepare('SELECT * FROM inspections WHERE id = ?').get(num(req.params.id));
  const mine = i && (i.user_id === req.user.id || i.agent_id === req.user.id || req.user.role === 'admin');
  if (!mine) throw new HttpError(404, 'Inspection not found.');
  return i;
}

r.post('/inspections/:id/status', requireAuth, (req, res) => {
  const i = mustInspection(req);
  const to = String(req.body.status);
  const staff = i.agent_id === req.user.id || req.user.role === 'admin';
  const allowed = staff ? ['completed', 'no_show', 'cancelled'] : ['cancelled'];
  if (!allowed.includes(to)) throw new HttpError(403, 'You cannot set that status.');
  if (i.status !== 'confirmed' && !(to === 'cancelled' && i.status === 'awaiting_payment')) throw new HttpError(409, 'This inspection can no longer be changed.');
  db.prepare('UPDATE inspections SET status = ? WHERE id = ?').run(to, i.id);
  const p = listings.getProperty(i.property_id);
  const other = req.user.id === i.user_id ? i.agent_id : i.user_id;
  if (i.status === 'confirmed') push.notify({ userId: other, title: `Inspection ${to.replace('_', ' ')}`, body: `${p.title} · ${when(i.slot)}`, url: '/dashboard?tab=inspections' });
  // A paid inspection cancelled by the agent/company is flagged for a refund.
  if (to === 'cancelled' && staff && i.status === 'confirmed' && i.fee > 0) push.notifyAdmins({ title: 'Refund inspection fee', body: `Inspection #${i.id} was cancelled by the agent (${naira(i.fee)}).`, url: '/admin?tab=desk' });
  res.json({ ok: true });
});

r.post('/inspections/:id/reschedule', requireAuth, (req, res) => {
  const i = mustInspection(req);
  if (i.status !== 'confirmed') throw new HttpError(409, 'Only a confirmed inspection can be rescheduled.');
  const slot = parseSlot(req.body.slot);
  db.prepare('UPDATE inspections SET slot = ?, reminded = 0 WHERE id = ?').run(slot, i.id);
  const p = listings.getProperty(i.property_id);
  const other = userById(req.user.id === i.user_id ? i.agent_id : i.user_id);
  push.notify({ userId: other.id, title: 'Inspection rescheduled', body: `${p.title} · now ${when(slot)}`, url: '/dashboard?tab=inspections' });
  wa(other.phone, `Inspection rescheduled: ${p.title} is now ${when(slot)}.`);
  res.json({ ok: true });
});

// =========================================================== chat

const threadView = (t, user) => {
  const mine = t.buyer_id === user.id ? 'buyer' : 'seller';
  const other = userById(mine === 'buyer' ? t.seller_id : t.buyer_id);
  const p = listings.getProperty(t.property_id);
  const last = db.prepare('SELECT body, created_at FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1').get(t.id);
  return {
    id: t.id, property_id: t.property_id, property_title: p ? p.title : '', with: other ? other.company || other.name || 'Member' : 'Member',
    unread: t.last_id > t[`${mine}_seen`], last: last ? last.body.slice(0, 80) : '', last_at: last ? last.created_at : '',
  };
};
const mustThread = (req) => {
  const t = db.prepare('SELECT * FROM threads WHERE id = ?').get(num(req.params.id));
  if (!t || ![t.buyer_id, t.seller_id].includes(req.user.id)) throw new HttpError(404, 'Conversation not found.');
  return t;
};

r.post('/properties/:id/chat', requireAuth, (req, res) => {
  const p = listings.mustGet(req.params.id);
  if (!['active', 'sold'].includes(p.status)) throw new HttpError(404, 'Listing not found.');
  if (p.owner_id === req.user.id) throw new HttpError(400, 'This is your own listing.');
  if (!fullAccess(req.user, p)) throw new HttpError(403, 'Unlock this listing to message the agent.');
  db.prepare('INSERT OR IGNORE INTO threads(property_id, buyer_id, seller_id) VALUES(?,?,?)').run(p.id, req.user.id, p.owner_id);
  res.json({ id: db.prepare('SELECT id FROM threads WHERE property_id = ? AND buyer_id = ?').get(p.id, req.user.id).id });
});

r.get('/my/threads', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM threads WHERE (buyer_id = ? OR seller_id = ?) AND last_id > 0 ORDER BY last_id DESC LIMIT 100').all(req.user.id, req.user.id);
  res.json(rows.map((t) => threadView(t, req.user)));
});

r.get('/threads/:id', requireAuth, (req, res) => {
  const t = mustThread(req);
  const side = t.buyer_id === req.user.id ? 'buyer_seen' : 'seller_seen';
  db.prepare(`UPDATE threads SET ${side} = last_id WHERE id = ?`).run(t.id);
  const rows = db.prepare('SELECT id, sender_id, body, created_at FROM messages WHERE thread_id = ? AND id > ? ORDER BY id LIMIT 300').all(t.id, num(req.query.after));
  res.json({ ...threadView(t, req.user), unread: false, messages: rows.map((m) => ({ ...m, mine: m.sender_id === req.user.id })) });
});

r.post('/threads/:id/messages', requireAuth, (req, res) => {
  const t = mustThread(req);
  const body = str(req.body.body, 2000);
  if (!body) throw new HttpError(400, 'Type a message.');
  const id = db.prepare('INSERT INTO messages(thread_id, sender_id, body) VALUES(?,?,?)').run(t.id, req.user.id, body).lastInsertRowid;
  const side = t.buyer_id === req.user.id ? 'buyer_seen' : 'seller_seen';
  db.prepare(`UPDATE threads SET last_id = ?, ${side} = ? WHERE id = ?`).run(id, id, t.id);
  const other = t.buyer_id === req.user.id ? t.seller_id : t.buyer_id;
  push.notify({ userId: other, title: `Message from ${req.user.company || req.user.name || 'a member'}`, body: body.slice(0, 120), url: `/dashboard?tab=messages&t=${t.id}` });
  res.status(201).json({ id });
});

// =========================================================== favourites + saved searches

r.post('/properties/:id/favourite', requireAuth, (req, res) => {
  const p = listings.mustGet(req.params.id);
  const del = db.prepare('DELETE FROM favourites WHERE user_id = ? AND property_id = ?').run(req.user.id, p.id).changes;
  if (!del) db.prepare('INSERT INTO favourites(user_id, property_id) VALUES(?,?)').run(req.user.id, p.id);
  res.json({ fav: !del });
});

r.get('/my/favourites', requireAuth, (req, res) => {
  const rows = db.prepare("SELECT p.* FROM favourites f JOIN properties p ON p.id = f.property_id WHERE f.user_id = ? AND p.status IN ('active','sold') ORDER BY p.id DESC").all(req.user.id);
  res.json(rows.map((p) => listings.present(p, req.user)));
});

const SEARCH_KEYS = ['q', 'purpose', 'type', 'state', 'city', 'min', 'max', 'beds', 'easy', 'verified', 'new_dev'];
r.post('/saved-searches', requireAuth, (req, res) => {
  const q = {};
  for (const k of SEARCH_KEYS) if (req.body.query && req.body.query[k]) q[k] = str(req.body.query[k], 60);
  if (!Object.keys(q).length) throw new HttpError(400, 'Set at least one filter before saving a search.');
  if (db.prepare('SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?').get(req.user.id).n >= 10) throw new HttpError(400, 'You can save up to 10 searches.');
  const name = str(req.body.name, 60) || Object.values(q).join(' · ');
  db.prepare('INSERT INTO saved_searches(user_id, name, query) VALUES(?,?,?)').run(req.user.id, name, JSON.stringify(q));
  res.status(201).json({ ok: true });
});
r.get('/saved-searches', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY id DESC').all(req.user.id).map((s) => ({ ...s, query: JSON.parse(s.query) })));
});
r.delete('/saved-searches/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').run(num(req.params.id), req.user.id);
  res.json({ ok: true });
});

function matches(q, p) {
  const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  if (q.q && ![p.title, p.city, p.area, p.state].some((v) => v.toLowerCase().includes(q.q.toLowerCase()))) return false;
  if (q.purpose && q.purpose !== p.purpose) return false;
  if (q.type && q.type !== p.type) return false;
  if (q.state && !eq(q.state, p.state)) return false;
  if (q.city && !eq(q.city, p.city)) return false;
  if (int(q.min) && p.price < int(q.min)) return false;
  if (int(q.max) && p.price > int(q.max)) return false;
  if (int(q.beds) && p.bedrooms < int(q.beds)) return false;
  if (q.easy && !p.easy_buy) return false;
  if (q.verified && !p.verified) return false;
  if (q.new_dev && !p.new_dev) return false;
  return true;
}
listings.hooks.onPublish.push((p) => {
  const told = new Set([p.owner_id]);
  for (const s of db.prepare('SELECT * FROM saved_searches').all()) {
    if (told.has(s.user_id) || !matches(JSON.parse(s.query), p)) continue;
    told.add(s.user_id);
    push.notify({ userId: s.user_id, title: `New match: ${s.name}`, body: `${p.title} — ${naira(p.price)}`, url: `/p/${p.id}` });
  }
});

// =========================================================== payments history, receipts, document vault

const LABELS = { unlock: 'Listing details access', escrow: 'Escrow payment', installment: 'Easy-buy instalment', investment: 'SPV units', inspection: 'Inspection fee', title_check: 'Title verification report', unit_trade: 'SPV units (resale)' };
function describe(pay) {
  const one = (sql) => db.prepare(sql).get(pay.target_id);
  const row = {
    unlock: () => one('SELECT title FROM properties WHERE id = ?'),
    escrow: () => one('SELECT p.title FROM escrows e JOIN properties p ON p.id = e.property_id WHERE e.id = ?'),
    installment: () => one('SELECT p.title FROM installments i JOIN subscriptions s ON s.id = i.subscription_id JOIN properties p ON p.id = s.property_id WHERE i.id = ?'),
    investment: () => one('SELECT s.title FROM investments i JOIN spvs s ON s.id = i.spv_id WHERE i.id = ?'),
    inspection: () => one('SELECT p.title FROM inspections i JOIN properties p ON p.id = i.property_id WHERE i.id = ?'),
    title_check: () => one('SELECT p.title FROM title_checks t JOIN properties p ON p.id = t.property_id WHERE t.id = ?'),
    unit_trade: () => one('SELECT s.title FROM unit_listings u JOIN spvs s ON s.id = u.spv_id WHERE u.id = ?'),
  }[pay.purpose];
  const hit = row ? row() : null;
  return { label: LABELS[pay.purpose] || pay.purpose, item: hit ? hit.title : '' };
}

r.get('/my/payments', requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM payments WHERE user_id = ? AND status = 'paid' ORDER BY id DESC LIMIT 200").all(req.user.id);
  res.json(rows.map((p) => ({ reference: p.reference, amount: p.amount, paid_at: p.paid_at, ...describe(p) })));
});

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
r.get('/payments/:reference/receipt', requireAuth, (req, res) => {
  const p = db.prepare("SELECT * FROM payments WHERE reference = ? AND status = 'paid'").get(String(req.params.reference));
  if (!p || (p.user_id !== req.user.id && req.user.role !== 'admin')) throw new HttpError(404, 'Receipt not found.');
  const u = userById(p.user_id), d = describe(p);
  const line = (k, v) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`;
  res.setHeader('Cache-Control', 'private, no-store');
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt ${esc(p.reference)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;color:#1c2420;max-width:640px;margin:30px auto;padding:0 18px}h1{font:700 1.6rem Georgia,serif;color:#0f3d2e;margin:0}table{width:100%;border-collapse:collapse;margin:22px 0}td{padding:10px 4px;border-bottom:1px solid #e6e0d2}td:first-child{color:#66716b;width:40%}.amt{font:700 2rem Georgia,serif;color:#0f3d2e}.paid{display:inline-block;border:2px solid #14603c;color:#14603c;padding:2px 12px;border-radius:6px;font-weight:700;letter-spacing:.08em}button{padding:10px 18px;border:0;border-radius:8px;background:#0f3d2e;color:#fff;font:inherit;cursor:pointer}small{color:#66716b}@media print{button{display:none}}</style></head>
<body><h1>${esc(config.SITE_NAME)}</h1><small>${esc(config.COMPANY)}</small>
<p style="margin-top:26px">Payment receipt <span class="paid">PAID</span></p><p class="amt">${esc(naira(p.amount))}</p>
<table>${line('Reference', p.reference)}${line('Date (UTC)', p.paid_at)}${line('Received from', `${u.name || 'Member'} (+${u.phone})`)}${line('For', d.label)}${d.item ? line('Item', d.item) : ''}${line('Paid via', p.provider === 'demo' ? 'Demo checkout (no real money moved)' : 'Paystack')}</table>
<button onclick="print()">Print / save as PDF</button><p><small>This receipt was generated by ${esc(config.SITE_NAME)} and is valid without a signature.</small></p></body></html>`);
});

r.post('/documents', requireAuth, docUpload.single('file'), async (req, res) => {
  const f = req.file;
  try {
    if (!f) throw new HttpError(400, 'Choose a PDF or image (max 15 MB).');
    const title = str(req.body.title, 120);
    if (!title) throw new HttpError(400, 'Give the document a name.');
    // Admins can place a document (offer letter, deed, receipt...) in a member's vault.
    const owner = req.user.role === 'admin' && req.body.user_id ? userById(num(req.body.user_id)) : req.user;
    if (!owner) throw new HttpError(404, 'Member not found.');
    const name = `${crypto.randomBytes(16).toString('hex')}.${DOC_TYPES[f.mimetype]}`;
    await fs.promises.rename(f.path, path.join(DOCS_DIR, name));
    const prop = req.body.property_id ? listings.getProperty(req.body.property_id) : null;
    db.prepare('INSERT INTO documents(user_id, property_id, title, file, uploaded_by) VALUES(?,?,?,?,?)').run(owner.id, prop ? prop.id : null, title, name, req.user.id);
    if (owner.id !== req.user.id) push.notify({ userId: owner.id, title: 'New document in your vault', body: title, url: '/dashboard?tab=payments' });
  } catch (e) {
    if (f) fs.promises.unlink(f.path).catch(() => {});
    throw e;
  }
  res.status(201).json({ ok: true });
});
r.get('/my/documents', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT d.id, d.title, d.created_at, d.uploaded_by != d.user_id AS from_company, p.title AS property_title FROM documents d LEFT JOIN properties p ON p.id = d.property_id WHERE d.user_id = ? ORDER BY d.id DESC').all(req.user.id));
});
const mustDoc = (req) => {
  const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(num(req.params.id));
  if (!d || (d.user_id !== req.user.id && req.user.role !== 'admin')) throw new HttpError(404, 'Document not found.');
  return d;
};
r.get('/documents/:id/file', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(path.join(DOCS_DIR, path.basename(mustDoc(req).file)));
});
r.delete('/documents/:id', requireAuth, (req, res) => {
  const d = mustDoc(req);
  if (d.uploaded_by !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'Only the company can remove this document.');
  fs.promises.unlink(path.join(DOCS_DIR, path.basename(d.file))).catch(() => {});
  db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
  res.json({ ok: true });
});

// =========================================================== reviews (only after a real transaction)

function reviewable(userId, agentId) {
  return db.prepare(
    `SELECT DISTINCT p.id, p.title FROM properties p WHERE p.owner_id = ? AND p.id NOT IN (SELECT property_id FROM reviews WHERE user_id = ?) AND (
       p.id IN (SELECT property_id FROM escrows WHERE buyer_id = ? AND status = 'released') OR
       p.id IN (SELECT property_id FROM inspections WHERE user_id = ? AND status = 'completed'))`
  ).all(agentId, userId, userId, userId);
}
r.get('/agents/:id/reviews', (req, res) => {
  const id = num(req.params.id);
  const s = db.prepare('SELECT ROUND(AVG(rating), 1) AS avg, COUNT(*) AS n FROM reviews WHERE agent_id = ?').get(id);
  res.json({
    avg: s.avg, count: s.n,
    items: db.prepare('SELECT r.rating, r.comment, r.created_at, u.name FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.agent_id = ? ORDER BY r.id DESC LIMIT 50').all(id)
      .map((x) => ({ ...x, name: (x.name || 'Member').split(' ')[0] })),
    can_review: req.user ? reviewable(req.user.id, id) : [],
  });
});
r.post('/agents/:id/reviews', requireAuth, (req, res) => {
  const agentId = num(req.params.id);
  const rating = Math.round(num(req.body.rating));
  if (rating < 1 || rating > 5) throw new HttpError(400, 'Choose a rating from 1 to 5.');
  const ok = reviewable(req.user.id, agentId).find((p) => p.id === num(req.body.property_id));
  if (!ok) throw new HttpError(403, 'You can review an agent after a completed inspection or purchase with them.');
  db.prepare('INSERT INTO reviews(agent_id, user_id, property_id, rating, comment) VALUES(?,?,?,?,?)').run(agentId, req.user.id, ok.id, rating, str(req.body.comment, 600));
  push.notify({ userId: agentId, title: `New ${rating}-star review`, body: str(req.body.comment, 100), url: `/agents/${agentId}` });
  res.status(201).json({ ok: true });
});

// =========================================================== title verification report (paid add-on)

payments.handlers.title_check = (pay, already, after) => {
  const t = db.prepare('SELECT * FROM title_checks WHERE id = ?').get(pay.target_id);
  if (!already && t && t.status === 'awaiting_payment') {
    db.prepare("UPDATE title_checks SET status = 'requested' WHERE id = ?").run(t.id);
    after.push(() => push.notifyAdmins({ title: 'Title check requested', body: `Listing #${t.property_id}`, url: '/admin?tab=desk' }));
  }
  return { redirect: '/dashboard?tab=payments', message: 'Title check requested. We will send you the report.' };
};
r.post('/properties/:id/title-check', requireAuth, async (req, res) => {
  const p = listings.mustGet(req.params.id);
  if (p.status !== 'active') throw new HttpError(409, 'This property is no longer available.');
  const fee = int(getSetting('title_check_fee'));
  if (!fee) throw new HttpError(404, 'Title checks are not offered at the moment.');
  if (db.prepare("SELECT 1 FROM title_checks WHERE property_id = ? AND user_id = ? AND status != 'awaiting_payment'").get(p.id, req.user.id)) throw new HttpError(409, 'You have already ordered a title check for this property.');
  db.prepare("DELETE FROM title_checks WHERE property_id = ? AND user_id = ? AND status = 'awaiting_payment'").run(p.id, req.user.id);
  const id = db.prepare('INSERT INTO title_checks(property_id, user_id, fee) VALUES(?,?,?)').run(p.id, req.user.id, fee).lastInsertRowid;
  res.json(await payments.start(req.user, 'title_check', id, fee));
});
r.get('/my/title-checks', requireAuth, (req, res) => {
  res.json(db.prepare("SELECT t.*, p.title AS property_title FROM title_checks t JOIN properties p ON p.id = t.property_id WHERE t.user_id = ? AND t.status != 'awaiting_payment' ORDER BY t.id DESC").all(req.user.id));
});
r.post('/admin/title-checks/:id/complete', requireRole('admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM title_checks WHERE id = ?').get(num(req.params.id));
  const result = str(req.body.result, 4000);
  if (!t || t.status === 'awaiting_payment') throw new HttpError(404, 'Request not found.');
  if (result.length < 10) throw new HttpError(400, 'Write the findings of the search.');
  db.prepare("UPDATE title_checks SET status = 'completed', result = ?, completed_at = datetime('now') WHERE id = ?").run(result, t.id);
  push.notify({ userId: t.user_id, title: 'Your title report is ready', body: 'Open your dashboard to read it.', url: '/dashboard?tab=payments' });
  res.json({ ok: true });
});

r.post('/admin/escrows/:id/docs-checked', requireRole('admin'), (req, res) => {
  const e = db.prepare('SELECT * FROM escrows WHERE id = ?').get(num(req.params.id));
  if (!e) throw new HttpError(404, 'Escrow not found.');
  db.prepare('UPDATE escrows SET docs_checked = 1 WHERE id = ?').run(e.id);
  db.prepare("INSERT INTO escrow_events(escrow_id, actor_id, event) VALUES(?,?,'documents verified')").run(e.id, req.user.id);
  push.notify({ userId: e.buyer_id, title: 'Documents verified', body: 'The title documents for your purchase have been checked.', url: '/dashboard?tab=escrow' });
  res.json({ ok: true });
});

// =========================================================== referrals

const refCode = (id) => 'DG' + (id + 1000).toString(36).toUpperCase();
function applyReferral(user, code) {
  const m = String(code || '').toUpperCase().match(/^DG([0-9A-Z]{1,8})$/);
  if (!m) return;
  const ref = userById(parseInt(m[1], 36) - 1000);
  if (!ref || ref.id === user.id) return;
  db.prepare('UPDATE users SET referred_by = ? WHERE id = ?').run(ref.id, user.id);
  push.notify({ userId: ref.id, title: 'Someone joined with your link', body: `${user.name || 'A new member'} signed up.`, url: '/dashboard?tab=referrals' });
}
const QUALIFIED = "EXISTS (SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.status = 'paid' AND p.purpose IN ('escrow','installment','investment'))";
r.get('/my/referrals', requireAuth, (req, res) => {
  const code = refCode(req.user.id);
  res.json({
    code, link: `${config.BASE_URL}/?ref=${code}`, reward: int(getSetting('referral_reward')),
    referred: db.prepare(`SELECT u.name, u.created_at, ${QUALIFIED} AS qualified FROM users u WHERE u.referred_by = ? ORDER BY u.id DESC`).all(req.user.id)
      .map((x) => ({ name: (x.name || 'Member').split(' ')[0], joined: x.created_at, qualified: Boolean(x.qualified) })),
  });
});

// =========================================================== SPV unit resale market (off unless enabled in settings)

const marketOn = () => getSetting('secondary_market') === '1';
const held = (userId, spvId) => db.prepare("SELECT COALESCE(SUM(units),0) AS n FROM investments WHERE user_id = ? AND spv_id = ? AND status = 'active'").get(userId, spvId).n;
const onOffer = (userId, spvId) => db.prepare("SELECT COALESCE(SUM(units),0) AS n FROM unit_listings WHERE seller_id = ? AND spv_id = ? AND status = 'open'").get(userId, spvId).n;

r.get('/spvs/:id/market', (req, res) => {
  const id = num(req.params.id);
  const rows = marketOn() ? db.prepare("SELECT id, seller_id, units, price_per_unit, created_at FROM unit_listings WHERE spv_id = ? AND status = 'open' ORDER BY price_per_unit").all(id) : [];
  res.json({
    enabled: marketOn(),
    listings: rows.map(({ seller_id, ...x }) => ({ ...x, mine: Boolean(req.user && req.user.id === seller_id) })),
    available: req.user ? held(req.user.id, id) - onOffer(req.user.id, id) : 0,
  });
});
r.post('/spvs/:id/market', requireAuth, (req, res) => {
  if (!marketOn()) throw new HttpError(404, 'Unit resale is not available.');
  const s = db.prepare("SELECT * FROM spvs WHERE id = ? AND status IN ('open','funded','closed')").get(num(req.params.id));
  if (!s) throw new HttpError(404, 'Offer not found.');
  const units = int(req.body.units, 1e7), price = int(req.body.price_per_unit, 1e10);
  if (!units || !price) throw new HttpError(400, 'Enter the number of units and a price per unit.');
  if (units > held(req.user.id, s.id) - onOffer(req.user.id, s.id)) throw new HttpError(409, 'You do not hold that many unlisted units.');
  db.prepare('INSERT INTO unit_listings(spv_id, seller_id, units, price_per_unit) VALUES(?,?,?,?)').run(s.id, req.user.id, units, price);
  res.status(201).json({ ok: true });
});
r.post('/unit-listings/:id/cancel', requireAuth, (req, res) => {
  const n = db.prepare("UPDATE unit_listings SET status = 'cancelled' WHERE id = ? AND status = 'open' AND (seller_id = ? OR ? = 'admin')").run(num(req.params.id), req.user.id, req.user.role).changes;
  if (!n) throw new HttpError(404, 'Listing not found.');
  res.json({ ok: true });
});
r.post('/unit-listings/:id/buy', requireAuth, async (req, res) => {
  if (!marketOn()) throw new HttpError(404, 'Unit resale is not available.');
  const l = db.prepare("SELECT * FROM unit_listings WHERE id = ? AND status = 'open'").get(num(req.params.id));
  if (!l) throw new HttpError(409, 'These units are no longer for sale.');
  if (l.seller_id === req.user.id) throw new HttpError(400, 'These are your own units.');
  if (!req.user.verified) throw new HttpError(403, 'Please verify your identity (Dashboard → Verification) before investing.');
  if (req.body.accept_risk !== true) throw new HttpError(400, 'Please confirm you have read the risk notice.');
  res.json(await payments.start(req.user, 'unit_trade', l.id, l.units * l.price_per_unit));
});
payments.handlers.unit_trade = (pay, already, after) => {
  const l = db.prepare('SELECT * FROM unit_listings WHERE id = ?').get(pay.target_id);
  if (!already && l) {
    const s = db.prepare('SELECT * FROM spvs WHERE id = ?').get(l.spv_id);
    if (l.status === 'open' && held(l.seller_id, l.spv_id) >= l.units) {
      db.prepare("UPDATE unit_listings SET status = 'sold', buyer_id = ? WHERE id = ?").run(pay.user_id, l.id);
      const ins = db.prepare("INSERT INTO investments(spv_id, user_id, units, amount, status) VALUES(?,?,?,?,'active')");
      ins.run(l.spv_id, pay.user_id, l.units, pay.amount);
      ins.run(l.spv_id, l.seller_id, -l.units, -l.units * s.unit_price); // seller's holding goes down
      after.push(() => {
        push.notify({ userId: l.seller_id, title: 'Your units were sold', body: `${l.units} unit(s) of ${s.title} for ${naira(pay.amount)}. Payout is on its way.`, url: '/dashboard?tab=invest' });
        push.notifyAdmins({ title: 'Unit resale - pay out seller', body: `${naira(pay.amount)} for ${l.units} unit(s) of ${s.title}`, url: '/admin?tab=desk' });
      });
    } else {
      after.push(() => push.notifyAdmins({ title: 'REFUND needed: unit resale failed', body: `Payment ${pay.reference} (${naira(pay.amount)}) arrived after the units were gone.`, url: '/admin?tab=desk' }));
      return { redirect: '/dashboard?tab=invest', message: 'Those units were sold moments ago. Your payment will be refunded.' };
    }
  }
  return { redirect: '/dashboard?tab=invest', message: 'Units bought. They are now in your portfolio.' };
};

// =========================================================== admin service desk

r.get('/admin/desk', requireRole('admin'), (_req, res) => {
  res.json({
    inspections: inspectionRows("i.status != 'awaiting_payment'"),
    title_checks: db.prepare("SELECT t.*, p.title AS property_title, p.title_doc, u.name AS user_name, u.phone AS user_phone FROM title_checks t JOIN properties p ON p.id = t.property_id JOIN users u ON u.id = t.user_id WHERE t.status != 'awaiting_payment' ORDER BY t.status = 'completed', t.id DESC LIMIT 100").all(),
    referrals: db.prepare(`SELECT r.name AS referrer, r.phone AS referrer_phone, u.name, u.created_at, ${QUALIFIED} AS qualified FROM users u JOIN users r ON r.id = u.referred_by ORDER BY u.id DESC LIMIT 200`).all(),
    unit_trades: db.prepare("SELECT l.*, s.title, a.name AS seller_name, a.phone AS seller_phone, b.name AS buyer_name FROM unit_listings l JOIN spvs s ON s.id = l.spv_id JOIN users a ON a.id = l.seller_id LEFT JOIN users b ON b.id = l.buyer_id WHERE l.status != 'cancelled' ORDER BY l.id DESC LIMIT 100").all(),
    fees: { inspection: int(getSetting('inspection_fee')), collected: db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE purpose = 'inspection' AND status = 'paid'").get().n },
  });
});

// =========================================================== reminders (run hourly)

function remind() {
  const due = db.prepare(
    `SELECT i.id, i.amount, i.due_date, i.seq, u.id AS user_id, u.phone, p.title FROM installments i
       JOIN subscriptions s ON s.id = i.subscription_id JOIN users u ON u.id = s.user_id JOIN properties p ON p.id = s.property_id
      WHERE i.status = 'due' AND s.status = 'active' AND i.due_date <= date('now', '+3 days')
        AND (i.reminded_at IS NULL OR i.reminded_at <= date('now', '-5 days'))`
  ).all();
  for (const i of due) {
    const late = i.due_date < new Date().toISOString().slice(0, 10);
    const body = `${naira(i.amount)} for ${i.title} ${late ? 'was due on' : 'is due on'} ${i.due_date}.`;
    push.notify({ userId: i.user_id, title: late ? 'Instalment overdue' : 'Instalment due soon', body, url: '/dashboard?tab=plans' });
    wa(i.phone, `${config.SITE_NAME} reminder: your easy-buy instalment of ${body} Pay here: ${config.BASE_URL}/dashboard?tab=plans`);
    db.prepare("UPDATE installments SET reminded_at = date('now') WHERE id = ?").run(i.id);
  }
  const soon = new Date(Date.now() + 24 * 3600 * 1000);
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const visits = db.prepare("SELECT * FROM inspections WHERE status = 'confirmed' AND reminded = 0 AND slot > ? AND slot <= ?").all(local(new Date()), local(soon));
  for (const v of visits) {
    const p = listings.getProperty(v.property_id);
    for (const uid of [v.user_id, v.agent_id]) {
      const u = userById(uid);
      push.notify({ userId: uid, title: 'Inspection reminder', body: `${p.title} · ${when(v.slot)}`, url: '/dashboard?tab=inspections' });
      wa(u.phone, `Reminder: inspection of ${p.title} is ${when(v.slot)}.`);
    }
    db.prepare('UPDATE inspections SET reminded = 1 WHERE id = ?').run(v.id);
  }
  return { instalments: due.length, inspections: visits.length };
}

module.exports = { router: r, remind, applyReferral, refCode };
