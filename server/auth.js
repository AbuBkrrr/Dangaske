const crypto = require('crypto');
const config = require('./config');
const { db } = require('./db');

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sha = (s) => crypto.createHmac('sha256', config.SESSION_SECRET).update(String(s)).digest('hex');

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Normalise to international digits-only format, e.g. 0803... -> 234803... */
function normalizePhone(input) {
  let p = String(input || '').trim();
  const plus = p.startsWith('+');
  p = p.replace(/\D/g, '');
  if (!p) return null;
  if (!plus) {
    if (p.startsWith('00')) p = p.slice(2);
    else if (p.startsWith('0')) p = config.DEFAULT_COUNTRY_CODE + p.slice(1);
    else if (p.length <= 10) p = config.DEFAULT_COUNTRY_CODE + p;
  }
  if (p.length < 10 || p.length > 15) return null;
  return p;
}

function createOtp(phone) {
  const now = Date.now();
  const existing = db.prepare('SELECT sent_at FROM otps WHERE phone = ?').get(phone);
  if (existing && now - existing.sent_at < OTP_RESEND_MS) {
    throw new HttpError(429, 'Please wait a minute before requesting another code.');
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.prepare(
    `INSERT INTO otps(phone, code_hash, expires_at, attempts, sent_at) VALUES(?,?,?,0,?)
     ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, sent_at=excluded.sent_at`
  ).run(phone, sha(`${phone}:${code}`), now + OTP_TTL_MS, now);
  return code;
}

function checkOtp(phone, code) {
  const row = db.prepare('SELECT * FROM otps WHERE phone = ?').get(phone);
  if (!row || row.expires_at < Date.now()) throw new HttpError(400, 'Code expired. Request a new one.');
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, 'Too many wrong attempts. Request a new code.');
  const given = Buffer.from(sha(`${phone}:${String(code || '').trim()}`));
  const ok = crypto.timingSafeEqual(given, Buffer.from(row.code_hash));
  if (!ok) {
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?').run(phone);
    throw new HttpError(400, 'Incorrect code.');
  }
  db.prepare('DELETE FROM otps WHERE phone = ?').run(phone);
}

function upsertUser(phone, { name, role } = {}) {
  const isAdmin = config.ADMIN_PHONES.includes(phone);
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    const r = isAdmin ? 'admin' : ['agent', 'agency', 'developer', 'service'].includes(role) ? 'agent' : 'buyer';
    const info = db.prepare('INSERT INTO users(phone, name, role) VALUES(?,?,?)').run(phone, String(name || '').slice(0, 80), r);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    user.isNew = true;
  } else if (user.suspended) {
    throw new HttpError(403, 'This account is suspended. Please contact support.');
  } else if (isAdmin && user.role !== 'admin') {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
    user.role = 'admin';
  }
  return user;
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?,?,?)').run(sha(token), userId, Date.now() + SESSION_TTL_MS);
  const secure = config.BASE_URL.startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
  return token;
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function loadUser(req, _res, next) {
  const token = readCookie(req, 'sid');
  if (token) {
    const row = db
      .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.suspended = 0')
      .get(sha(token), Date.now());
    if (row) req.user = row;
  }
  next();
}

function destroySession(req, res) {
  const token = readCookie(req, 'sid');
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

const requireAuth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in first.')));
/** Agents, agencies, developers and service providers must pass KYC before they can post or manage listings. */
const KYC_MESSAGE = 'Complete identity verification (KYC) to post and manage listings.';
const needKyc = (user) => (user.role === 'agent' && !user.verified ? new HttpError(403, KYC_MESSAGE, 'kyc_required') : null);
const requireVerifiedPro = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in first.'));
  if (req.user.role === 'admin') return next();
  if (req.user.role !== 'agent') return next(new HttpError(403, 'Only agents can post properties.'));
  next(needKyc(req.user) || undefined);
};
const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in first.'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission to do that.'));
  next();
};

/** Small in-memory rate limiter keyed by ip + bucket. */
const hits = new Map();
function rateLimit(bucket, max, windowMs) {
  return (req, _res, next) => {
    const key = `${bucket}:${req.ip}`;
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return next(new HttpError(429, 'Too many requests. Please slow down.'));
    list.push(now);
    hits.set(key, list);
    next();
  };
}
setInterval(() => hits.clear(), 60 * 60 * 1000).unref();

module.exports = {
  HttpError, normalizePhone, createOtp, checkOtp, upsertUser, createSession, destroySession,
  loadUser, requireAuth, requireRole, requireVerifiedPro, needKyc, rateLimit,
};
