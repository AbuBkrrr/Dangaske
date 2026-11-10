// SPV property investment: members buy units in a property held by a special purpose vehicle.
// Only identity-verified (KYC approved) members can invest. Returns shown are projections, never guarantees.
const express = require('express');
const { db } = require('./db');
const { HttpError, requireAuth, requireRole } = require('./auth');
const listings = require('./listings');
const payments = require('./payments');
const push = require('./push');

db.exec(`
CREATE TABLE IF NOT EXISTS spvs (
  id INTEGER PRIMARY KEY,
  property_id INTEGER,
  title TEXT NOT NULL,
  spv_name TEXT NOT NULL DEFAULT '',           -- registered name of the vehicle
  location TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  strategy TEXT NOT NULL DEFAULT 'rental',     -- rental | appreciation | development
  unit_price INTEGER NOT NULL,
  total_units INTEGER NOT NULL,
  min_units INTEGER NOT NULL DEFAULT 1,
  projected_return_pct REAL NOT NULL DEFAULT 0, -- per year, estimate only
  tenor_months INTEGER NOT NULL DEFAULT 12,
  status TEXT NOT NULL DEFAULT 'draft',        -- draft | open | funded | closed | exited
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS investments (
  id INTEGER PRIMARY KEY,
  spv_id INTEGER NOT NULL REFERENCES spvs(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  units INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | active | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS distributions (
  id INTEGER PRIMARY KEY,
  spv_id INTEGER NOT NULL REFERENCES spvs(id),
  amount_per_unit INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const STRATEGIES = ['rental', 'appreciation', 'development'];
const STATUSES = ['draft', 'open', 'funded', 'closed', 'exited'];
const { int, str } = listings;
const sold = (id) => db.prepare("SELECT COALESCE(SUM(units),0) AS n FROM investments WHERE spv_id = ? AND status = 'active'").get(id).n;

function present(s) {
  const units = sold(s.id);
  const cover = s.property_id
    ? db.prepare('SELECT m.file, m.thumb FROM properties p JOIN media m ON m.id = p.cover_media_id WHERE p.id = ?').get(s.property_id)
    : null;
  return {
    ...s, sold_units: units, raised: units * s.unit_price, target: s.total_units * s.unit_price,
    investors: db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM investments WHERE spv_id = ? AND status = 'active'").get(s.id).n,
    cover: cover ? `/media/${cover.file}` : '', cover_thumb: cover ? `/media/${cover.thumb}` : '',
    distributions: db.prepare('SELECT amount_per_unit, note, created_at FROM distributions WHERE spv_id = ? ORDER BY id DESC').all(s.id),
  };
}

function fields(b) {
  const f = {
    title: str(b.title, 120), spv_name: str(b.spv_name, 120), location: str(b.location, 120), summary: str(b.summary, 300),
    description: str(b.description, 6000), strategy: STRATEGIES.includes(b.strategy) ? b.strategy : 'rental',
    unit_price: int(b.unit_price), total_units: int(b.total_units, 1e7), min_units: int(b.min_units, 1e6) || 1,
    projected_return_pct: Math.min(Math.max(Number(b.projected_return_pct) || 0, 0), 100), tenor_months: int(b.tenor_months, 600) || 12,
    status: STATUSES.includes(b.status) ? b.status : 'draft',
    property_id: b.property_id && listings.getProperty(b.property_id) ? Number(b.property_id) : null,
  };
  if (!f.title || !f.unit_price || !f.total_units) throw new HttpError(400, 'An offer needs a title, a unit price and a number of units.');
  return f;
}

const r = express.Router();

r.get('/spvs', (_req, res) => {
  res.json(db.prepare("SELECT * FROM spvs WHERE status != 'draft' ORDER BY status = 'open' DESC, id DESC").all().map(present));
});

r.get('/spvs/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM spvs WHERE id = ?').get(Number(req.params.id) || 0);
  if (!s || (s.status === 'draft' && !(req.user && req.user.role === 'admin'))) throw new HttpError(404, 'Investment offer not found.');
  const out = present(s);
  if (req.user) out.my_units = db.prepare("SELECT COALESCE(SUM(units),0) AS n FROM investments WHERE spv_id = ? AND user_id = ? AND status = 'active'").get(s.id, req.user.id).n;
  res.json(out);
});

r.post('/spvs/:id/invest', requireAuth, async (req, res) => {
  const s = db.prepare('SELECT * FROM spvs WHERE id = ?').get(Number(req.params.id) || 0);
  if (!s || s.status === 'draft') throw new HttpError(404, 'Investment offer not found.');
  if (s.status !== 'open') throw new HttpError(409, 'This offer is no longer open for investment.');
  if (!req.user.verified) throw new HttpError(403, 'Please verify your identity (Dashboard → Verification) before investing.');
  if (req.body.accept_risk !== true) throw new HttpError(400, 'Please confirm you have read the risk notice.');
  const units = int(req.body.units, 1e7);
  const left = s.total_units - sold(s.id);
  if (units < s.min_units) throw new HttpError(400, `The minimum is ${s.min_units} unit(s).`);
  if (units > left) throw new HttpError(409, `Only ${left} unit(s) remain.`);
  const id = db.prepare('INSERT INTO investments(spv_id, user_id, units, amount) VALUES(?,?,?,?)').run(s.id, req.user.id, units, units * s.unit_price).lastInsertRowid;
  res.json(await payments.start(req.user, 'investment', id, units * s.unit_price));
});

r.get('/my/investments', requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT i.spv_id, SUM(i.units) AS units, SUM(i.amount) AS amount, MIN(i.created_at) AS since FROM investments i WHERE i.user_id = ? AND i.status = 'active' GROUP BY i.spv_id")
    .all(req.user.id);
  res.json(rows.map((h) => {
    const s = present(db.prepare('SELECT * FROM spvs WHERE id = ?').get(h.spv_id));
    // A payout only counts for units that were already held when it was declared.
    const distributed = db
      .prepare("SELECT COALESCE(SUM(i.units * d.amount_per_unit),0) AS n FROM investments i JOIN distributions d ON d.spv_id = i.spv_id AND d.created_at >= i.created_at WHERE i.user_id = ? AND i.spv_id = ? AND i.status = 'active'")
      .get(req.user.id, h.spv_id).n;
    return { ...h, title: s.title, status: s.status, unit_price: s.unit_price, total_units: s.total_units, distributed, distributions: s.distributions };
  }));
});

r.get('/admin/spvs', requireRole('admin'), (_req, res) => {
  res.json(db.prepare('SELECT * FROM spvs ORDER BY id DESC').all().map((s) => ({
    ...present(s),
    holders: db.prepare("SELECT u.name, u.phone, SUM(i.units) AS units, SUM(i.amount) AS amount FROM investments i JOIN users u ON u.id = i.user_id WHERE i.spv_id = ? AND i.status = 'active' GROUP BY i.user_id ORDER BY units DESC").all(s.id),
  })));
});

r.post('/admin/spvs', requireRole('admin'), (req, res) => {
  const f = fields(req.body);
  const k = Object.keys(f);
  const id = db.prepare(`INSERT INTO spvs(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => f[x])).lastInsertRowid;
  if (f.status === 'open') push.notify({ title: 'New investment offer', body: f.title, url: `/invest/${id}` });
  res.status(201).json({ id });
});

r.put('/admin/spvs/:id', requireRole('admin'), (req, res) => {
  const s = db.prepare('SELECT * FROM spvs WHERE id = ?').get(Number(req.params.id) || 0);
  if (!s) throw new HttpError(404, 'Offer not found.');
  const f = fields(req.body);
  const units = sold(s.id);
  if (units > 0 && f.unit_price !== s.unit_price) throw new HttpError(409, 'The unit price cannot change after units have been sold.');
  if (f.total_units < units) throw new HttpError(409, `${units} units are already sold.`);
  const k = Object.keys(f);
  db.prepare(`UPDATE spvs SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`).run(...k.map((x) => f[x]), s.id);
  if (f.status === 'open' && s.status === 'draft') push.notify({ title: 'New investment offer', body: f.title, url: `/invest/${s.id}` });
  res.json({ ok: true });
});

// Record a payout (e.g. rental income) per unit. The transfer itself is made by the company.
r.post('/admin/spvs/:id/distribute', requireRole('admin'), (req, res) => {
  const s = db.prepare('SELECT * FROM spvs WHERE id = ?').get(Number(req.params.id) || 0);
  if (!s) throw new HttpError(404, 'Offer not found.');
  const per = int(req.body.amount_per_unit, 1e10);
  if (!per) throw new HttpError(400, 'Enter the amount paid per unit.');
  db.prepare('INSERT INTO distributions(spv_id, amount_per_unit, note) VALUES(?,?,?)').run(s.id, per, str(req.body.note, 200));
  for (const h of db.prepare("SELECT user_id, SUM(units) AS units FROM investments WHERE spv_id = ? AND status = 'active' GROUP BY user_id").all(s.id)) {
    push.notify({ userId: h.user_id, title: 'Investment payout', body: `${listings.naira(per * h.units)} declared on ${s.title}.`, url: '/dashboard?tab=invest' });
  }
  res.json({ ok: true });
});

module.exports = r;
