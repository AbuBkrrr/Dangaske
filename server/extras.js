// Trust & discovery features: professional profiles and directory, identity verification (KYC),
// verified / featured flags, suspension, issue reports, markets, insights and the audit trail.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { db, getSetting } = require('./db');
const { HttpError, requireAuth, requireRole, rateLimit } = require('./auth');
const listings = require('./listings');
const push = require('./push');
const mail = require('./mail');
const auth = require('./auth');

const KYC_DIR = path.join(config.DATA_DIR, 'kyc'); // private: never served from /media
fs.mkdirSync(KYC_DIR, { recursive: true });
const KYC_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const kycUpload = multer({
  dest: config.TMP_DIR,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => cb(null, Boolean(KYC_TYPES[file.mimetype])),
});


const ACCOUNT_TYPES = ['agent', 'agency', 'developer', 'service'];
const SERVICES = ['legal', 'surveying', 'valuation', 'finance', 'architecture & design', 'construction', 'facility management', 'advisory'];
const DOC_TYPES = ['NIN slip', 'National ID card', 'International passport', "Driver's licence", "Voter's card", 'CAC certificate'];
const POST_CATEGORIES = ['insight', 'news', 'guide', 'career'];
const FEATURED_CITIES = ['Kano', 'Abuja', 'Lagos', 'Kaduna', 'Port Harcourt', 'Katsina', 'Ibadan', 'Enugu'];
const { str } = listings;

const profile = (u) => ({
  ...(u.account_type === 'service' ? { phone: u.phone } : {}),
  id: u.id, name: u.company || u.name || 'Member', person: u.company ? u.name : '', type: u.account_type, city: u.city, bio: u.bio,
  service_category: u.service_category, verified: Boolean(u.verified), since: u.created_at,
  listings: db.prepare("SELECT COUNT(*) AS n FROM properties WHERE owner_id = ? AND status = 'active'").get(u.id).n,
});

module.exports = ({ publicUser }) => {
  const r = express.Router();

  r.get('/meta', (_req, res) => res.json({ account_types: ACCOUNT_TYPES, services: SERVICES, doc_types: DOC_TYPES, post_categories: POST_CATEGORIES }));

  // ---------- profile + identity verification ----------
  r.patch('/me', requireAuth, (req, res) => {
    const b = req.body;
    const pro = ['agent', 'admin'].includes(req.user.role);
    const type = pro && ACCOUNT_TYPES.includes(b.account_type) ? b.account_type : req.user.account_type;
    const service = type === 'service' && SERVICES.includes(b.service_category) ? b.service_category : '';
    db.prepare('UPDATE users SET name = ?, company = ?, bio = ?, city = ?, account_type = ?, service_category = ? WHERE id = ?')
      .run(str(b.name, 80), pro ? str(b.company, 100) : '', str(b.bio, 600), str(b.city, 60), type, service, req.user.id);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });

  // Optional email address: verified with a code before it is used for sign-in codes and notifications.
  r.post('/me/email', requireAuth, rateLimit('email', 6, 60 * 60 * 1000), async (req, res) => {
    const email = str(req.body.email, 200).toLowerCase();
    if (!email) {
      db.prepare("UPDATE users SET email = '', email_verified = 0 WHERE id = ?").run(req.user.id);
      return res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
    }
    if (!mail.valid(email)) throw new HttpError(400, 'Enter a valid email address.');
    const code = auth.createOtp(`email:${req.user.id}`);
    db.prepare('UPDATE users SET email = ?, email_verified = 0 WHERE id = ?').run(email, req.user.id);
    if (!(await mail.send(email, `${code} is your ${config.SITE_NAME} email code`, `Enter this code to confirm your email address: ${code}\nIt expires in 10 minutes.`))) {
      throw new HttpError(502, 'We could not send an email to that address.');
    }
    const out = { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) };
    if (!mail.LIVE && !config.PRODUCTION) out.demo_code = code; // demo mode only
    res.json(out);
  });
  r.post('/me/email/verify', requireAuth, rateLimit('emailv', 20, 15 * 60 * 1000), (req, res) => {
    auth.checkOtp(`email:${req.user.id}`, req.body.code);
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(req.user.id);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });

  const ID_TYPES = DOC_TYPES.filter((d) => d !== 'CAC certificate');
  const KYC_KEYS = ['id_front', 'id_back', 'photo', 'address_proof', 'cac'];
  const KYC_LABELS = { id_front: 'a photo of the front of your ID', photo: 'a passport-style photograph', address_proof: 'proof of address (utility bill, bank statement or tenancy agreement)', cac: 'your CAC certificate' };
  const SOURCES = ['Salary', 'Business income', 'Savings', 'Sale of property', 'Gift or inheritance', 'Diaspora remittance', 'Other'];

  // Full identity check: personal details, source of funds, ID, photo, proof of address (+ CAC for agencies and developers).
  r.post('/me/kyc', requireAuth, kycUpload.fields(KYC_KEYS.map((name) => ({ name, maxCount: 1 }))), async (req, res) => {
    const files = req.files || {};
    const drop = () => Object.values(files).flat().forEach((f) => fs.promises.unlink(f.path).catch(() => {}));
    try {
      if (req.user.kyc_status === 'approved') throw new HttpError(409, 'Your identity is already verified.');
      const b = req.body, t = (k, n) => str(b[k], n);
      const biz = ['agency', 'developer'].includes(req.user.account_type), svc = req.user.account_type === 'service';
      const data = {
        full_name: t('full_name', 120), dob: t('dob', 10), gender: ['Male', 'Female'].includes(b.gender) ? b.gender : '', nationality: t('nationality', 60),
        address: t('address', 250), occupation: t('occupation', 100), source_of_funds: SOURCES.includes(b.source_of_funds) ? b.source_of_funds : '',
        id_type: ID_TYPES.includes(b.id_type) ? b.id_type : '', id_number: t('id_number', 40), bvn: /^\d{11}$/.test(String(b.bvn || '')) ? b.bvn : '',
      };
      if (biz) { data.business_name = t('business_name', 150); data.rc_number = t('rc_number', 30); }
      for (const k of ['full_name', 'nationality', 'address', 'occupation', 'id_number']) if (!data[k]) throw new HttpError(400, 'Please fill in every required field.');
      if (!data.id_type || !data.source_of_funds) throw new HttpError(400, 'Please choose your ID type and source of funds.');
      if (biz && (!data.business_name || !data.rc_number)) throw new HttpError(400, 'Enter your business name and CAC (RC) number.');
      if (svc && !SERVICES.includes(b.service_category)) throw new HttpError(400, 'Choose the service you offer.');
      const dob = new Date(data.dob);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.dob) || Number.isNaN(dob.getTime()) || dob.getFullYear() < 1900 || Date.now() - dob.getTime() < 18 * 365.25 * 86400e3) {
        throw new HttpError(400, 'Enter a valid date of birth (you must be 18 or older).');
      }
      if (!['on', 'true'].includes(String(b.consent))) throw new HttpError(400, 'Please confirm the declaration.');
      for (const k of ['id_front', 'photo', 'address_proof', ...(biz ? ['cac'] : [])]) if (!files[k]) throw new HttpError(400, `Please upload ${KYC_LABELS[k]} (JPG, PNG, WebP or PDF, max 10 MB).`);
      const stored = {};
      for (const k of KYC_KEYS) {
        const f = (files[k] || [])[0];
        if (!f) continue;
        const name = `${crypto.randomBytes(16).toString('hex')}.${KYC_TYPES[f.mimetype]}`;
        await fs.promises.rename(f.path, path.join(KYC_DIR, name));
        stored[k] = name;
      }
      let old = {}; try { old = JSON.parse(req.user.kyc_files || '{}'); } catch { /* ignore */ }
      for (const n of [...Object.values(old), req.user.kyc_file]) if (n) fs.promises.unlink(path.join(KYC_DIR, path.basename(n))).catch(() => {});
      db.prepare(`UPDATE users SET kyc_status = 'pending', kyc_data = ?, kyc_files = ?, kyc_doc_type = ?, kyc_file = ?, kyc_note = '',
                    name = CASE WHEN name = '' THEN ? ELSE name END,
                    company = CASE WHEN company = '' THEN ? ELSE company END, service_category = ? WHERE id = ?`)
        .run(JSON.stringify(data), JSON.stringify(stored), data.id_type, stored.id_front, data.full_name, data.business_name || '',
          svc ? b.service_category : req.user.service_category, req.user.id);
    } catch (e) {
      drop();
      throw e;
    }
    push.notifyAdmins({ title: 'Verification request', body: `${req.user.name || '+' + req.user.phone} submitted KYC for review.`, url: '/admin?tab=verify' });
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });

  r.get('/admin/kyc/:id/file', requireRole('admin'), (req, res) => {
    const u = db.prepare('SELECT kyc_file, kyc_files FROM users WHERE id = ?').get(Number(req.params.id) || 0);
    let files = {}; try { files = JSON.parse((u && u.kyc_files) || '{}'); } catch { /* ignore */ }
    const doc = String(req.query.doc || 'id_front');
    const name = files[doc] || (doc === 'id_front' && u ? u.kyc_file : '');
    if (!name) throw new HttpError(404, 'No document on file.');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(path.join(KYC_DIR, path.basename(name)));
  });

  r.post('/admin/users/:id/kyc', requireRole('admin'), (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id) || 0);
    if (!u) throw new HttpError(404, 'Member not found.');
    const ok = req.body.approve === true;
    db.prepare('UPDATE users SET kyc_status = ?, verified = ?, kyc_note = ? WHERE id = ?').run(ok ? 'approved' : 'rejected', ok ? 1 : 0, str(req.body.note, 200), u.id);
    push.notify({
      userId: u.id, url: '/dashboard',
      title: ok ? 'You are verified' : 'Verification not approved',
      body: ok ? 'Your identity check is complete. A verified badge now shows on your profile.' : `Please submit a clearer or different document. ${str(req.body.note, 200)}`,
    });
    res.json({ ok: true });
  });

  // Rapid suspension: signs the member out everywhere and hides their listings.
  r.post('/admin/users/:id/suspend', requireRole('admin'), (req, res) => {
    const id = Number(req.params.id) || 0;
    if (id === req.user.id) throw new HttpError(400, 'You cannot suspend yourself.');
    const on = req.body.suspended === true ? 1 : 0;
    db.prepare('UPDATE users SET suspended = ? WHERE id = ?').run(on, id);
    if (on) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    res.json({ ok: true });
  });

  r.post('/admin/properties/:id/flags', requireRole('admin'), (req, res) => {
    const p = listings.mustGet(req.params.id);
    for (const k of ['verified', 'featured']) {
      if (typeof req.body[k] === 'boolean') db.prepare(`UPDATE properties SET ${k} = ? WHERE id = ?`).run(req.body[k] ? 1 : 0, p.id);
    }
    res.json(listings.present(listings.getProperty(p.id), req.user));
  });

  // ---------- directory ----------
  r.get('/agents', (req, res) => {
    const where = ["role IN ('agent','admin')", 'suspended = 0'];
    const args = [];
    if (ACCOUNT_TYPES.includes(req.query.type)) { where.push('account_type = ?'); args.push(req.query.type); }
    else where.push("account_type != 'service'");
    if (req.query.type === 'service') {
      where.push('verified = 1'); // only verified providers are listed
      if (SERVICES.includes(req.query.category)) { where.push('service_category = ?'); args.push(req.query.category); }
    }
    if (req.query.q) { const like = `%${String(req.query.q).slice(0, 40).replace(/[%_]/g, '')}%`; where.push('(name LIKE ? OR company LIKE ? OR city LIKE ?)'); args.push(like, like, like); }
    const rows = db.prepare(`SELECT * FROM users WHERE ${where.join(' AND ')} ORDER BY verified DESC, id LIMIT 100`).all(...args);
    res.json(rows.map(profile));
  });

  r.get('/agents/:id', (req, res) => {
    const u = db.prepare("SELECT * FROM users WHERE id = ? AND role IN ('agent','admin') AND suspended = 0").get(Number(req.params.id) || 0);
    if (!u) throw new HttpError(404, 'Profile not found.');
    res.json({ ...profile(u), properties: listings.search({ owner: u.id, limit: 24 }, req.user).items });
  });

  r.get('/stats', (_req, res) => {
    const n = (sql) => db.prepare(sql).get().n;
    res.json({
      verified_listings: n("SELECT COUNT(*) AS n FROM properties WHERE status = 'active' AND verified = 1"),
      listings: n("SELECT COUNT(*) AS n FROM properties WHERE status = 'active'"),
      professionals: n("SELECT COUNT(*) AS n FROM users WHERE role IN ('agent','admin') AND verified = 1 AND suspended = 0"),
      cities: n("SELECT COUNT(DISTINCT lower(city)) AS n FROM properties WHERE status = 'active' AND city != ''"),
    });
  });

  // ---------- markets ----------
  r.get('/markets', (_req, res) => {
    const rows = db
      .prepare("SELECT city, state, COUNT(*) AS n, MIN(price) AS from_price FROM properties WHERE status = 'active' AND city != '' AND owner_id NOT IN (SELECT id FROM users WHERE suspended = 1) GROUP BY city COLLATE NOCASE ORDER BY n DESC LIMIT 60")
      .all();
    const by = new Map(rows.map((x) => [x.city.toLowerCase(), x]));
    const featured = FEATURED_CITIES.map((c) => by.get(c.toLowerCase()) || { city: c, state: '', n: 0, from_price: 0 });
    const names = new Set(FEATURED_CITIES.map((c) => c.toLowerCase()));
    res.json({ featured, other: rows.filter((x) => !names.has(x.city.toLowerCase())) });
  });

  // ---------- contact + trust reports ----------
  r.post('/reports', rateLimit('report', 6, 60 * 60 * 1000), (req, res) => {
    const b = req.body;
    const message = str(b.message, 2000);
    if (message.length < 10) throw new HttpError(400, 'Please describe the issue in a little more detail.');
    const kind = ['contact', 'listing', 'security'].includes(b.kind) ? b.kind : 'contact';
    const prop = b.property_id ? listings.getProperty(b.property_id) : null;
    db.prepare('INSERT INTO reports(user_id, property_id, kind, name, contact, message) VALUES(?,?,?,?,?,?)')
      .run(req.user ? req.user.id : null, prop ? prop.id : null, kind, str(b.name, 80) || (req.user ? req.user.name : ''), str(b.contact, 120) || (req.user ? '+' + req.user.phone : ''), message);
    push.notifyAdmins({ title: kind === 'contact' ? 'New contact message' : 'Trust report received', body: message.slice(0, 120), url: '/admin?tab=reports' });
    // Also forward to the company inbox when one is set in Admin > Settings.
    const inbox = getSetting('contact_email');
    if (inbox) {
      const from = `${str(b.name, 80) || (req.user ? req.user.name : '') || 'Visitor'} (${str(b.contact, 120) || (req.user ? '+' + req.user.phone : 'no contact given')})`;
      mail.send(inbox, `${kind === 'contact' ? 'Contact form' : 'Trust report: ' + kind} - ${from}`, `${message}${prop ? `\n\nListing: ${config.BASE_URL}/p/${prop.id}` : ''}\n\nFrom: ${from}`);
    }
    res.status(201).json({ ok: true });
  });

  r.get('/admin/trust', requireRole('admin'), (_req, res) => {
    res.json({
      reports: db.prepare("SELECT r.*, p.title AS property_title FROM reports r LEFT JOIN properties p ON p.id = r.property_id ORDER BY r.status = 'resolved', r.id DESC LIMIT 100").all(),
      audit: db.prepare('SELECT a.*, u.name AS actor_name, u.phone AS actor_phone FROM audit a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 200').all(),
      posts: db.prepare('SELECT * FROM posts ORDER BY id DESC LIMIT 100').all(),
      risk: {
        open_reports: db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open' AND kind != 'contact'").get().n,
        pending_kyc: db.prepare("SELECT COUNT(*) AS n FROM users WHERE kyc_status = 'pending'").get().n,
        disputes: db.prepare("SELECT COUNT(*) AS n FROM escrows WHERE status = 'disputed'").get().n,
        suspended: db.prepare('SELECT COUNT(*) AS n FROM users WHERE suspended = 1').get().n,
        failed_payments: db.prepare("SELECT COUNT(*) AS n FROM payments WHERE status = 'failed' AND created_at > datetime('now','-7 days')").get().n,
        unverified_agents: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'agent' AND verified = 0").get().n,
      },
    });
  });

  r.post('/admin/reports/:id/resolve', requireRole('admin'), (req, res) => {
    db.prepare("UPDATE reports SET status = 'resolved' WHERE id = ?").run(Number(req.params.id) || 0);
    res.json({ ok: true });
  });

  // ---------- insights (simple publishing) ----------
  r.get('/posts', (req, res) => {
    const cat = POST_CATEGORIES.includes(req.query.category) ? req.query.category : null;
    const rows = db.prepare(`SELECT id, slug, title, category, created_at, substr(body, 1, 220) AS excerpt FROM posts WHERE published = 1 ${cat ? 'AND category = ?' : "AND category != 'career'"} ORDER BY id DESC LIMIT 50`).all(...(cat ? [cat] : []));
    res.json(rows);
  });
  r.get('/posts/:slug', (req, res) => {
    const p = db.prepare('SELECT * FROM posts WHERE slug = ? AND published = 1').get(String(req.params.slug));
    if (!p) throw new HttpError(404, 'Article not found.');
    res.json(p);
  });
  const postFields = (b) => {
    const title = str(b.title, 140);
    const body = str(b.body, 20000);
    if (!title || !body) throw new HttpError(400, 'An article needs a title and some text.');
    return [title, POST_CATEGORIES.includes(b.category) ? b.category : 'insight', body, b.published === false ? 0 : 1];
  };
  r.post('/admin/posts', requireRole('admin'), (req, res) => {
    const f = postFields(req.body);
    const base = f[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'post';
    const slug = db.prepare('SELECT 1 FROM posts WHERE slug = ?').get(base) ? `${base}-${crypto.randomBytes(2).toString('hex')}` : base;
    db.prepare('INSERT INTO posts(slug, title, category, body, published) VALUES(?,?,?,?,?)').run(slug, ...f);
    res.status(201).json({ slug });
  });
  r.put('/admin/posts/:id', requireRole('admin'), (req, res) => {
    db.prepare('UPDATE posts SET title = ?, category = ?, body = ?, published = ? WHERE id = ?').run(...postFields(req.body), Number(req.params.id) || 0);
    res.json({ ok: true });
  });
  r.delete('/admin/posts/:id', requireRole('admin'), (req, res) => {
    db.prepare('DELETE FROM posts WHERE id = ?').run(Number(req.params.id) || 0);
    res.json({ ok: true });
  });

  return r;
};
