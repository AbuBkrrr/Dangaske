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

async function kycFormData(extra = {}, skip = []) {
  const f = new FormData();
  const base = { full_name: 'Ada Okafor', dob: '1990-05-04', nationality: 'Nigerian', address: '12 Zaria Rd, Kano', occupation: 'Estate agent', source_of_funds: 'Business income', id_type: 'NIN slip', id_number: '12345678901', business_name: 'Ada Homes', rc_number: '1234567', consent: 'on', ...extra };
  for (const [k, v] of Object.entries(base)) f.append(k, v);
  for (const k of ['id_front', 'photo', 'address_proof', 'cac']) if (!skip.includes(k)) f.append(k, new Blob([await png(300, 200)], { type: 'image/png' }), `${k}.png`);
  return f;
}

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
  db.prepare("UPDATE users SET verified = 1, kyc_status = 'approved' WHERE phone = '2348033333333'").run(); // verification itself is tested below
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
  await admin('PUT', '/api/admin/settings', { default_unlock_fee: 1000 }); // the fee is off by default; switch it on for this check
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
  assert.match(req.body.url, /pay\/demo/); // a request is paid for first
  assert.equal((await anon('GET', '/api/requests')).body.length, 0); // unpaid requests stay hidden
  await buyer('POST', `/api/payments/demo/${req.body.reference}`);
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

test('video upload is compressed in the background', { skip: !media.HAS_FFMPEG }, async () => {
  const { execFileSync } = require('child_process');
  const src = path.join(process.env.DATA_DIR, 'tmp', 'clip.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=3', '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', src]);
  const orig = fs.statSync(src).size;
  const p = await admin('POST', '/api/properties', { title: 'Video house', price: 9000000 });
  const form = new FormData();
  form.append('files', new Blob([fs.readFileSync(src)], { type: 'video/mp4' }), 'clip.mp4');
  fs.unlinkSync(src);
  const up = await admin('POST', `/api/properties/${p.body.id}/media`, null, form);
  assert.equal(up.body.media[0].status, 'processing');
  await media.whenIdle();
  const done = (await admin('GET', `/api/properties/${p.body.id}`)).body.media[0];
  assert.equal(done.status, 'ready');
  assert.ok(done.bytes < orig / 2, `video should shrink (${orig} -> ${done.bytes})`);
  assert.match(done.thumb, /\.webp$/);
  assert.deepEqual(fs.readdirSync(path.join(process.env.DATA_DIR, 'tmp')), []);
});

test('verification, flags, directory, reports, suspension, audit', async () => {
  const p = await admin('POST', '/api/properties', { title: 'Flag house', price: 7000000, city: 'Kano', state: 'Kano', new_dev: true });
  await admin('POST', `/api/properties/${p.body.id}/submit`);
  assert.equal((await agent('POST', `/api/admin/properties/${p.body.id}/flags`, { verified: true })).status, 403);
  const f = await admin('POST', `/api/admin/properties/${p.body.id}/flags`, { verified: true, featured: true });
  assert.deepEqual([f.body.verified, f.body.featured, f.body.new_dev], [true, true, true]);
  assert.equal((await anon('GET', '/api/properties?featured=1&verified=1&new_dev=1')).body.total, 1);
  assert.ok((await anon('GET', '/api/markets')).body.featured.find((c) => c.city === 'Kano').n >= 1);

  await agent('PATCH', '/api/me', { name: 'Ada', company: 'Ada Homes', account_type: 'agency', bio: 'We sell land' });
  const dir = await anon('GET', '/api/agents?type=agency');
  assert.equal(dir.body[0].name, 'Ada Homes');
  assert.equal(dir.body[0].phone, undefined); // no contact leak around pay-to-view
  assert.equal((await buyer('PATCH', '/api/me', { name: 'Bala', account_type: 'developer' })).body.user.account_type, 'individual');

  const agentId = (await agent('GET', '/api/me')).body.user.id;
  db.prepare("UPDATE users SET verified = 0, kyc_status = 'none' WHERE id = ?").run(agentId);
  const blocked = await agent('POST', '/api/properties', { title: 'Blocked', price: 1000000 });
  assert.deepEqual([blocked.status, blocked.body.code], [403, 'kyc_required']); // professionals cannot post before KYC
  assert.equal((await agent('PATCH', `/api/properties/${propId}`, { price: 1 })).status, 403);
  assert.equal((await agent('POST', '/api/me/kyc', null, await kycFormData({}, ['cac']))).status, 400); // agency needs the CAC certificate
  assert.equal((await agent('POST', '/api/me/kyc', null, await kycFormData({ dob: '2015-01-01' }))).status, 400); // under 18
  assert.equal((await agent('POST', '/api/me/kyc', null, await kycFormData({ id_type: 'Library card' }))).status, 400);
  const k = await agent('POST', '/api/me/kyc', null, await kycFormData());
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.equal(k.body.user.kyc_status, 'pending');
  assert.equal(k.body.user.kyc_data.rc_number, '1234567');
  assert.equal((await agent('POST', '/api/properties', { title: 'Still blocked', price: 1000000 })).status, 403); // pending is not enough
  assert.equal((await buyer('GET', `/api/admin/kyc/${agentId}/file`)).status, 403);
  assert.equal((await admin('GET', `/api/admin/kyc/${agentId}/file?doc=cac`)).status, 200);
  assert.equal((await admin('GET', `/api/admin/kyc/${agentId}/file?doc=nope`)).status, 404);
  assert.equal(fs.readdirSync(path.join(process.env.DATA_DIR, 'kyc')).length, 4); // id, photo, address, CAC
  await admin('POST', `/api/admin/users/${agentId}/kyc`, { approve: true });
  assert.equal((await anon('GET', `/api/agents/${agentId}`)).body.verified, true);
  assert.equal((await agent('POST', '/api/properties', { title: 'Allowed after KYC', price: 1000000 })).status, 201);

  assert.equal((await anon('POST', '/api/reports', { kind: 'listing', property_id: p.body.id, message: 'short' })).status, 400);
  assert.equal((await anon('POST', '/api/reports', { kind: 'listing', property_id: p.body.id, message: 'This listing looks fake to me' })).status, 201);
  const slug = (await admin('POST', '/api/admin/posts', { title: 'Buying land safely', body: 'Check the title.', category: 'guide' })).body.slug;
  assert.equal((await anon('GET', `/api/posts/${slug}`)).body.title, 'Buying land safely');
  const t = await admin('GET', '/api/admin/trust');
  assert.equal(t.body.reports[0].property_id, p.body.id);
  assert.ok(t.body.audit.some((a) => a.action.includes('/flags')) && t.body.audit.some((a) => a.action === 'signup'));

  const before = (await anon('GET', '/api/properties?type=land')).body.total;
  await admin('POST', `/api/admin/users/${agentId}/suspend`, { suspended: true });
  assert.equal((await agent('GET', '/api/my/properties')).status, 401); // signed out everywhere
  assert.equal((await anon('GET', '/api/properties?type=land')).body.total, before - 1); // listings hidden
  assert.equal((await anon('GET', `/api/agents/${agentId}`)).status, 404);
  await admin('POST', `/api/admin/users/${agentId}/suspend`, { suspended: false });
});

test('SPV investment: KYC gate, units, funding, payouts', async () => {
  const c = await admin('POST', '/api/admin/spvs', { title: 'Kano Terrace SPV', unit_price: 50000, total_units: 10, min_units: 2, projected_return_pct: 12, status: 'open' });
  const id = c.body.id;
  assert.equal((await buyer('POST', '/api/admin/spvs', { title: 'x', unit_price: 1, total_units: 1 })).status, 403);
  assert.equal((await buyer('POST', `/api/spvs/${id}/invest`, { units: 2, accept_risk: true })).status, 403); // not KYC verified
  const buyerId = db.prepare("SELECT id FROM users WHERE phone = '2348022222222'").get().id;
  await admin('POST', `/api/admin/users/${buyerId}/kyc`, { approve: true });
  assert.equal((await buyer('POST', `/api/spvs/${id}/invest`, { units: 1, accept_risk: true })).status, 400); // below minimum
  assert.equal((await buyer('POST', `/api/spvs/${id}/invest`, { units: 4 })).status, 400); // risk notice
  assert.equal((await buyer('POST', `/api/spvs/${id}/invest`, { units: 11, accept_risk: true })).status, 409);
  const pay = await buyer('POST', `/api/spvs/${id}/invest`, { units: 4, accept_risk: true });
  assert.equal((await anon('GET', `/api/spvs/${id}`)).body.sold_units, 0); // unpaid units are not counted
  await buyer('POST', `/api/payments/demo/${pay.body.reference}`);
  await buyer('POST', `/api/payments/demo/${pay.body.reference}`);
  let s = (await buyer('GET', `/api/spvs/${id}`)).body;
  assert.deepEqual([s.sold_units, s.raised, s.my_units, s.status], [4, 200000, 4, 'open']);
  assert.equal((await admin('PUT', `/api/admin/spvs/${id}`, { title: 'Kano Terrace SPV', unit_price: 60000, total_units: 10, status: 'open' })).status, 409);
  await admin('POST', `/api/admin/spvs/${id}/distribute`, { amount_per_unit: 1500, note: 'Q1 rent' });
  const mine = (await buyer('GET', '/api/my/investments')).body;
  assert.deepEqual([mine[0].units, mine[0].amount, mine[0].distributed], [4, 200000, 6000]);
  const rest = await buyer('POST', `/api/spvs/${id}/invest`, { units: 6, accept_risk: true });
  await buyer('POST', `/api/payments/demo/${rest.body.reference}`);
  s = (await anon('GET', `/api/spvs/${id}`)).body;
  assert.equal(s.status, 'funded');
  assert.equal((await buyer('POST', `/api/spvs/${id}/invest`, { units: 2, accept_risk: true })).status, 409);
});

test('customer experience: paid inspection, chat, saved search, receipts, reviews, credit, reminders', async () => {
  const experience = require('../server/experience');
  const cust = client();
  await login(agent, '08033333333'); // signed out by the suspension test
  await admin('PUT', '/api/admin/settings', { default_unlock_fee: 1000 }); // an earlier test made viewing free
  const me = await login(cust, '08055555555', { name: 'Chidi Buyer', ref: experience.refCode(db.prepare("SELECT id FROM users WHERE phone = '2348033333333'").get().id) });
  assert.equal((await agent('GET', '/api/my/referrals')).body.referred[0].name, 'Chidi');

  await cust('POST', '/api/saved-searches', { name: 'Kano land', query: { type: 'land', state: 'Kano', max: '9000000' } });
  const p = await agent('POST', '/api/properties', { title: 'Saved-search plot', price: 8000000, type: 'land', state: 'Kano', city: 'Kano', address: '9 Hidden Close', lat: 12.00234, lng: 8.59123, nearby: 'School, market' });
  const pid = p.body.id;
  await agent('POST', `/api/properties/${pid}/submit`);
  await admin('POST', `/api/admin/properties/${pid}/approve`);
  assert.ok((await cust('GET', '/api/notifications')).body.items.some((n) => n.title === 'New match: Kano land'));
  const teaser = (await cust('GET', `/api/properties/${pid}`)).body;
  assert.deepEqual([teaser.locked, teaser.lat, teaser.approx[0], teaser.nearby], [true, undefined, 12, 'School, market']); // exact pin hidden
  assert.equal((await cust('POST', `/api/properties/${pid}/favourite`)).body.fav, true);
  assert.equal((await cust('GET', '/api/my/favourites')).body.length, 1);

  assert.equal((await cust('POST', `/api/properties/${pid}/chat`)).status, 403); // locked listing: no chat
  const slot = new Date(Date.now() + 20 * 3600 * 1000); slot.setHours(10, 0, 0, 0); if (slot.getTime() < Date.now() + 3 * 3600 * 1000) slot.setDate(slot.getDate() + 1);
  const iso = new Date(slot.getTime() - slot.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  assert.equal((await cust('POST', `/api/properties/${pid}/inspections`, { slot: '2020-01-01T10:00' })).status, 400);
  const book = await cust('POST', `/api/properties/${pid}/inspections`, { slot: iso, note: 'Coming with my surveyor' });
  assert.match(book.body.url, /pay\/demo/);
  assert.equal((await agent('GET', '/api/my/inspections')).body.length, 0); // agent is not bothered until the fee is paid
  await cust('POST', `/api/payments/demo/${book.body.reference}`);
  const mineI = (await agent('GET', '/api/my/inspections')).body;
  assert.deepEqual([mineI[0].status, mineI[0].fee, mineI[0].role], ['confirmed', 3000, 'agent']);
  assert.equal((await cust('GET', `/api/properties/${pid}`)).body.address, '9 Hidden Close'); // paying to inspect unlocks details
  assert.equal((await buyer('POST', `/api/properties/${pid}/inspections`, { slot: iso })).status, 409); // slot taken
  assert.equal((await cust('POST', `/api/inspections/${mineI[0].id}/status`, { status: 'completed' })).status, 403);

  const th = (await cust('POST', `/api/properties/${pid}/chat`)).body.id;
  await cust('POST', `/api/threads/${th}/messages`, { body: 'Is the price negotiable?' });
  assert.equal((await buyer('GET', `/api/threads/${th}`)).status, 404); // private
  assert.equal((await agent('GET', '/api/my/threads')).body[0].unread, true);
  assert.equal((await agent('GET', `/api/threads/${th}`)).body.messages[0].body, 'Is the price negotiable?');
  assert.equal((await agent('GET', '/api/my/threads')).body[0].unread, false);

  db.prepare('UPDATE inspections SET slot = ? WHERE id = ?').run(iso, mineI[0].id);
  assert.equal(experience.remind().inspections, slot.getTime() - Date.now() <= 24 * 3600 * 1000 ? 1 : 0);
  await agent('POST', `/api/inspections/${mineI[0].id}/status`, { status: 'completed' });
  const agentId = mineI[0].agent_id;
  assert.equal((await buyer('POST', `/api/agents/${agentId}/reviews`, { property_id: pid, rating: 5 })).status, 403); // no transaction
  assert.equal((await cust('POST', `/api/agents/${agentId}/reviews`, { property_id: pid, rating: 4, comment: 'Punctual' })).status, 201);
  assert.equal((await cust('POST', `/api/agents/${agentId}/reviews`, { property_id: pid, rating: 1 })).status, 403); // once only
  assert.deepEqual([(await anon('GET', `/api/agents/${agentId}/reviews`)).body.avg, (await anon('GET', `/api/properties/${pid}`)).body.agent.rating], [4, 4]);

  const e = (await cust('POST', `/api/properties/${pid}/escrow`, {})).body;
  assert.equal(e.credit, 3000); // inspection fee credited to the purchase
  const pay = await cust('POST', `/api/escrows/${e.id}/pay`);
  assert.equal(db.prepare('SELECT amount FROM payments WHERE reference = ?').get(pay.body.reference).amount, 8000000 + 120000 - 3000);

  const tc = await cust('POST', `/api/properties/${pid}/title-check`);
  await cust('POST', `/api/payments/demo/${tc.body.reference}`);
  const tid = (await cust('GET', '/api/my/title-checks')).body[0].id;
  await admin('POST', `/api/admin/title-checks/${tid}/complete`, { result: 'Searched at the registry: title is clean, no encumbrance.' });
  assert.match((await cust('GET', '/api/my/title-checks')).body[0].result, /clean/);

  const pays = (await cust('GET', '/api/my/payments')).body;
  assert.deepEqual(pays.map((x) => x.label).sort(), ['Inspection fee', 'Title verification report']);
  const rc = await cust('GET', `/api/payments/${pays[0].reference}/receipt`);
  assert.match(rc.body, /PAID/);
  assert.equal((await buyer('GET', `/api/payments/${pays[0].reference}/receipt`)).status, 404);

  const form = new FormData(); form.append('title', 'Offer letter'); form.append('user_id', String(me.id));
  form.append('file', new Blob([await png(300, 300)], { type: 'image/png' }), 'offer.png');
  assert.equal((await admin('POST', '/api/documents', null, form)).status, 201);
  const doc = (await cust('GET', '/api/my/documents')).body[0];
  assert.equal(doc.title, 'Offer letter');
  assert.equal((await buyer('GET', `/api/documents/${doc.id}/file`)).status, 404);
  assert.equal((await cust('DELETE', `/api/documents/${doc.id}`)).status, 403); // company documents stay

  const sub = db.prepare("SELECT s.id FROM subscriptions s WHERE s.status = 'active'").get();
  db.prepare("UPDATE installments SET due_date = date('now', '+1 day') WHERE subscription_id = ? AND seq = 1").run(sub.id);
  assert.equal(experience.remind().instalments, 1);
  assert.equal(experience.remind().instalments, 0); // not nagged twice
  const desk = (await admin('GET', '/api/admin/desk')).body;
  assert.ok(desk.inspections.length >= 1 && desk.referrals.length === 1 && desk.fees.collected === 3000);
});

test('SPV unit resale between verified members', async () => {
  const s = db.prepare("SELECT id FROM spvs WHERE status = 'funded'").get().id; // buyer holds all 10 units
  assert.equal((await buyer('POST', `/api/spvs/${s}/market`, { units: 3, price_per_unit: 55000 })).status, 404); // off by default
  await admin('PUT', '/api/admin/settings', { secondary_market: '1' });
  assert.equal((await buyer('POST', `/api/spvs/${s}/market`, { units: 11, price_per_unit: 55000 })).status, 409);
  assert.equal((await buyer('POST', `/api/spvs/${s}/market`, { units: 3, price_per_unit: 55000 })).status, 201);
  assert.equal((await buyer('POST', `/api/spvs/${s}/market`, { units: 8, price_per_unit: 55000 })).status, 409); // 3 already on offer
  const l = (await agent('GET', `/api/spvs/${s}/market`)).body.listings[0];
  assert.equal((await buyer('POST', `/api/unit-listings/${l.id}/buy`, { accept_risk: true })).status, 400); // own units
  const pay = await agent('POST', `/api/unit-listings/${l.id}/buy`, { accept_risk: true }); // agent was KYC-approved earlier
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  await agent('POST', `/api/payments/demo/${pay.body.reference}`);
  assert.equal((await agent('GET', '/api/my/investments')).body[0].units, 3);
  assert.equal((await buyer('GET', '/api/my/investments')).body[0].units, 7);
  const spv = (await anon('GET', `/api/spvs/${s}`)).body;
  assert.deepEqual([spv.sold_units, spv.investors], [10, 2]); // total unchanged
});

test('email alongside WhatsApp; cron endpoint', async () => {
  assert.equal((await buyer('POST', '/api/me/email', { email: 'not-an-email' })).status, 400);
  const set = await buyer('POST', '/api/me/email', { email: 'Bala@Example.com' });
  assert.deepEqual([set.body.user.email, set.body.user.email_verified], ['bala@example.com', false]);
  assert.equal((await buyer('POST', '/api/me/email/verify', { code: '000000' })).status, 400);
  assert.equal((await buyer('POST', '/api/me/email/verify', { code: set.body.demo_code })).body.user.email_verified, true);
  const otp = await anon('POST', '/api/auth/request-otp', { phone: '08022222222' });
  assert.deepEqual(otp.body.channels, ['whatsapp', 'email']); // code goes to both
  assert.equal((await anon('POST', '/api/auth/request-otp', { phone: '08099998888' })).status, 429); // per-IP limit on code requests
  assert.equal((await anon('GET', '/api/cron?key=x')).status, 404); // disabled without CRON_KEY
  assert.equal(typeof app.start, 'function');
});

test('request fee is set by admin', async () => {
  await admin('PUT', '/api/admin/settings', { request_fee: 0 });
  const free = await buyer('POST', '/api/requests', { type: 'house', state: 'Kano', details: 'Free request' });
  assert.equal(free.body.url, undefined);
  assert.ok((await anon('GET', '/api/requests')).body.some((r) => r.details === 'Free request'));
  await admin('PUT', '/api/admin/settings', { request_fee: 3500 });
  assert.equal((await anon('GET', '/api/me')).body.config.request_fee, 3500);
  const paid = await buyer('POST', '/api/requests', { type: 'land', details: 'Paid request' });
  assert.equal(db.prepare('SELECT amount FROM payments WHERE reference = ?').get(paid.body.reference).amount, 3500);
  const adminReq = await admin('POST', '/api/requests', { type: 'land', details: 'Admin request' });
  assert.equal(adminReq.body.url, undefined); // admins are not charged
});

test('contact form forwards to the company email', async () => {
  const mail = require('../server/mail');
  const sent = []; const orig = mail.send; mail.send = async (...a) => { sent.push(a); return true; };
  await admin('PUT', '/api/admin/settings', { contact_email: 'info@dangaskerealestate.com.ng' });
  assert.equal((await anon('POST', '/api/reports', { kind: 'contact', name: 'Aisha', contact: '08031112222', message: 'I want to list my estate.' })).status, 201);
  mail.send = orig;
  assert.ok(sent.some(([to, subject]) => to === 'info@dangaskerealestate.com.ng' && /Aisha/.test(subject)));
});

test('inspection fee bands, land by distance, calendar slots', async () => {
  await admin('PUT', '/api/admin/settings', { default_unlock_fee: 0 });
  const fee = async (b) => { const p = await admin('POST', '/api/properties', { title: 'Fee test', ...b }); return (await admin('GET', `/api/properties/${p.body.id}`)).body.inspection_fee; };
  assert.equal((await anon('GET', '/api/properties/1')).body.locked, false); // view-details fee is gone
  assert.deepEqual([await fee({ purpose: 'rent', price: 1900000 }), await fee({ purpose: 'rent', price: 2000000 }), await fee({ purpose: 'shortlet', price: 500000 })], [3000, 5000, 3000]);
  assert.deepEqual([await fee({ purpose: 'sale', price: 4900000 }), await fee({ purpose: 'sale', price: 5000000 }), await fee({ purpose: 'sale', price: 47000000 }), await fee({ purpose: 'sale', price: 50000000 })], [3000, 5000, 5000, 10000]);
  assert.equal(await fee({ type: 'land', price: 3000000, city: 'Kano', state: 'Kano', lat: 12.0022, lng: 8.592 }), 3000); // in the city
  const far = await fee({ type: 'land', price: 3000000, city: 'Kano', state: 'Kano', lat: 12.2022, lng: 8.592 }); // about 22 km out
  assert.ok(far > 7000 && far < 8000, `far land fee ${far}`);
  assert.equal(await fee({ type: 'land', price: 3000000, city: 'Kano', distance_km: 500 }), 25000); // capped
  assert.equal(await fee({ type: 'land', price: 3000000, city: 'Nowhere' }), 3000); // no distance known: base fee
  await admin('PUT', '/api/admin/settings', { insp_rent_high: 7500 });
  assert.equal(await fee({ purpose: 'rent', price: 3000000 }), 7500); // admin can change a band
  await admin('PUT', '/api/admin/settings', { insp_rent_high: 5000 });

  const c = buyer;
  const p = await admin('POST', '/api/properties', { title: 'Slot house', price: 2500000, purpose: 'rent', state: 'Kano' });
  await admin('POST', `/api/properties/${p.body.id}/submit`);
  const day = new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10);
  const pay = await c('POST', `/api/properties/${p.body.id}/inspections`, { slot: `${day}T10:00` });
  assert.equal(db.prepare('SELECT amount FROM payments WHERE reference = ?').get(pay.body.reference).amount, 5000);
  assert.deepEqual((await anon('GET', `/api/properties/${p.body.id}/slots?date=${day}`)).body.booked, []); // unpaid does not block
  await c('POST', `/api/payments/demo/${pay.body.reference}`);
  assert.deepEqual((await anon('GET', `/api/properties/${p.body.id}/slots?date=${day}`)).body.booked, ['10:00']);
  const other = await admin('POST', '/api/properties', { title: 'Same agent, other house', price: 2500000, purpose: 'rent', state: 'Kano' });
  await admin('POST', `/api/properties/${other.body.id}/submit`);
  const c2 = agent;
  assert.equal((await c2('POST', `/api/properties/${other.body.id}/inspections`, { slot: `${day}T10:00` })).status, 409); // the agent is busy then
  assert.equal((await c2('POST', `/api/properties/${other.body.id}/inspections`, { slot: `${day}T11:00` })).status, 200);
  assert.equal((await anon('GET', '/api/properties/1/slots?date=nonsense')).status, 400);
});

test('services directory lists only verified providers, by category', async () => {
  db.prepare("UPDATE users SET account_type = 'service', service_category = 'legal' WHERE phone = '2348033333333'").run();
  const rows = (await anon('GET', '/api/agents?type=service&category=legal')).body;
  assert.equal(rows.length, 1);
  assert.match(rows[0].phone, /^234/); // providers are meant to be contacted
  assert.equal((await anon('GET', '/api/agents?type=service&category=surveying')).body.length, 0);
  db.prepare("UPDATE users SET verified = 0 WHERE phone = '2348033333333'").run();
  assert.equal((await anon('GET', '/api/agents?type=service')).body.length, 0); // unverified providers stay hidden
  db.prepare("UPDATE users SET verified = 1, account_type = 'agency' WHERE phone = '2348033333333'").run();
});
