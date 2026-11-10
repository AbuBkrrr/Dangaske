// Payments (Paystack) for: pay-to-view unlocks, escrow funding and easy-buy instalments.
// Without PAYSTACK_SECRET_KEY the site runs in demo mode: a "simulate payment" page stands in
// for the checkout so every flow can be tried end to end. Demo mode is disabled in production.
const crypto = require('crypto');
const config = require('./config');
const { db, getSetting } = require('./db');
const { HttpError } = require('./auth');
const listings = require('./listings');
const push = require('./push');

const DEMO = !config.PAYMENTS_LIVE;

async function paystack(method, path, body) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.status) throw new HttpError(502, `Payment provider error: ${json.message || res.status}`);
  return json.data;
}

/** Start a payment. Returns { reference, url } - the browser is sent to url. */
async function start(user, purpose, targetId, amount) {
  if (!(amount > 0)) throw new HttpError(400, 'Nothing to pay.');
  if (DEMO && config.PRODUCTION) throw new HttpError(503, 'Payments are not configured yet. Please contact support.');
  const reference = `DG-${purpose.slice(0, 3).toUpperCase()}-${crypto.randomBytes(9).toString('hex')}`;
  db.prepare('INSERT INTO payments(reference, user_id, purpose, target_id, amount, provider) VALUES(?,?,?,?,?,?)')
    .run(reference, user.id, purpose, targetId, amount, DEMO ? 'demo' : 'paystack');
  if (DEMO) return { reference, url: `/pay/demo?reference=${reference}` };
  const data = await paystack('POST', '/transaction/initialize', {
    email: `${user.phone}@members.${new URL(config.BASE_URL).hostname.replace(/^localhost$/, 'dangida.local')}`,
    amount: amount * 100, // kobo
    currency: 'NGN',
    reference,
    callback_url: `${config.BASE_URL}/pay/return`,
    metadata: { purpose, target_id: targetId, phone: user.phone },
  });
  return { reference, url: data.authorization_url };
}

const escrowEvent = (escrowId, actorId, event, note = '') =>
  db.prepare('INSERT INTO escrow_events(escrow_id, actor_id, event, note) VALUES(?,?,?,?)').run(escrowId, actorId, event, note);

/** Apply a successful payment exactly once. Returns where to send the payer next. */
function fulfil(payment) {
  const after = [];
  const result = db.transaction(() => {
    const fresh = db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id);
    const already = fresh.status === 'paid';
    if (!already) db.prepare("UPDATE payments SET status = 'paid', paid_at = datetime('now') WHERE id = ?").run(fresh.id);

    if (fresh.purpose === 'unlock') {
      if (!already) db.prepare('INSERT OR IGNORE INTO unlocks(user_id, property_id, payment_id) VALUES(?,?,?)').run(fresh.user_id, fresh.target_id, fresh.id);
      return { redirect: `/p/${fresh.target_id}`, message: 'Full details unlocked.' };
    }

    if (fresh.purpose === 'escrow') {
      const e = db.prepare('SELECT * FROM escrows WHERE id = ?').get(fresh.target_id);
      if (!already && e && e.status === 'awaiting_payment') {
        db.prepare("UPDATE escrows SET status = 'funded', updated_at = datetime('now') WHERE id = ?").run(e.id);
        escrowEvent(e.id, fresh.user_id, 'funded', `Payment ${fresh.reference}`);
        const p = listings.getProperty(e.property_id);
        after.push(() => {
          push.notify({ userId: e.seller_id, title: 'Escrow funded', body: `A buyer has paid into escrow for ${p.title}.`, url: '/dashboard' });
          push.notifyAdmins({ title: 'Escrow funded', body: `${listings.naira(e.amount)} held for ${p.title}`, url: '/admin' });
        });
      }
      return { redirect: '/dashboard?tab=escrow', message: 'Escrow funded. Your money is held safely until you confirm.' };
    }

    if (fresh.purpose === 'installment') {
      const inst = db.prepare('SELECT * FROM installments WHERE id = ?').get(fresh.target_id);
      if (!already && inst && inst.status !== 'paid') {
        db.prepare("UPDATE installments SET status = 'paid', paid_at = datetime('now') WHERE id = ?").run(inst.id);
        const left = db.prepare("SELECT COUNT(*) AS n FROM installments WHERE subscription_id = ? AND status != 'paid'").get(inst.subscription_id).n;
        db.prepare('UPDATE subscriptions SET status = ? WHERE id = ?').run(left === 0 ? 'completed' : 'active', inst.subscription_id);
        const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(inst.subscription_id);
        const p = listings.getProperty(sub.property_id);
        after.push(() => {
          push.notifyAdmins({
            title: left === 0 ? 'Easy-buy plan completed' : inst.seq === 0 ? 'Easy-buy deposit paid' : 'Easy-buy instalment paid',
            body: `${listings.naira(inst.amount)} for ${p.title}`, url: '/admin',
          });
        });
      }
      return { redirect: '/dashboard?tab=plans', message: 'Payment received. Thank you!' };
    }
    return { redirect: '/dashboard', message: 'Payment received.' };
  })();
  for (const fn of after) fn();
  return result;
}

/** Confirm a payment with the provider (used by the return page and the webhook). */
async function verify(reference) {
  const payment = db.prepare('SELECT * FROM payments WHERE reference = ?').get(String(reference || ''));
  if (!payment) throw new HttpError(404, 'Payment not found.');
  if (payment.status === 'paid') return { paid: true, ...fulfil(payment) };
  if (payment.provider !== 'paystack') return { paid: false };
  const data = await paystack('GET', `/transaction/verify/${encodeURIComponent(payment.reference)}`);
  if (data.status === 'success' && data.amount >= payment.amount * 100 && data.currency === 'NGN') {
    return { paid: true, ...fulfil(payment) };
  }
  if (data.status === 'failed' || data.status === 'abandoned') db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(payment.id);
  return { paid: false, status: data.status };
}

/** Demo checkout confirmation - only the payer, only when no payment provider is configured. */
function demoConfirm(user, reference) {
  if (!DEMO || config.PRODUCTION) throw new HttpError(404, 'Not available.');
  const payment = db.prepare("SELECT * FROM payments WHERE reference = ? AND provider = 'demo'").get(String(reference || ''));
  if (!payment || payment.user_id !== user.id) throw new HttpError(404, 'Payment not found.');
  return { paid: true, ...fulfil(payment) };
}

function demoInfo(user, reference) {
  if (!DEMO || config.PRODUCTION) throw new HttpError(404, 'Not available.');
  const payment = db.prepare("SELECT reference, amount, purpose, status, user_id FROM payments WHERE reference = ? AND provider = 'demo'").get(String(reference || ''));
  if (!payment || payment.user_id !== user.id) throw new HttpError(404, 'Payment not found.');
  return payment;
}

/** Paystack webhook: verify the signature, then re-verify the transaction with the API. */
async function webhook(rawBody, signature) {
  if (!config.PAYMENTS_LIVE) return false;
  const expected = crypto.createHmac('sha512', config.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  const given = String(signature || '');
  if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return false;
  const event = JSON.parse(rawBody.toString('utf8'));
  if (event.event === 'charge.success' && event.data && event.data.reference) {
    await verify(event.data.reference).catch((e) => console.error('Webhook verify failed:', e.message));
  }
  return true;
}

// ---------- Easy-buy plans ----------

function quote(price, plan) {
  const total = Math.round(price * (1 + plan.markup_pct / 100));
  const deposit = Math.round((total * plan.deposit_pct) / 100);
  const monthly = Math.ceil((total - deposit) / plan.months);
  return { plan_id: plan.id, name: plan.name, months: plan.months, deposit_pct: plan.deposit_pct, markup_pct: plan.markup_pct, total, deposit, monthly };
}

function subscribe(user, property, planId) {
  if (property.status !== 'active') throw new HttpError(409, 'This property is no longer available.');
  if (!property.easy_buy) throw new HttpError(400, 'Easy-buy is not available on this property.');
  const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').get(Number(planId) || 0);
  if (!plan) throw new HttpError(404, 'Plan not found.');
  const open = db.prepare("SELECT id FROM subscriptions WHERE user_id = ? AND property_id = ? AND status IN ('pending','active')").get(user.id, property.id);
  if (open) throw new HttpError(409, 'You already have a plan on this property. See your dashboard.');
  const q = quote(property.price, plan);
  return db.transaction(() => {
    const id = db
      .prepare('INSERT INTO subscriptions(user_id, property_id, plan_id, plan_name, total) VALUES(?,?,?,?,?)')
      .run(user.id, property.id, plan.id, plan.name, q.total).lastInsertRowid;
    const ins = db.prepare("INSERT INTO installments(subscription_id, seq, due_date, amount) VALUES(?,?,date('now', ?),?)");
    ins.run(id, 0, '+0 months', q.deposit);
    let remaining = q.total - q.deposit;
    for (let i = 1; i <= plan.months; i++) {
      const amount = i === plan.months ? remaining : Math.min(q.monthly, remaining);
      remaining -= amount;
      ins.run(id, i, `+${i} months`, amount);
    }
    return id;
  })();
}

function subscriptionsFor(where, ...args) {
  const subs = db
    .prepare(
      `SELECT s.*, p.title AS property_title, u.name AS user_name, u.phone AS user_phone
         FROM subscriptions s JOIN properties p ON p.id = s.property_id JOIN users u ON u.id = s.user_id
        WHERE ${where} ORDER BY s.id DESC LIMIT 100`
    )
    .all(...args);
  for (const s of subs) {
    s.installments = db.prepare('SELECT id, seq, due_date, amount, status, paid_at FROM installments WHERE subscription_id = ? ORDER BY seq').all(s.id);
    s.paid = s.installments.filter((i) => i.status === 'paid').reduce((a, i) => a + i.amount, 0);
  }
  return subs;
}

async function payInstallment(user, installmentId) {
  const inst = db
    .prepare('SELECT i.*, s.user_id, s.status AS sub_status FROM installments i JOIN subscriptions s ON s.id = i.subscription_id WHERE i.id = ?')
    .get(Number(installmentId) || 0);
  if (!inst || inst.user_id !== user.id) throw new HttpError(404, 'Instalment not found.');
  if (inst.status === 'paid') throw new HttpError(409, 'This instalment is already paid.');
  if (inst.sub_status === 'cancelled') throw new HttpError(409, 'This plan was cancelled.');
  const earlier = db.prepare("SELECT 1 FROM installments WHERE subscription_id = ? AND seq < ? AND status != 'paid'").get(inst.subscription_id, inst.seq);
  if (earlier) throw new HttpError(409, 'Please pay earlier instalments first.');
  return start(user, 'installment', inst.id, inst.amount);
}

// ---------- Escrow ----------

function createEscrow(user, property, { amount, note }) {
  if (property.status !== 'active') throw new HttpError(409, 'This property is no longer available.');
  if (property.owner_id === user.id) throw new HttpError(400, 'You cannot open escrow on your own listing.');
  const held = db.prepare("SELECT 1 FROM escrows WHERE property_id = ? AND status IN ('funded','disputed')").get(property.id);
  if (held) throw new HttpError(409, 'Another buyer already has this property in escrow.');
  const mine = db.prepare("SELECT id FROM escrows WHERE property_id = ? AND buyer_id = ? AND status = 'awaiting_payment'").get(property.id, user.id);
  if (mine) return mine.id;
  const amt = listings.int(amount) || property.price;
  const fee = Math.round((amt * Number(getSetting('escrow_fee_pct') || 0)) / 100);
  const id = db
    .prepare('INSERT INTO escrows(property_id, buyer_id, seller_id, amount, fee, note) VALUES(?,?,?,?,?,?)')
    .run(property.id, user.id, property.owner_id, amt, fee, listings.str(note, 500)).lastInsertRowid;
  escrowEvent(id, user.id, 'opened', listings.str(note, 500));
  push.notify({ userId: property.owner_id, title: 'Escrow opened', body: `A buyer opened escrow for ${property.title} (${listings.naira(amt)}).`, url: '/dashboard' });
  return id;
}

function escrowsFor(where, ...args) {
  const rows = db
    .prepare(
      `SELECT e.*, p.title AS property_title, b.name AS buyer_name, b.phone AS buyer_phone, s.name AS seller_name, s.phone AS seller_phone
         FROM escrows e JOIN properties p ON p.id = e.property_id JOIN users b ON b.id = e.buyer_id JOIN users s ON s.id = e.seller_id
        WHERE ${where} ORDER BY e.id DESC LIMIT 100`
    )
    .all(...args);
  for (const e of rows) e.events = db.prepare('SELECT event, note, created_at FROM escrow_events WHERE escrow_id = ? ORDER BY id').all(e.id);
  return rows;
}

function mustEscrow(id) {
  const e = db.prepare('SELECT * FROM escrows WHERE id = ?').get(Number(id) || 0);
  if (!e) throw new HttpError(404, 'Escrow not found.');
  return e;
}

async function payEscrow(user, id) {
  const e = mustEscrow(id);
  if (e.buyer_id !== user.id) throw new HttpError(404, 'Escrow not found.');
  if (e.status !== 'awaiting_payment') throw new HttpError(409, 'This escrow is not awaiting payment.');
  const held = db.prepare("SELECT 1 FROM escrows WHERE property_id = ? AND status IN ('funded','disputed')").get(e.property_id);
  if (held) throw new HttpError(409, 'Another buyer already has this property in escrow.');
  return start(user, 'escrow', e.id, e.amount + e.fee);
}

const setEscrow = (id, status) => db.prepare("UPDATE escrows SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);

/** Buyer confirms (or admin settles a dispute): funds go to the seller and the property is marked sold. */
function releaseEscrow(user, id) {
  const e = mustEscrow(id);
  const admin = user.role === 'admin';
  if (!admin && e.buyer_id !== user.id) throw new HttpError(404, 'Escrow not found.');
  if (!(e.status === 'funded' || (admin && e.status === 'disputed'))) throw new HttpError(409, 'This escrow cannot be released right now.');
  setEscrow(e.id, 'released');
  escrowEvent(e.id, user.id, 'released', admin && e.buyer_id !== user.id ? 'Released by admin' : 'Buyer confirmed handover');
  const p = listings.getProperty(e.property_id);
  listings.markSold(p);
  push.notify({ userId: e.seller_id, title: 'Escrow released', body: `Funds for ${p.title} have been released to you.`, url: '/dashboard' });
  push.notify({ userId: e.buyer_id, title: 'Purchase complete', body: `Escrow for ${p.title} is complete. Congratulations!`, url: '/dashboard' });
  push.notifyAdmins({ title: 'Escrow released - pay out seller', body: `${listings.naira(e.amount)} for ${p.title}`, url: '/admin' });
}

function disputeEscrow(user, id, note) {
  const e = mustEscrow(id);
  if (![e.buyer_id, e.seller_id].includes(user.id)) throw new HttpError(404, 'Escrow not found.');
  if (e.status !== 'funded') throw new HttpError(409, 'Only a funded escrow can be disputed.');
  setEscrow(e.id, 'disputed');
  escrowEvent(e.id, user.id, 'disputed', listings.str(note, 500));
  const other = user.id === e.buyer_id ? e.seller_id : e.buyer_id;
  push.notify({ userId: other, title: 'Escrow disputed', body: 'The other party raised a dispute. Our team will contact you.', url: '/dashboard' });
  push.notifyAdmins({ title: 'Escrow dispute', body: `Escrow #${e.id} needs review`, url: '/admin' });
}

function refundEscrow(admin, id, note) {
  const e = mustEscrow(id);
  if (!['funded', 'disputed'].includes(e.status)) throw new HttpError(409, 'This escrow cannot be refunded.');
  setEscrow(e.id, 'refunded');
  escrowEvent(e.id, admin.id, 'refunded', listings.str(note, 500));
  push.notify({ userId: e.buyer_id, title: 'Escrow refunded', body: 'Your escrow payment is being refunded.', url: '/dashboard' });
  push.notify({ userId: e.seller_id, title: 'Escrow refunded', body: 'The escrow was refunded to the buyer.', url: '/dashboard' });
}

function cancelEscrow(user, id) {
  const e = mustEscrow(id);
  if (e.buyer_id !== user.id && user.role !== 'admin') throw new HttpError(404, 'Escrow not found.');
  if (e.status !== 'awaiting_payment') throw new HttpError(409, 'Only unpaid escrows can be cancelled.');
  setEscrow(e.id, 'cancelled');
  escrowEvent(e.id, user.id, 'cancelled');
}

module.exports = {
  DEMO, start, verify, demoConfirm, demoInfo, webhook,
  quote, subscribe, subscriptionsFor, payInstallment,
  createEscrow, escrowsFor, payEscrow, releaseEscrow, disputeEscrow, refundEscrow, cancelEscrow,
};
