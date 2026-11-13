const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { db, audit, allSettings, setSetting, DEFAULT_SETTINGS } = require('./db');
const auth = require('./auth');
const { HttpError, requireAuth, requireRole } = auth;
const listings = require('./listings');
const media = require('./media');
const payments = require('./payments');
const push = require('./push');
const whatsapp = require('./whatsapp');
const mail = require('./mail');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
if (config.TEST_MODE) app.use((_req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });
app.use(express.json({ limit: '200kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(auth.loadUser);

const upload = multer({
  dest: config.TMP_DIR,
  limits: { fileSize: 150 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => cb(null, /^(image|video)\//.test(file.mimetype)),
});

const publicUser = (u) => (u ? {
  id: u.id, phone: u.phone, name: u.name, role: u.role, account_type: u.account_type, company: u.company, bio: u.bio, city: u.city,
  email: u.email, email_verified: Boolean(u.email_verified),
  service_category: u.service_category, verified: Boolean(u.verified), kyc_status: u.kyc_status, kyc_note: u.kyc_note,
} : null);
const api = express.Router();

// Audit trail: every admin action and every sensitive member action is recorded.
const AUDITED = /^\/(admin\/|escrows\/|me\/kyc$|inspections\/|unit-listings\/|documents|spvs\/\d+\/invest$|properties\/\d+(\/(sold|submit|escrow))?$)/;
api.use((req, res, next) => {
  if (req.method !== 'GET' && AUDITED.test(req.path)) {
    res.on('finish', () => {
      if (res.statusCode < 400 && req.user) audit(req.user.id, `${req.method} ${req.path}`, req.is('json') ? JSON.stringify(req.body || {}) : '');
    });
  }
  next();
});

// ---------- Auth: phone number + WhatsApp verification ----------

api.post('/auth/request-otp', auth.rateLimit('otp', 8, 15 * 60 * 1000), async (req, res) => {
  const phone = auth.normalizePhone(req.body.phone);
  if (!phone) throw new HttpError(400, 'Enter a valid phone number.');
  const code = auth.createOtp(phone);
  // The code goes to WhatsApp and, for members with a verified email address, to their email too.
  const known = db.prepare('SELECT email, email_verified FROM users WHERE phone = ?').get(phone);
  const channels = [];
  try {
    await whatsapp.sendOtp(phone, code);
    channels.push('whatsapp');
  } catch (e) {
    console.error(e.message);
  }
  if (known && known.email_verified && await mail.send(known.email, `${code} is your ${config.SITE_NAME} code`, `Your verification code is ${code}. It expires in 10 minutes. Do not share it.`)) channels.push('email');
  if (!channels.length) {
    db.prepare('DELETE FROM otps WHERE phone = ?').run(phone);
    throw new HttpError(502, 'We could not send the code on WhatsApp. Check the number and try again.');
  }
  const out = { ok: true, phone, channels, is_new: !known };
  // Demo mode only (WhatsApp not configured, not production): show the code so the site can be tried.
  if (!config.WHATSAPP_LIVE && !config.PRODUCTION) out.demo_code = code;
  res.json(out);
});

api.post('/auth/verify', auth.rateLimit('verify', 20, 15 * 60 * 1000), (req, res) => {
  const phone = auth.normalizePhone(req.body.phone);
  if (!phone) throw new HttpError(400, 'Enter a valid phone number.');
  auth.checkOtp(phone, req.body.code);
  const user = auth.upsertUser(phone, { name: req.body.name, role: req.body.role });
  if (user.isNew && user.role === 'agent') { db.prepare("UPDATE users SET account_type = 'agent' WHERE id = ?").run(user.id); user.account_type = 'agent'; }
  if (user.isNew) experience.applyReferral(user, req.body.ref);
  audit(user.id, user.isNew ? 'signup' : 'login');
  auth.createSession(res, user.id);
  res.json({ user: publicUser(user) });
});

api.post('/auth/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

api.get('/me', (req, res) => {
  const s = allSettings();
  res.json({
    user: publicUser(req.user),
    config: {
      site_name: config.SITE_NAME,
      company: config.COMPANY,
      vapid_public_key: push.publicKey,
      payments_demo: payments.DEMO,
      default_unlock_fee: Number(s.default_unlock_fee),
      escrow_fee_pct: Number(s.escrow_fee_pct),
      support_whatsapp: s.support_whatsapp,
      request_fee: Number(s.request_fee), inspection_fee: Number(s.inspection_fee), title_check_fee: Number(s.title_check_fee), referral_reward: Number(s.referral_reward), secondary_market: s.secondary_market === '1',
      phones: s.phones, rc_number: config.RC_NUMBER,
      contact_email: s.contact_email,
      office_address: s.office_address,
      currency_rates: (() => { try { return JSON.parse(s.currency_rates); } catch { return {}; } })(),
      purposes: listings.PURPOSES,
      types: listings.TYPES,
    },
  });
});


// ---------- Listings ----------

api.get('/properties', (req, res) => res.json(listings.search(req.query, req.user)));

api.get('/properties/:id', (req, res) => {
  const p = listings.mustGet(req.params.id);
  const visible = ['active', 'sold'].includes(p.status) || listings.canManage(req.user, p);
  if (!visible) throw new HttpError(404, 'Listing not found.');
  const out = listings.present(p, req.user);
  if (p.easy_buy && p.status === 'active') {
    out.plans = db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY months').all().map((pl) => payments.quote(p.price, pl));
  }
  res.json(out);
});

const manageable = (req) => {
  const p = listings.mustGet(req.params.id);
  if (!listings.canManage(req.user, p)) throw new HttpError(403, 'You cannot manage this listing.');
  return p;
};

api.get('/my/properties', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM properties WHERE owner_id = ? ORDER BY id DESC LIMIT 200').all(req.user.id);
  res.json(rows.map((p) => listings.present(p, req.user)));
});

api.post('/properties', requireRole('agent', 'admin'), (req, res) => {
  const p = listings.createProperty(req.user, req.body);
  res.status(201).json(listings.present(p, req.user));
});

api.patch('/properties/:id', requireAuth, (req, res) => {
  const p = manageable(req);
  const body = { ...req.body };
  if (req.user.role !== 'admin') delete body.unlock_fee; // only admins set the viewing fee
  res.json(listings.present(listings.updateProperty(p.id, body), req.user));
});

api.post('/properties/:id/media', requireAuth, upload.array('files', 20), async (req, res) => {
  const files = req.files || [];
  const drop = () => files.forEach((f) => fs.promises.unlink(f.path).catch(() => {}));
  let p;
  try {
    p = manageable(req);
    if (p.status === 'sold') throw new HttpError(409, 'Media cannot be added to a sold listing.');
    if (!files.length) throw new HttpError(400, 'Choose photos or videos to upload.');
    const count = db.prepare('SELECT COUNT(*) AS n FROM media WHERE property_id = ?').get(p.id).n;
    if (count + files.length > 40) throw new HttpError(400, 'A listing can have at most 40 photos/videos.');
  } catch (e) {
    drop();
    throw e;
  }
  const failed = [];
  for (const f of files) {
    try {
      await media.addMedia(p.id, f.path, f.mimetype);
    } catch {
      failed.push(f.originalname);
    }
  }
  res.json({ ...listings.present(listings.getProperty(p.id), req.user), failed });
});

api.delete('/properties/:id/media/:mediaId', requireAuth, (req, res) => {
  const p = manageable(req);
  const row = db.prepare('SELECT id FROM media WHERE id = ? AND property_id = ?').get(Number(req.params.mediaId) || 0, p.id);
  if (!row) throw new HttpError(404, 'Media not found.');
  media.deleteMedia(row.id);
  res.json(listings.present(listings.getProperty(p.id), req.user));
});

api.post('/properties/:id/cover', requireAuth, (req, res) => {
  const p = manageable(req);
  const row = db.prepare("SELECT id FROM media WHERE id = ? AND property_id = ? AND kind = 'image'").get(Number(req.body.media_id) || 0, p.id);
  if (!row) throw new HttpError(404, 'Choose one of the listing photos as cover.');
  db.prepare('UPDATE properties SET cover_media_id = ? WHERE id = ?').run(row.id, p.id);
  res.json(listings.present(listings.getProperty(p.id), req.user));
});

api.post('/properties/:id/submit', requireAuth, (req, res) => {
  res.json(listings.present(listings.submit(manageable(req), req.user), req.user));
});

api.post('/properties/:id/sold', requireAuth, (req, res) => {
  const p = manageable(req);
  if (!['active', 'sold'].includes(p.status)) throw new HttpError(409, 'Only live listings can be marked sold.');
  const out = listings.markSold(p);
  res.json({ ...listings.present(out, req.user), freed_bytes: out.freed_bytes || 0 });
});

api.delete('/properties/:id', requireAuth, (req, res) => {
  listings.removeProperty(manageable(req));
  res.json({ ok: true });
});

// ---------- Pay to view full information ----------

api.post('/properties/:id/unlock', requireAuth, async (req, res) => {
  const p = listings.mustGet(req.params.id);
  if (!['active', 'sold'].includes(p.status)) throw new HttpError(404, 'Listing not found.');
  const fee = listings.unlockFee(p);
  if (fee === 0 || listings.canManage(req.user, p) || listings.hasUnlocked(req.user, p)) return res.json({ unlocked: true });
  res.json(await payments.start(req.user, 'unlock', p.id, fee));
});

// ---------- Easy-buy plans ----------

api.get('/plans', (_req, res) => res.json(db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY months').all()));

api.post('/properties/:id/subscribe', requireAuth, (req, res) => {
  const id = payments.subscribe(req.user, listings.mustGet(req.params.id), req.body.plan_id);
  res.status(201).json(payments.subscriptionsFor('s.id = ?', id)[0]);
});

api.get('/my/subscriptions', requireAuth, (req, res) => res.json(payments.subscriptionsFor('s.user_id = ?', req.user.id)));

api.post('/installments/:id/pay', requireAuth, async (req, res) => res.json(await payments.payInstallment(req.user, req.params.id)));

// ---------- Escrow ----------

api.post('/properties/:id/escrow', requireAuth, (req, res) => {
  const id = payments.createEscrow(req.user, listings.mustGet(req.params.id), req.body);
  res.status(201).json(payments.escrowsFor('e.id = ?', id)[0]);
});

api.get('/my/escrows', requireAuth, (req, res) => {
  const rows = payments.escrowsFor('e.buyer_id = ? OR e.seller_id = ?', req.user.id, req.user.id);
  res.json(rows.map((e) => ({ ...e, role: e.buyer_id === req.user.id ? 'buyer' : 'seller' })));
});

api.post('/escrows/:id/pay', requireAuth, async (req, res) => res.json(await payments.payEscrow(req.user, req.params.id)));
api.post('/escrows/:id/release', requireAuth, (req, res) => { payments.releaseEscrow(req.user, req.params.id); res.json({ ok: true }); });
api.post('/escrows/:id/dispute', requireAuth, (req, res) => { payments.disputeEscrow(req.user, req.params.id, req.body.note); res.json({ ok: true }); });
api.post('/escrows/:id/cancel', requireAuth, (req, res) => { payments.cancelEscrow(req.user, req.params.id); res.json({ ok: true }); });
api.post('/escrows/:id/refund', requireRole('admin'), (req, res) => { payments.refundEscrow(req.user, req.params.id, req.body.note); res.json({ ok: true }); });

// ---------- Payments ----------

api.get('/payments/verify/:reference', requireAuth, async (req, res) => res.json(await payments.verify(req.params.reference)));
api.get('/payments/demo/:reference', requireAuth, (req, res) => res.json(payments.demoInfo(req.user, req.params.reference)));
api.post('/payments/demo/:reference', requireAuth, (req, res) => res.json(payments.demoConfirm(req.user, req.params.reference)));

api.post('/paystack/webhook', async (req, res) => {
  const ok = await payments.webhook(req.rawBody || Buffer.alloc(0), req.get('x-paystack-signature'));
  res.sendStatus(ok ? 200 : 401);
});

// ---------- Property requests ----------

function announceRequest(id) {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  if (!r) return;
  const where = [r.city, r.state].filter(Boolean).join(', ');
  const summary = `${r.type || 'Property'} for ${r.purpose}${where ? ' in ' + where : ''}`;
  push.notifyAdmins({ title: 'New property request', body: summary, url: '/requests' });
  for (const a of db.prepare("SELECT id FROM users WHERE role = 'agent' AND id != ?").all(r.user_id)) {
    push.notify({ userId: a.id, title: 'New property request', body: summary, url: '/requests' });
  }
}

// A request is published once its fee is paid.
payments.handlers.request = (pay, already, after) => {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(pay.target_id);
  if (!already && r && r.status === 'awaiting_payment') {
    db.prepare("UPDATE requests SET status = 'open' WHERE id = ?").run(r.id);
    after.push(() => announceRequest(r.id));
  }
  return { redirect: '/requests', message: 'Request published. Agents have been alerted.' };
};

api.post('/requests', requireAuth, async (req, res) => {
  const b = req.body;
  const details = listings.str(b.details, 1500);
  const purpose = listings.PURPOSES.includes(b.purpose) ? b.purpose : 'sale';
  const type = listings.TYPES.includes(b.type) ? b.type : '';
  if (!type && !details) throw new HttpError(400, 'Tell us what kind of property you need.');
  const fee = req.user.role === 'admin' ? 0 : listings.int(allSettings().request_fee, 1e7);
  const id = db
    .prepare('INSERT INTO requests(user_id, purpose, type, state, city, min_price, max_price, bedrooms, details, contact_phone, status) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(req.user.id, purpose, type, listings.str(b.state, 60), listings.str(b.city, 60), listings.int(b.min_price), listings.int(b.max_price),
      listings.int(b.bedrooms, 50), details, listings.str(b.contact_phone, 30) || req.user.phone, fee > 0 ? 'awaiting_payment' : 'open').lastInsertRowid;
  if (fee > 0) return res.status(201).json({ id, ...(await payments.start(req.user, 'request', id, fee)) });
  announceRequest(id);
  res.status(201).json({ id });
});

api.get('/requests', (req, res) => {
  const pro = req.user && ['agent', 'admin'].includes(req.user.role);
  const rows = db
    .prepare("SELECT r.*, u.name AS user_name, u.role AS user_role FROM requests r JOIN users u ON u.id = r.user_id WHERE r.status = 'open' ORDER BY r.id DESC LIMIT 100")
    .all();
  res.json(rows.map((r) => {
    const mine = req.user && r.user_id === req.user.id;
    const { contact_phone, user_name, user_id, ...rest } = r;
    // Contact details are only shown to agents and admins.
    return { ...rest, mine: Boolean(mine), ...(pro || mine ? { contact_phone, user_name } : {}) };
  }));
});

api.post('/requests/:id/close', requireAuth, (req, res) => {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(req.params.id) || 0);
  if (!r || (r.user_id !== req.user.id && req.user.role !== 'admin')) throw new HttpError(404, 'Request not found.');
  db.prepare("UPDATE requests SET status = 'closed' WHERE id = ?").run(r.id);
  res.json({ ok: true });
});

// ---------- Push notifications ----------

api.post('/push/subscribe', requireAuth, (req, res) => {
  if (!push.saveSubscription(req.user.id, req.body)) throw new HttpError(400, 'Invalid subscription.');
  res.json({ ok: true });
});

api.post('/push/unsubscribe', requireAuth, (req, res) => {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(String(req.body.endpoint || ''), req.user.id);
  res.json({ ok: true });
});

api.get('/notifications', requireAuth, (req, res) => res.json(push.listFor(req.user)));

api.post('/notifications/seen', requireAuth, (req, res) => {
  db.prepare("UPDATE users SET notif_seen_at = datetime('now') WHERE id = ?").run(req.user.id);
  res.json({ ok: true });
});

// ---------- WhatsApp webhook (manage listings from WhatsApp) ----------

api.get('/whatsapp/webhook', (req, res) => {
  const ok = config.WHATSAPP_VERIFY_TOKEN && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.WHATSAPP_VERIFY_TOKEN;
  if (!ok) return res.sendStatus(403);
  res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
});

api.post('/whatsapp/webhook', (req, res) => {
  if (!whatsapp.verifySignature(req.rawBody || Buffer.alloc(0), req.get('x-hub-signature-256'))) return res.sendStatus(401);
  res.sendStatus(200); // acknowledge immediately; work continues in the background
  whatsapp.handleWebhook(req.body || {});
});

// ---------- Admin ----------

const admin = express.Router();
admin.use(requireRole('admin'));

admin.get('/overview', (req, res) => {
  const one = (sql) => db.prepare(sql).get().n;
  const storage = db.prepare('SELECT COALESCE(SUM(bytes),0) AS used, COALESCE(SUM(orig_bytes),0) AS original FROM media').get();
  res.json({
    stats: {
      members: one('SELECT COUNT(*) AS n FROM users'),
      active: one("SELECT COUNT(*) AS n FROM properties WHERE status = 'active'"),
      sold: one("SELECT COUNT(*) AS n FROM properties WHERE status = 'sold'"),
      pending: one("SELECT COUNT(*) AS n FROM properties WHERE status = 'pending'"),
      unlock_revenue: one("SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE purpose = 'unlock' AND status = 'paid'"),
      escrow_held: one("SELECT COALESCE(SUM(amount),0) AS n FROM escrows WHERE status IN ('funded','disputed')"),
      push_devices: one('SELECT COUNT(*) AS n FROM push_subs'),
      storage_used: storage.used,
      storage_saved: Math.max(0, storage.original - storage.used),
    },
    pending: db.prepare("SELECT * FROM properties WHERE status = 'pending' ORDER BY id").all().map((p) => listings.present(p, req.user)),
    listings: db.prepare("SELECT * FROM properties WHERE status IN ('active','sold','draft','rejected') ORDER BY id DESC LIMIT 100").all().map((p) => listings.present(p, req.user)),
    escrows: payments.escrowsFor('1=1'),
    subscriptions: payments.subscriptionsFor('1=1'),
    plans: db.prepare('SELECT * FROM plans ORDER BY months').all(),
    users: db.prepare('SELECT id, phone, name, role, created_at, account_type, company, verified, kyc_status, kyc_doc_type, kyc_note, suspended FROM users ORDER BY id DESC LIMIT 200').all(),
    settings: allSettings(),
    integrations: {
      whatsapp: config.WHATSAPP_LIVE, email: mail.LIVE, payments: config.PAYMENTS_LIVE, video_compression: media.HAS_FFMPEG,
      facebook: Boolean(config.FB_PAGE_ID && config.FB_PAGE_TOKEN), telegram: Boolean(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID),
    },
  });
});

admin.post('/properties/:id/approve', (req, res) => {
  const p = listings.mustGet(req.params.id);
  if (p.status !== 'pending') throw new HttpError(409, 'This listing is not awaiting approval.');
  listings.publish(p);
  push.notify({ userId: p.owner_id, title: 'Listing approved', body: `${p.title} is now live.`, url: `/p/${p.id}` });
  res.json({ ok: true });
});

admin.post('/properties/:id/reject', (req, res) => {
  const p = listings.mustGet(req.params.id);
  if (p.status !== 'pending') throw new HttpError(409, 'This listing is not awaiting approval.');
  db.prepare("UPDATE properties SET status = 'rejected' WHERE id = ?").run(p.id);
  push.notify({ userId: p.owner_id, title: 'Listing needs changes', body: `${p.title} was not approved. ${listings.str(req.body.reason, 200)}`, url: '/dashboard' });
  res.json({ ok: true });
});

admin.put('/settings', (req, res) => {
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (req.body[key] === undefined) continue;
    let v = String(req.body[key]).trim().slice(0, 200);
    if (key === 'currency_rates') {
      try {
        const r = JSON.parse(v);
        v = JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k, n]) => /^[A-Z]{3}$/.test(k) && Number(n) > 0).slice(0, 8)));
      } catch { continue; }
    }
    if (['inspection_fee', 'title_check_fee', 'referral_reward', 'request_fee'].includes(key)) v = String(listings.int(v, 1e8));
    if (key === 'secondary_market') v = /^(1|true|on|yes)$/i.test(v) ? '1' : '0';
    if (key === 'default_unlock_fee') v = String(listings.int(v, 1e7));
    if (key === 'escrow_fee_pct') v = String(Math.min(Math.max(Number(v) || 0, 0), 20));
    setSetting(key, v);
  }
  res.json(allSettings());
});

const planFields = (b) => {
  const months = listings.int(b.months, 120);
  const name = listings.str(b.name, 40);
  const deposit = Math.min(Math.max(Number(b.deposit_pct) || 0, 0), 90);
  const markup = Math.min(Math.max(Number(b.markup_pct) || 0, 0), 100);
  if (!name || !months) throw new HttpError(400, 'A plan needs a name and a number of months.');
  return [name, months, deposit, markup];
};
admin.post('/plans', (req, res) => {
  db.prepare('INSERT INTO plans(name, months, deposit_pct, markup_pct) VALUES(?,?,?,?)').run(...planFields(req.body));
  res.status(201).json({ ok: true });
});
admin.put('/plans/:id', (req, res) => {
  db.prepare('UPDATE plans SET name=?, months=?, deposit_pct=?, markup_pct=?, active=? WHERE id=?')
    .run(...planFields(req.body), req.body.active === false ? 0 : 1, Number(req.params.id) || 0);
  res.json({ ok: true });
});

admin.post('/users/:id/role', (req, res) => {
  const role = String(req.body.role);
  if (!['buyer', 'agent', 'admin'].includes(role)) throw new HttpError(400, 'Unknown role.');
  if (Number(req.params.id) === req.user.id) throw new HttpError(400, 'You cannot change your own role.');
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, Number(req.params.id) || 0);
  res.json({ ok: true });
});

admin.post('/broadcast', (req, res) => {
  const title = listings.str(req.body.title, 80);
  if (!title) throw new HttpError(400, 'A title is required.');
  push.notify({ title, body: listings.str(req.body.body, 200), url: '/' });
  res.json({ ok: true });
});

api.use(require('./extras')({ publicUser }));
api.use(require('./invest'));
const experience = require('./experience');
api.use(experience.router);
// Shared hosts put idle apps to sleep, so the hourly jobs can also be triggered by a cron job:
//   curl -s "https://your-domain/api/cron?key=CRON_KEY"
api.get('/cron', (req, res) => {
  if (!config.CRON_KEY || req.query.key !== config.CRON_KEY) return res.sendStatus(404);
  sweep();
  res.json({ ok: true, ...experience.remind() });
});

api.use('/admin', admin);
api.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));
app.use('/api', api);

// ---------- Static files + pages ----------

// Lets the Android app (a Trusted Web Activity) open the site full-screen without a browser bar.
app.get('/.well-known/assetlinks.json', (_req, res) => {
  res.json(config.ANDROID_PACKAGE && config.ANDROID_SHA256.length
    ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: config.ANDROID_PACKAGE, sha256_cert_fingerprints: config.ANDROID_SHA256 } }]
    : []);
});

app.use('/media', express.static(config.MEDIA_DIR, { maxAge: '30d', immutable: true, index: false }));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false, setHeaders: (res, file) => {
  if (file.endsWith('sw.js') || file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
} }));

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(meta = {}) {
  const title = meta.title ? `${meta.title} | ${config.SITE_NAME}` : `${config.SITE_NAME} — Find, buy and own property with confidence`;
  const desc = meta.description || `${config.SITE_NAME} by ${config.COMPANY}: verified houses and land, easy-buy instalment plans and secure escrow.`;
  const image = meta.image || `${config.BASE_URL}/og-image.png`;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta property="og:site_name" content="${esc(config.SITE_NAME)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:url" content="${esc(config.BASE_URL + (meta.path || '/'))}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join('\n  ');
  return INDEX.replace('<!--META-->', tags).replaceAll('%SITE_NAME%', esc(config.SITE_NAME)).replaceAll('%COMPANY%', esc(config.COMPANY));
}

// Listing pages get their own title / preview image so shared links look good on social media.
app.get('/p/:id', (req, res) => {
  const p = listings.getProperty(req.params.id);
  if (!p || !['active', 'sold'].includes(p.status)) return res.type('html').send(page());
  const cover = p.cover_media_id ? db.prepare('SELECT file FROM media WHERE id = ?').get(p.cover_media_id) : null;
  res.type('html').send(page({
    title: `${p.title} — ${listings.naira(p.price)}`,
    description: [listings.place(p), p.bedrooms ? `${p.bedrooms} bedrooms` : '', p.easy_buy ? 'Easy-buy plans available' : ''].filter(Boolean).join(' · '),
    image: cover ? `${config.BASE_URL}/media/${cover.file}` : undefined,
    path: `/p/${p.id}`,
  }));
});

app.get(/^\/(?!api\/|media\/).*/, (req, res, next) => {
  if (path.extname(req.path)) return next();
  res.type('html').send(page());
});

app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'A file is too large (max 150 MB).' : 'Upload failed.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? 'Something went wrong. Please try again.' : err.message });
});

// Housekeeping: expired sessions / codes and stray temp uploads.
function sweep() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('DELETE FROM otps WHERE expires_at < ?').run(Date.now());
  db.prepare("DELETE FROM requests WHERE status = 'awaiting_payment' AND created_at < datetime('now','-2 days')").run();
  for (const f of fs.readdirSync(config.TMP_DIR)) {
    const full = path.join(config.TMP_DIR, f);
    try { if (Date.now() - fs.statSync(full).mtimeMs > 6 * 3600 * 1000) fs.unlinkSync(full); } catch { /* ignore */ }
  }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  sweep();
  setInterval(sweep, 3600 * 1000).unref();
  experience.remind();
  setInterval(experience.remind, 3600 * 1000).unref();
  app.listen(config.PORT, () => {
    console.log(`${config.SITE_NAME} running at ${config.BASE_URL}`);
    if (!mail.LIVE) console.log('  Email: DEMO mode (messages are logged here). Set SMTP_HOST, SMTP_USER, SMTP_PASS.');
    if (!config.WHATSAPP_LIVE) console.log('  WhatsApp: DEMO mode (codes are logged here, not sent). Set WHATSAPP_TOKEN + WHATSAPP_PHONE_ID.');
    if (!config.PAYMENTS_LIVE) console.log('  Payments: DEMO mode (simulated checkout). Set PAYSTACK_SECRET_KEY.');
    if (!media.HAS_FFMPEG) console.log('  ffmpeg not found: videos are stored without compression.');
  });
}

if (require.main === module) start();

app.start = start;
module.exports = app;
