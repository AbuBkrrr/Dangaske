// Property listing logic shared by the web API and the WhatsApp bot.
const config = require('./config');
const { db, getSetting } = require('./db');
const { HttpError } = require('./auth');
const media = require('./media');
const push = require('./push');
const social = require('./social');

const PURPOSES = ['sale', 'rent', 'shortlet'];
const TYPES = ['house', 'duplex', 'bungalow', 'apartment', 'land', 'commercial'];

const int = (v, max = 1e13) => {
  const n = Math.round(Number(String(v ?? '').replace(/[,\s₦]/g, '')));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');

/** Pick + sanitise editable listing fields from arbitrary input. */
function cleanFields(input, { partial = false } = {}) {
  const out = {};
  const has = (k) => input[k] !== undefined && input[k] !== null;
  const set = (k, v) => { if (has(k) || !partial) out[k] = v; };
  set('title', str(input.title, 120));
  set('description', str(input.description, 5000));
  set('purpose', PURPOSES.includes(String(input.purpose).toLowerCase()) ? String(input.purpose).toLowerCase() : 'sale');
  set('type', TYPES.includes(String(input.type).toLowerCase()) ? String(input.type).toLowerCase() : 'house');
  set('price', int(input.price));
  set('state', str(input.state, 60));
  set('city', str(input.city, 60));
  set('area', str(input.area, 80));
  set('address', str(input.address, 200));
  set('bedrooms', int(input.bedrooms, 50));
  set('bathrooms', int(input.bathrooms, 50));
  set('size_sqm', int(input.size_sqm, 1e8));
  set('features', str(input.features, 400));
  set('title_doc', str(input.title_doc, 80));
  set('contact_phone', str(input.contact_phone, 30));
  set('map_url', /^https:\/\//i.test(String(input.map_url || '')) ? str(input.map_url, 300) : '');
  set('easy_buy', input.easy_buy === true || /^(1|true|yes|y)$/i.test(String(input.easy_buy)) ? 1 : 0);
  if (has('unlock_fee')) out.unlock_fee = input.unlock_fee === '' ? null : int(input.unlock_fee, 1e7);
  return out;
}

function createProperty(owner, input, source = 'web') {
  const f = cleanFields(input);
  if (!f.title) throw new HttpError(400, 'A title is required.');
  if (!f.price) throw new HttpError(400, 'A valid price is required.');
  if (!f.contact_phone) f.contact_phone = owner.phone;
  f.owner_id = owner.id;
  f.source = source;
  const keys = Object.keys(f);
  const info = db
    .prepare(`INSERT INTO properties(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`)
    .run(...keys.map((k) => f[k]));
  return getProperty(info.lastInsertRowid);
}

function updateProperty(id, input) {
  const f = cleanFields(input, { partial: true });
  if ('title' in f && !f.title) throw new HttpError(400, 'A title is required.');
  if ('price' in f && !f.price) throw new HttpError(400, 'A valid price is required.');
  const keys = Object.keys(f);
  if (keys.length) db.prepare(`UPDATE properties SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), id);
  return getProperty(id);
}

const getProperty = (id) => db.prepare('SELECT * FROM properties WHERE id = ?').get(Number(id) || 0);

function mustGet(id) {
  const p = getProperty(id);
  if (!p) throw new HttpError(404, 'Listing not found.');
  return p;
}

const canManage = (user, p) => Boolean(user && (user.role === 'admin' || user.id === p.owner_id));
const unlockFee = (p) => (p.unlock_fee === null || p.unlock_fee === undefined ? int(getSetting('default_unlock_fee')) : p.unlock_fee);
const hasUnlocked = (user, p) =>
  Boolean(user && db.prepare('SELECT 1 FROM unlocks WHERE user_id = ? AND property_id = ?').get(user.id, p.id));
const mediaUrl = (file) => (file ? `/media/${file}` : '');

/**
 * Shape a listing for the client. Everyone gets the teaser; address, full description,
 * gallery, documents and contact details are only included for viewers who paid to unlock
 * (or the owner / an admin, or when the fee is zero).
 */
function present(p, user) {
  const fee = unlockFee(p);
  const manage = canManage(user, p);
  const full = manage || fee === 0 || hasUnlocked(user, p);
  const cover = p.cover_media_id ? db.prepare('SELECT * FROM media WHERE id = ?').get(p.cover_media_id) : null;
  const counts = db
    .prepare("SELECT SUM(kind='image') AS images, SUM(kind='video') AS videos FROM media WHERE property_id = ?")
    .get(p.id);
  const out = {
    id: p.id, title: p.title, purpose: p.purpose, type: p.type, price: p.price,
    state: p.state, city: p.city, area: p.area,
    bedrooms: p.bedrooms, bathrooms: p.bathrooms, size_sqm: p.size_sqm,
    easy_buy: Boolean(p.easy_buy), status: p.status,
    created_at: p.created_at, published_at: p.published_at, sold_at: p.sold_at,
    cover: cover ? mediaUrl(cover.file) : '', cover_thumb: cover ? mediaUrl(cover.thumb) : '',
    image_count: counts.images || 0, video_count: counts.videos || 0,
    excerpt: p.description.length > 160 ? p.description.slice(0, 160).trimEnd() + '…' : p.description,
    unlock_fee: fee, locked: !full, can_manage: manage,
  };
  if (full) {
    const owner = db.prepare('SELECT name, role FROM users WHERE id = ?').get(p.owner_id);
    Object.assign(out, {
      description: p.description, address: p.address, features: p.features, title_doc: p.title_doc,
      contact_phone: p.contact_phone, map_url: p.map_url,
      listed_by: owner ? owner.name || (owner.role === 'admin' ? config.COMPANY : 'Agent') : '',
      media: db.prepare('SELECT * FROM media WHERE property_id = ? ORDER BY id').all(p.id).map((m) => ({
        id: m.id, kind: m.kind, status: m.status, url: mediaUrl(m.file), thumb: mediaUrl(m.thumb),
        is_cover: m.id === p.cover_media_id,
        ...(manage ? { bytes: m.bytes, orig_bytes: m.orig_bytes } : {}),
      })),
    });
    if (manage) out.unlock_fee_override = p.unlock_fee;
  }
  return out;
}

function search(q, user) {
  const where = ["status IN ('active','sold')"];
  const args = [];
  const add = (sql, ...a) => { where.push(sql); args.push(...a); };
  if (q.q) {
    const like = `%${String(q.q).slice(0, 60).replace(/[%_]/g, '')}%`;
    add('(title LIKE ? OR city LIKE ? OR area LIKE ? OR state LIKE ?)', like, like, like, like);
  }
  if (PURPOSES.includes(q.purpose)) add('purpose = ?', q.purpose);
  if (TYPES.includes(q.type)) add('type = ?', q.type);
  if (q.state) add('state = ? COLLATE NOCASE', String(q.state));
  if (int(q.min)) add('price >= ?', int(q.min));
  if (int(q.max)) add('price <= ?', int(q.max));
  if (int(q.beds)) add('bedrooms >= ?', int(q.beds, 50));
  if (q.easy === '1') add('easy_buy = 1');
  if (q.available === '1') add("status = 'active'");
  const order = { price_asc: 'price ASC', price_desc: 'price DESC' }[q.sort] || "status = 'sold', published_at DESC, id DESC";
  const limit = Math.min(int(q.limit) || 12, 48);
  const page = Math.max(int(q.page) || 1, 1);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM properties WHERE ${where.join(' AND ')}`).get(...args).n;
  const rows = db
    .prepare(`SELECT * FROM properties WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...args, limit, (page - 1) * limit);
  return { total, page, pages: Math.max(1, Math.ceil(total / limit)), items: rows.map((p) => present(p, user)) };
}

const propertyUrl = (p) => `/p/${p.id}`;
const place = (p) => [p.area, p.city, p.state].filter(Boolean).join(', ');

/** Make a listing live: push to all members, auto-post to social pages, ping matching requests. */
function publish(p) {
  if (p.status === 'active') return p;
  db.prepare("UPDATE properties SET status = 'active', published_at = datetime('now') WHERE id = ?").run(p.id);
  p = getProperty(p.id);
  const headline = `${p.title} — ${naira(p.price)}`;
  push.notify({ title: 'New listing', body: `${headline}${place(p) ? ' · ' + place(p) : ''}`, url: propertyUrl(p) });
  social.autoPost(p).catch((e) => console.error('Social auto-post failed:', e.message));

  const matches = db
    .prepare(
      `SELECT DISTINCT user_id FROM requests WHERE status = 'open' AND user_id != ?
         AND purpose = ? AND (type = '' OR type = ?)
         AND (state = '' OR state = ? COLLATE NOCASE)
         AND (min_price = 0 OR min_price <= ?) AND (max_price = 0 OR max_price >= ?)
         AND bedrooms <= ?`
    )
    .all(p.owner_id, p.purpose, p.type, p.state, p.price, p.price, p.bedrooms);
  for (const m of matches) {
    push.notify({ userId: m.user_id, title: 'A property matches your request', body: headline, url: propertyUrl(p) });
  }
  return p;
}

/** Owner submits a draft. Admin listings go live at once; agent listings wait for approval. */
function submit(p, user) {
  if (!['draft', 'rejected'].includes(p.status)) return p;
  if (user.role === 'admin') return publish(p);
  db.prepare("UPDATE properties SET status = 'pending' WHERE id = ?").run(p.id);
  push.notifyAdmins({ title: 'Listing awaiting approval', body: p.title, url: '/admin' });
  return getProperty(p.id);
}

/** Mark sold: frees storage (keeps only the cover) and announces the sale. */
function markSold(p) {
  if (p.status === 'sold') return p;
  db.prepare("UPDATE properties SET status = 'sold', sold_at = datetime('now') WHERE id = ?").run(p.id);
  const freed = media.purgeSoldMedia(p.id);
  db.prepare("UPDATE escrows SET status = 'cancelled', updated_at = datetime('now') WHERE property_id = ? AND status = 'awaiting_payment'").run(p.id);
  push.notify({ title: 'Just sold', body: `${p.title}${place(p) ? ' · ' + place(p) : ''}`, url: propertyUrl(p) });
  const out = getProperty(p.id);
  out.freed_bytes = freed;
  return out;
}

function removeProperty(p) {
  const busy = db
    .prepare("SELECT 1 FROM escrows WHERE property_id = ? AND status IN ('funded','disputed','released','refunded') UNION SELECT 1 FROM subscriptions WHERE property_id = ? AND status IN ('active','completed')")
    .get(p.id, p.id);
  if (busy) throw new HttpError(409, 'This listing has payment records and cannot be deleted. Mark it sold instead.');
  media.deleteAllMedia(p.id);
  db.transaction(() => {
    db.prepare('DELETE FROM escrows WHERE property_id = ?').run(p.id);
    db.prepare('DELETE FROM subscriptions WHERE property_id = ?').run(p.id);
    db.prepare('DELETE FROM properties WHERE id = ?').run(p.id);
  })();
}

module.exports = {
  PURPOSES, TYPES, int, str, naira, place, propertyUrl,
  createProperty, updateProperty, getProperty, mustGet, canManage, unlockFee, hasUnlocked,
  present, search, publish, submit, markSold, removeProperty,
};
