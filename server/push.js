// In-app notifications + Web Push to registered members.
const webpush = require('web-push');
const config = require('./config');
const { db, getSetting, setSetting } = require('./db');

let publicKey = config.VAPID_PUBLIC_KEY;
let privateKey = config.VAPID_PRIVATE_KEY;
if (!publicKey || !privateKey) {
  publicKey = getSetting('vapid_public');
  privateKey = getSetting('vapid_private');
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    setSetting('vapid_public', publicKey);
    setSetting('vapid_private', privateKey);
  }
}
webpush.setVapidDetails(config.VAPID_SUBJECT, publicKey, privateKey);

function saveSubscription(userId, sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) return false;
  db.prepare(
    'INSERT INTO push_subs(user_id, endpoint, sub) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, sub=excluded.sub'
  ).run(userId, sub.endpoint, JSON.stringify(sub));
  return true;
}

const removeSubscription = (endpoint) => db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);

/**
 * Record a notification and push it. userId = null broadcasts to every registered member.
 * Delivery is best-effort and never throws.
 */
function notify({ userId = null, title, body = '', url = '/' }) {
  db.prepare('INSERT INTO notifications(user_id, title, body, url) VALUES(?,?,?,?)').run(userId, title, body, url);
  const subs = userId
    ? db.prepare('SELECT * FROM push_subs WHERE user_id = ?').all(userId)
    : db.prepare('SELECT * FROM push_subs').all();
  const payload = JSON.stringify({ title, body, url });
  for (const row of subs) {
    webpush.sendNotification(JSON.parse(row.sub), payload, { TTL: 24 * 3600 }).catch((err) => {
      if (err.statusCode === 404 || err.statusCode === 410) removeSubscription(row.endpoint);
    });
  }
}

function notifyAdmins(msg) {
  for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin'").all()) notify({ ...msg, userId: a.id });
}

function listFor(user) {
  const rows = db
    .prepare('SELECT * FROM notifications WHERE (user_id IS NULL AND created_at >= ?) OR user_id = ? ORDER BY id DESC LIMIT 40')
    .all(user.created_at, user.id);
  const unread = rows.filter((r) => r.created_at > (user.notif_seen_at || '')).length;
  return { items: rows, unread };
}

module.exports = { publicKey, saveSubscription, removeSubscription, notify, notifyAdmins, listFor };
