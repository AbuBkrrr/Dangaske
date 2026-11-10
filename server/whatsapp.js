// WhatsApp Cloud API: OTP delivery + a chat bot that lets admins/agents manage listings.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { db } = require('./db');
const listings = require('./listings');
const media = require('./media');

const GRAPH = 'https://graph.facebook.com/v21.0';
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

async function send(payload) {
  if (!config.WHATSAPP_LIVE) {
    console.log(`[whatsapp:demo] -> ${payload.to}: ${payload.text ? payload.text.body : JSON.stringify(payload.template)}`);
    return { demo: true };
  }
  const res = await fetch(`${GRAPH}/${config.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const sendText = (to, body) => send({ to, type: 'text', text: { body: String(body).slice(0, 4000) } });

/** Send a login code. Uses the approved authentication template when configured. */
function sendOtp(to, code) {
  if (config.WHATSAPP_LIVE && config.WHATSAPP_OTP_TEMPLATE) {
    return send({
      to,
      type: 'template',
      template: {
        name: config.WHATSAPP_OTP_TEMPLATE,
        language: { code: config.WHATSAPP_OTP_TEMPLATE_LANG },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    });
  }
  return sendText(to, `${code} is your ${config.SITE_NAME} verification code. It expires in 10 minutes. Do not share it.`);
}

function verifySignature(rawBody, header) {
  if (!config.WHATSAPP_APP_SECRET) return !config.PRODUCTION; // signature is mandatory in production
  const expected = 'sha256=' + crypto.createHmac('sha256', config.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
  const given = String(header || '');
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

async function downloadMedia(mediaId) {
  const auth = { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` };
  const meta = await (await fetch(`${GRAPH}/${encodeURIComponent(mediaId)}`, { headers: auth })).json();
  if (!meta.url) throw new Error('Media not found');
  if (Number(meta.file_size) > MAX_MEDIA_BYTES) throw new Error('File is too large (max 100 MB)');
  const res = await fetch(meta.url, { headers: auth });
  if (!res.ok) throw new Error(`Media download failed: ${res.status}`);
  const tmp = path.join(config.TMP_DIR, crypto.randomBytes(12).toString('hex'));
  await fs.promises.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  return { path: tmp, mimetype: meta.mime_type || 'application/octet-stream' };
}

// ---------- Bot ----------

const HELP = `*${config.SITE_NAME} listing assistant*

*NEW* - start a listing. Send it with details, one per line:
NEW
Title: 4 bedroom duplex
Price: 85000000
Purpose: sale
Type: duplex
State: Kano
City: Kano
Area: Nassarawa GRA
Address: 12 Example Road
Beds: 4
Baths: 5
Size: 600
Document: C of O
Features: BQ, borehole, parking
EasyBuy: yes
Description: Newly built...

Then send photos/videos (they are compressed automatically) and finish with *PUBLISH*.

*LIST* - your recent listings
*SOLD 12* - mark #12 sold (keeps only the cover photo)
*PRICE 12 45000000* - change price
*EDIT 12* then lines like "Title: ..." - edit fields
*PHOTOS 12* - add more photos to #12
*DELETE 12* - remove a listing
*CANCEL* - discard the current draft`;

const FIELD_ALIASES = {
  title: 'title', name: 'title', price: 'price', amount: 'price', purpose: 'purpose', for: 'purpose',
  type: 'type', state: 'state', city: 'city', town: 'city', lga: 'city', area: 'area', address: 'address',
  beds: 'bedrooms', bed: 'bedrooms', bedrooms: 'bedrooms', baths: 'bathrooms', bath: 'bathrooms', bathrooms: 'bathrooms',
  size: 'size_sqm', sqm: 'size_sqm', document: 'title_doc', doc: 'title_doc', documents: 'title_doc',
  features: 'features', easybuy: 'easy_buy', 'easy buy': 'easy_buy', instalment: 'easy_buy', installment: 'easy_buy',
  description: 'description', desc: 'description', details: 'description', phone: 'contact_phone', contact: 'contact_phone',
  fee: 'unlock_fee', 'unlock fee': 'unlock_fee', map: 'map_url',
};

/** Parse "Key: value" lines. Lines without a known key continue the previous value. */
function parseFields(text) {
  const out = {};
  let last = null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z ]{2,14}?)\s*[:=]\s*(.+)$/);
    const key = m && FIELD_ALIASES[m[1].trim().toLowerCase()];
    if (key) {
      out[key] = m[2].trim();
      last = key;
    } else if (last && line.trim()) {
      out[last] += '\n' + line.trim();
    }
  }
  if (out.purpose) out.purpose = out.purpose.toLowerCase().replace(/^for\s+/, '');
  return out;
}

const getDraft = (phone) => {
  const row = db.prepare('SELECT draft_id FROM wa_state WHERE phone = ?').get(phone);
  return row && row.draft_id ? listings.getProperty(row.draft_id) : null;
};
const setDraft = (phone, id) =>
  db.prepare("INSERT INTO wa_state(phone, draft_id) VALUES(?,?) ON CONFLICT(phone) DO UPDATE SET draft_id=excluded.draft_id, updated_at=datetime('now')").run(phone, id);

function ownProperty(user, idText) {
  const p = listings.getProperty(Number(String(idText).replace('#', '')));
  return p && listings.canManage(user, p) ? p : null;
}

/** Handle one text command. Returns the reply text. */
function handleText(user, text) {
  const body = String(text || '').trim();
  const [first, ...rest] = body.split(/\r?\n/);
  const words = first.trim().split(/\s+/);
  const cmd = (words[0] || '').toLowerCase();
  const NOT_FOUND = 'I could not find that listing among yours. Send LIST to see them.';

  switch (cmd) {
    case 'hi': case 'hello': case 'help': case 'menu': case 'start':
      return HELP;

    case 'new': case 'add': case 'post': {
      const fields = parseFields(rest.join('\n'));
      if (!fields.title || !fields.price) {
        return 'To start a listing I need at least a Title and a Price. Example:\n\nNEW\nTitle: 3 bedroom bungalow\nPrice: 35000000\nState: Kano\nCity: Kano\n\nSend HELP for every field.';
      }
      const p = listings.createProperty(user, fields, 'whatsapp');
      setDraft(user.phone, p.id);
      return `Draft #${p.id} saved: ${p.title} - ${listings.naira(p.price)}.\n\nNow send the photos and videos (the first photo becomes the cover). Send PUBLISH when you are done.`;
    }

    case 'publish': case 'done': {
      const p = words[1] ? ownProperty(user, words[1]) : getDraft(user.phone);
      if (!p) return 'There is no draft to publish. Send NEW to start one.';
      if (!['draft', 'rejected'].includes(p.status)) return `#${p.id} is already ${p.status}.`;
      const out = listings.submit(p, user);
      setDraft(user.phone, null);
      return out.status === 'active'
        ? `#${p.id} is live: ${config.BASE_URL}/p/${p.id}\nMembers have been notified.`
        : `#${p.id} was submitted and will go live once approved.`;
    }

    case 'cancel': {
      const p = getDraft(user.phone);
      if (!p) return 'Nothing to cancel.';
      setDraft(user.phone, null);
      if (p.status === 'draft') { listings.removeProperty(p); return `Draft #${p.id} discarded.`; }
      return `Stopped adding to #${p.id}.`;
    }

    case 'list': case 'listings': {
      const rows = user.role === 'admin'
        ? db.prepare('SELECT * FROM properties ORDER BY id DESC LIMIT 15').all()
        : db.prepare('SELECT * FROM properties WHERE owner_id = ? ORDER BY id DESC LIMIT 15').all(user.id);
      if (!rows.length) return 'No listings yet. Send NEW to add one.';
      return rows.map((p) => `#${p.id} [${p.status}] ${p.title} - ${listings.naira(p.price)}`).join('\n');
    }

    case 'sold': {
      const p = ownProperty(user, words[1]);
      if (!p) return NOT_FOUND;
      if (p.status === 'sold') return `#${p.id} is already marked sold.`;
      const out = listings.markSold(p);
      return `#${p.id} marked SOLD. Extra photos/videos removed (${(out.freed_bytes / 1048576).toFixed(1)} MB freed), cover kept. Members notified.`;
    }

    case 'price': {
      const p = ownProperty(user, words[1]);
      const price = listings.int(words[2]);
      if (!p) return NOT_FOUND;
      if (!price) return 'Usage: PRICE 12 45000000';
      listings.updateProperty(p.id, { price });
      return `#${p.id} price is now ${listings.naira(price)}.`;
    }

    case 'edit': {
      const p = ownProperty(user, words[1]);
      if (!p) return NOT_FOUND;
      const fields = parseFields(rest.join('\n'));
      if (!Object.keys(fields).length) return `Send EDIT ${p.id} followed by lines to change, e.g.\n\nEDIT ${p.id}\nTitle: New title\nBeds: 4`;
      listings.updateProperty(p.id, fields);
      return `#${p.id} updated (${Object.keys(fields).join(', ')}).`;
    }

    case 'photos': case 'media': {
      const p = ownProperty(user, words[1]);
      if (!p) return NOT_FOUND;
      if (p.status === 'sold') return 'That listing is sold; media can no longer be added.';
      setDraft(user.phone, p.id);
      return `Send the photos/videos for #${p.id} now. Send CANCEL when finished.`;
    }

    case 'delete': case 'remove': {
      const p = ownProperty(user, words[1]);
      if (!p) return NOT_FOUND;
      listings.removeProperty(p);
      return `#${p.id} deleted with all its media.`;
    }

    default:
      return 'Sorry, I did not understand that. Send HELP to see what I can do.';
  }
}

async function handleMedia(user, msg) {
  const item = msg[msg.type];
  let target = getDraft(user.phone);
  const tagged = String(item.caption || '').match(/#(\d+)/);
  if (tagged) target = ownProperty(user, tagged[1]) || target;
  if (!target) return 'Send NEW with the listing details first, then the photos. (Or PHOTOS 12 to add to listing #12.)';
  if (target.status === 'sold') return 'That listing is sold; media can no longer be added.';
  const file = await downloadMedia(item.id);
  if (!/^(image|video)\//.test(file.mimetype)) {
    fs.promises.unlink(file.path).catch(() => {});
    return 'Only photos and videos can be attached.';
  }
  const before = fs.statSync(file.path).size;
  const row = await media.addMedia(target.id, file.path, file.mimetype);
  if (row.kind === 'video') return `Video added to #${target.id} - compressing in the background.`;
  const saved = before > 0 ? Math.max(0, Math.round((1 - row.bytes / before) * 100)) : 0;
  return `Photo added to #${target.id} (compressed ${saved}%).`;
}

async function handleMessage(msg) {
  const phone = String(msg.from || '').replace(/\D/g, '');
  if (!phone || !msg.id) return;
  // WhatsApp retries deliveries: process each message id once.
  if (db.prepare('INSERT OR IGNORE INTO wa_seen(id, at) VALUES(?,?)').run(msg.id, Date.now()).changes === 0) return;

  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user && config.ADMIN_PHONES.includes(phone)) {
    db.prepare("INSERT INTO users(phone, name, role) VALUES(?, ?, 'admin')").run(phone, config.COMPANY);
    user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  }
  if (!user || !['admin', 'agent'].includes(user.role)) {
    await sendText(phone, `Welcome to ${config.SITE_NAME} by ${config.COMPANY}.\nBrowse properties, easy-buy plans and escrow at ${config.BASE_URL}\n\nListing by WhatsApp is available to registered agents - sign up on the website as an agent first.`);
    return;
  }

  let reply;
  try {
    if (msg.type === 'text') reply = handleText(user, msg.text.body);
    else if (msg.type === 'image' || msg.type === 'video') reply = await handleMedia(user, msg);
    else if (msg.type === 'document' && /^(image|video)\//.test(msg.document.mime_type || '')) reply = await handleMedia(user, msg);
    else reply = 'I can read text commands, photos and videos. Send HELP for the menu.';
  } catch (e) {
    reply = e.status ? e.message : 'Something went wrong handling that. Please try again.';
    if (!e.status) console.error('WhatsApp bot error:', e);
  }
  if (reply) await sendText(phone, reply);
}

/** Entry point for the webhook body. Messages from one sender are handled in order. */
const chains = new Map();
function handleWebhook(body) {
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      for (const msg of (change.value && change.value.messages) || []) {
        const prev = chains.get(msg.from) || Promise.resolve();
        const next = prev.then(() => handleMessage(msg)).catch((e) => console.error('WhatsApp handler error:', e.message));
        chains.set(msg.from, next);
        next.finally(() => { if (chains.get(msg.from) === next) chains.delete(msg.from); });
      }
    }
  }
}

setInterval(() => db.prepare('DELETE FROM wa_seen WHERE at < ?').run(Date.now() - 3 * 24 * 3600 * 1000), 6 * 3600 * 1000).unref();

module.exports = { sendText, sendOtp, verifySignature, handleWebhook, handleText, parseFields, HELP };
