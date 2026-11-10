// End-to-end checks of the main flows against a throwaway database (demo integrations).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dangida-'));
process.env.ADMIN_PHONES = '2348011111111';
process.env.NODE_ENV = 'test';
for (const k of ['WHATSAPP_TOKEN', 'PAYSTACK_SECRET_KEY', 'WHATSAPP_APP_SECRET']) delete process.env[k];

const sharp = require('sharp');
const app = require('../server/index');
const { db } = require('../server/db');
const whatsapp = require('../server/whatsapp');
const media = require('../server/media');

let base, server;
const client = () => {
  let cookie = '';
  return async (method, url, body, form) => {
    const res = await fetch(base + url, {
      method, body: form || (body ? JSON.stringify(body) : undefined),
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
};
async function login(c, phone, extra = {}) {
  const r = await c('POST', '/api/auth/request-otp', { phone });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = await c('POST', '/api/auth/verify', { phone, code: r.body.demo_code, ...extra });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v.body.user;
}
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 120, b: 90 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).png().toBuffer();

test.before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
test.after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

const admin = client(), buyer = client(), agent = client(), anon = client();
let propId;

test('phone sign-up with WhatsApp code', async () => {
  const bad = await anon('POST', '/api/auth/verify', { phone: '08022222222', code: '000000' });
  assert.equal(bad.status, 400);
  assert.equal((await login(admin, '08011111111', { name: 'Boss' })).role, 'admin');
  const b = await login(buyer, '0802 222 2222', { name: 'Bala', role: 'admin' });
  assert.equal(b.role, 'buyer'); // cannot self-assign admin
  assert.equal(b.phone, '2348022222222');
  assert.equal((await login(agent, '+2348033333333', { name: 'Ada', role: 'agent' })).role, 'agent');
  assert.equal((await anon('POST', '/api/auth/request-otp', { phone: '08044444444' })).status, 200);
  assert.equal((await anon('POST', '/api/auth/request-otp', { phone: '08044444444' })).status, 429); // resend cooldown
});

test('listing, automatic compression, publish + notifications', async () => {
  assert.equal((await buyer('POST', '/api/properties', { title: 'x', price: 1 })).status, 403);
  const p = await admin('POST', '/api/properties', { title: 'Test duplex', price: '50,000,000', state: 'Kano', city: 'Kano', bedrooms: 4, easy_buy: true, address: '1 Secret Road', description: 'd'.repeat(300) });
  assert.equal(p.status, 201);
  propId = p.body.id;
  const form = new FormData();
  for (let i = 0; i < 3; i++) form.append('files', new Blob([await png(2400, 1800)], { type: 'image/png' }), `a${i}.png`);
  const up = await admin('POST', `/api/properties/${propId}/media`, null, form);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.media.length, 3);
  for (const m of up.body.media) assert.ok(m.bytes < m.orig_bytes / 2, 'image should be much smaller after compression');
  assert.ok(up.body.media[0].is_cover);
  assert.deepEqual(fs.readdirSync(path.join(process.env.DATA_DIR, 'tmp')), []); // originals removed
  assert.equal((await anon('GET', `/api/properties/${propId}`)).status, 404); // draft hidden
  const pub = await admin('POST', `/api/properties/${propId}/submit`);
  assert.equal(pub.body.status, 'active');
  const n = await buyer('GET', '/api/notifications');
  assert.ok(n.body.items.some((x) => x.title === 'New listing'));
});

test('pay to view full information', async () => {
  const teaser = await buyer('GET', `/api/properties/${propId}`);
  assert.equal(teaser.body.locked, true);
  for (const k of ['address', 'contact_phone', 'media', 'description']) assert.equal(teaser.body[k], undefined);
  assert.equal((await anon('POST', `/api/properties/${propId}/unlock`)).status, 401);
  const pay = await buyer('POST', `/api/properties/${propId}/unlock`);
  assert.match(pay.body.url, /^\/pay\/demo/);
  assert.equal((await agent('POST', `/api/payments/demo/${pay.body.reference}`)).status, 404); // someone else's payment
  assert.equal((await buyer('POST', `/api/payments/demo/${pay.body.reference}`)).body.paid, true);
  const full = await buyer('GET', `/api/properties/${propId}`);
  assert.equal(full.body.locked, false);
  assert.equal(full.body.address, '1 Secret Road');
  assert.equal(full.body.media.length, 3);
});

test('easy-buy plan and instalments', async () => {
  const page = await buyer('GET', `/api/properties/${propId}`);
  const plan = page.body.plans[0];
  const sub = await buyer('POST', `/api/properties/${propId}/subscribe`, { plan_id: plan.plan_id });
  assert.equal(sub.status, 201);
  assert.equal(sub.body.installments.length, plan.months + 1);
  assert.equal(sub.body.installments.reduce((a, i) => a + i.amount, 0), plan.total);
  assert.equal((await buyer('POST', `/api/installments/${sub.body.installments[1].id}/pay`)).status, 409); // deposit first
  const pay = await buyer('POST', `/api/installments/${sub.body.installments[0].id}/pay`);
  await buyer('POST', `/api/payments/demo/${pay.body.reference}`);
  await buyer('POST', `/api/payments/demo/${pay.body.reference}`); // idempotent
  const mine = await buyer('GET', '/api/my/subscriptions');
  assert.equal(mine.body[0].status, 'active');
  assert.equal(mine.body[0].paid, plan.deposit);
});

test('agent listing needs approval; property requests', async () => {
  const p = await agent('POST', '/api/properties', { title: 'Agent land', price: 5000000, type: 'land', state: 'Kano' });
  assert.equal((await agent('POST', `/api/properties/${p.body.id}/submit`)).body.status, 'pending');
  assert.equal((await agent('PATCH', `/api/properties/${propId}`, { price: 1 })).status, 403);
  const req = await buyer('POST', '/api/requests', { purpose: 'sale', type: 'land', state: 'Kano', max_price: 6000000, details: 'Need a dry plot' });
  assert.equal(req.status, 201);
  assert.equal((await anon('GET', '/api/requests')).body[0].contact_phone, undefined);
  assert.equal((await agent('GET', '/api/requests')).body[0].contact_phone, '2348022222222');
  assert.equal((await agent('POST', `/api/admin/properties/${p.body.id}/approve`)).status, 403);
  assert.equal((await admin('POST', `/api/admin/properties/${p.body.id}/approve`)).status, 200);
  const n = await buyer('GET', '/api/notifications');
  assert.ok(n.body.items.some((x) => x.title === 'A property matches your request'));
});

test('escrow: fund, release -> sold, media purged except cover', async () => {
  assert.equal((await admin('POST', `/api/properties/${propId}/escrow`, {})).status, 400); // own listing
  const e = await buyer('POST', `/api/properties/${propId}/escrow`, { amount: 48000000, note: 'agreed' });
  assert.equal(e.body.status, 'awaiting_payment');
  assert.equal(e.body.fee, 720000);
  assert.equal((await buyer('POST', `/api/escrows/${e.body.id}/release`)).status, 409); // not funded
  const pay = await buyer('POST', `/api/escrows/${e.body.id}/pay`);
  await buyer('POST', `/api/payments/demo/${pay.body.reference}`);
  assert.equal((await agent('POST', `/api/properties/${propId}/escrow`, {})).status, 409); // already held
  assert.equal((await agent('POST', `/api/escrows/${e.body.id}/release`)).status, 404);
  const before = fs.readdirSync(path.join(process.env.DATA_DIR, 'media')).length;
  assert.equal((await buyer('POST', `/api/escrows/${e.body.id}/release`)).status, 200);
  const p = await buyer('GET', `/api/properties/${propId}`);
  assert.equal(p.body.status, 'sold');
  assert.equal(p.body.media.length, 1);
  assert.ok(p.body.media[0].is_cover);
  assert.equal(fs.readdirSync(path.join(process.env.DATA_DIR, 'media')).length, before - 4); // 2 photos x (file+thumb)
  assert.ok((await agent('GET', '/api/notifications')).body.items.some((x) => x.title === 'Just sold'));
});

test('WhatsApp bot manages listings', async () => {
  const boss = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();
  assert.match(whatsapp.handleText(boss, 'help'), /NEW/);
  const r = whatsapp.handleText(boss, 'NEW\nTitle: Bot bungalow\nPrice: 12,500,000\nState: Kano\nBeds: 3\nEasyBuy: yes\nDescription: Nice place\nsecond line');
  const id = Number(r.match(/#(\d+)/)[1]);
  let p = db.prepare('SELECT * FROM properties WHERE id = ?').get(id);
  assert.deepEqual([p.price, p.bedrooms, p.easy_buy, p.status, p.source], [12500000, 3, 1, 'draft', 'whatsapp']);
  assert.equal(p.description, 'Nice place\nsecond line');
  const tmp = path.join(process.env.DATA_DIR, 'tmp', 'wa1'); fs.writeFileSync(tmp, await png(1200, 900));
  await media.addMedia(id, tmp, 'image/png');
  assert.match(whatsapp.handleText(boss, 'publish'), /is live/);
  assert.match(whatsapp.handleText(boss, `price ${id} 13000000`), /13,000,000/);
  assert.match(whatsapp.handleText(boss, `SOLD ${id}`), /SOLD/);
  assert.equal(db.prepare('SELECT status FROM properties WHERE id = ?').get(id).status, 'sold');
  const buyerUser = db.prepare("SELECT * FROM users WHERE role = 'agent'").get();
  assert.match(whatsapp.handleText(buyerUser, `delete ${id}`), /could not find/); // not theirs
  const bad = await anon('POST', '/api/whatsapp/webhook', { entry: [] });
  assert.equal(bad.status, 200); // unsigned accepted only outside production with no secret
});

test('share pages carry preview tags; push + admin', async () => {
  const html = await anon('GET', `/p/${propId}`);
  assert.match(html.body, /og:title" content="Test duplex/);
  assert.match(html.body, /og:image" content="http[^"]+\/media\/[a-f0-9]+\.webp/);
  assert.equal((await buyer('POST', '/api/push/subscribe', { endpoint: 'https://push.example/abc', keys: { p256dh: 'x', auth: 'y' } })).status, 200);
  assert.equal((await buyer('GET', '/api/admin/overview')).status, 403);
  const o = await admin('GET', '/api/admin/overview');
  assert.equal(o.body.stats.sold, 2);
  assert.ok(o.body.stats.storage_saved > 0);
  assert.equal((await admin('PUT', '/api/admin/settings', { default_unlock_fee: 0 })).body.default_unlock_fee, '0');
});
