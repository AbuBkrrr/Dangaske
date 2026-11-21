// PayScrow marketplace escrow (https://payscrow.net): holds a buyer's payment for a property purchase until handover.
// Active when PAYSCROW_API_KEY is set; every other payment on the site still goes by bank transfer.
const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const { db, addColumn, getSetting } = require('./db');
const { HttpError } = require('./auth');
const push = require('./push');

for (const c of ['ps_number', 'ps_ref', 'ps_guid', 'ps_link', 'ps_review_due', 'ps_fulfilled_at']) addColumn('escrows', c, "TEXT NOT NULL DEFAULT ''");
db.exec('CREATE TABLE IF NOT EXISTS payscrow_events (id TEXT PRIMARY KEY, at INTEGER NOT NULL)');

const enabled = () => Boolean(config.PAYSCROW_API_KEY);
const lazy = { payments: () => require('./payments'), listings: () => require('./listings') };
const iso = (v) => String(v || '').replace('T', ' ').replace('Z', '').slice(0, 19);
const ngPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return /^234\d{10}$/.test(d) ? '0' + d.slice(3) : null; };
const escrowEvent = (id, event, note = '') => db.prepare('INSERT INTO escrow_events(escrow_id, actor_id, event, note) VALUES(?,?,?,?)').run(id, null, event, note);

async function call(method, path, body) {
  const res = await fetch(`${config.PAYSCROW_BASE_URL}${path}`, {
    method,
    headers: { BrokerApiKey: config.PAYSCROW_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* plain-text error */ }
  if (!res.ok || (json && (json.success === false || json.isSuccessful === false))) {
    const msg = (json && (json.message || (json.errors && json.errors[0]))) || text.slice(0, 200) || `HTTP ${res.status}`;
    console.error('PayScrow', method, path, res.status, msg);
    if (res.status === 401) throw new HttpError(502, 'The escrow provider rejected our credentials. Please contact us.');
    if (res.status >= 500) throw new HttpError(502, 'The escrow provider is not responding. Please try again shortly.');
    throw new HttpError(res.status === 409 ? 409 : 400, `Escrow provider: ${msg}`);
  }
  return json && json.data !== undefined && json.data !== null ? json.data : json;
}

/** Create the escrow transaction and get the page where the buyer pays. */
async function startTransaction({ escrow, property, buyer, seller, amount }) {
  const chargePct = Math.min(100, Math.max(0, Number(getSetting('payscrow_merchant_charge_pct')) || 0));
  const merchantEmail = seller.email_verified && seller.email ? seller.email : seller.role === 'admin' ? getSetting('contact_email') : '';
  if (!buyer.email || !buyer.email_verified) throw new HttpError(400, 'Please add and confirm your email address (Dashboard → Overview) before paying through escrow. The escrow provider sends your payment and release notices there.');
  if (!merchantEmail) throw new HttpError(409, 'The seller has no confirmed email address yet, so escrow cannot start for this listing. Please contact us.');
  if (merchantEmail.toLowerCase() === buyer.email.toLowerCase()) throw new HttpError(400, 'The buyer and the seller must use different email addresses.');
  const phone = ngPhone(buyer.phone);
  if (!phone) throw new HttpError(400, 'Escrow needs a Nigerian phone number (like 0803…) on your account.');
  const reference = `DG-ESC-${escrow.id}-${crypto.randomBytes(3).toString('hex')}`;
  const body = {
    transactionReference: reference,
    merchantEmailAddress: merchantEmail,
    merchantPhoneNo: ngPhone(seller.phone) || undefined,
    merchantName: String(seller.company || seller.name || config.SITE_NAME).slice(0, 300),
    customerEmailAddress: buyer.email,
    customerPhoneNo: phone,
    customerName: String(buyer.name || 'Customer').padEnd(2, ' ').slice(0, 300),
    currencyCode: 'NGN',
    merchantChargePercentage: chargePct,
    returnUrl: `${config.BASE_URL}/dashboard?tab=escrow`,
    webhookNotificationUrl: config.BASE_URL.startsWith('https://') ? `${config.BASE_URL}/api/payscrow/webhook` : undefined,
    items: [{ name: String(property.title).slice(0, 300), description: `Property #${property.id} · ${[property.area, property.city, property.state].filter(Boolean).join(', ')}`.slice(0, 4000), quantity: 1, price: amount }],
  };
  const d = await call('POST', '/api/v3/marketplace/transactions/start', body);
  if (!d.transactionNumber || !d.paymentLink) throw new HttpError(502, 'The escrow provider returned an unexpected reply. Please try again.');
  return { reference, number: d.transactionNumber, link: d.paymentLink, total: Number(d.totalPayable) || amount };
}

const status = (number) => call('GET', `/api/v3/marketplace/transactions/${encodeURIComponent(number)}/status`);
const applyCode = (guid, code) => call('POST', '/api/v3/escrow/escrowtransactions/applycode', { transactionId: guid, code });
const submitDelivery = (number, notes, links) => call('POST', `/api/v3/marketplace/transactions/${encodeURIComponent(number)}/fulfilment`, { notes, evidenceLinks: links });
const raiseDispute = (number, requestedBy, complaint) => call('POST', `/api/v3/marketplace/transactions/${encodeURIComponent(number)}/broker/raise-dispute`, { requestedBy, complaint });

// ---------- keep our escrow in step with PayScrow ----------

/** A payment confirmed by PayScrow funds the escrow (the same path every other payment takes). */
function ensureFunded(e) {
  if (e.status !== 'awaiting_payment') return;
  const pay = db.prepare("SELECT * FROM payments WHERE reference = ? AND provider = 'payscrow'").get(e.ps_ref);
  if (pay && pay.status !== 'paid') lazy.payments().fulfil(pay);
}

/** Pull the current state from PayScrow (used when a webhook is late or missed). */
async function sync(e) {
  if (!enabled() || !e.ps_number) return;
  let s;
  try { s = await status(e.ps_number); } catch { return; }
  const pay = lazy.payments();
  const fresh = () => db.prepare('SELECT * FROM escrows WHERE id = ?').get(e.id);
  const st = String(s.status || '');
  if (s.fulfilmentReview && s.fulfilmentReview.reviewDueUtc) db.prepare('UPDATE escrows SET ps_review_due = ? WHERE id = ?').run(iso(s.fulfilmentReview.reviewDueUtc), e.id);
  if (st === 'Completed' || st === 'Finalized') { ensureFunded(fresh()); pay.completeRelease(fresh(), null, 'PayScrow reports the funds were released'); return; }
  if (st === 'Terminated') {
    const cur = fresh();
    if (cur.status === 'awaiting_payment') { db.prepare("UPDATE escrows SET status = 'cancelled' WHERE id = ?").run(e.id); escrowEvent(e.id, 'cancelled', 'Cancelled at PayScrow'); }
    else pay.completeRefund(cur, null, 'PayScrow terminated the transaction and refunded the buyer');
    return;
  }
  if (s.inEscrow) ensureFunded(fresh());
  if (s.inDispute && fresh().status === 'funded') { db.prepare("UPDATE escrows SET status = 'disputed' WHERE id = ?").run(e.id); escrowEvent(e.id, 'disputed', 'Dispute opened at PayScrow'); }
}

function handleEvent(p) {
  const e = db.prepare('SELECT * FROM escrows WHERE (ps_ref != \'\' AND ps_ref = ?) OR (ps_number != \'\' AND ps_number = ?)').get(String(p.externalReference || ''), String(p.transactionNumber || ''));
  if (!e) return;
  const pay = lazy.payments();
  const fresh = () => db.prepare('SELECT * FROM escrows WHERE id = ?').get(e.id);
  const tell = (userId, title, body) => push.notify({ userId, title, body, url: '/dashboard?tab=escrow' });
  if (!p.event && p.paymentStatus === 'Paid') { // transaction paid
    if (p.transactionId) db.prepare('UPDATE escrows SET ps_guid = ? WHERE id = ?').run(String(p.transactionId), e.id);
    ensureFunded(fresh());
    return;
  }
  ensureFunded(fresh()); // any later event means the payment went through
  switch (p.event) {
    case 'transaction.fulfilment_submitted':
      escrowEvent(e.id, 'delivery details submitted');
      tell(e.buyer_id, 'Handover reported', 'The seller says the handover is complete. Check your email from PayScrow to approve or raise a dispute.');
      break;
    case 'transaction.review_started':
      db.prepare('UPDATE escrows SET ps_review_due = ? WHERE id = ?').run(iso(p.reviewDueUtc), e.id);
      escrowEvent(e.id, 'review period started', `Ends ${iso(p.reviewDueUtc)} UTC`);
      tell(e.buyer_id, 'Review period started', `Approve or dispute before ${iso(p.reviewDueUtc)} UTC, or the funds may be released automatically.`);
      break;
    case 'transaction.review_held':
    case 'transaction.review_cancelled':
      escrowEvent(e.id, p.event.replace('transaction.', '').replace('_', ' '));
      break;
    case 'transaction.release_authorized':
      pay.completeRelease(fresh(), null, 'Released through PayScrow review');
      break;
    case 'transaction.inactivity_warning':
      tell(e.seller_id, 'Action needed', 'Submit delivery details soon, or the buyer may be refunded.');
      break;
    case 'transaction.inactivity_refunded':
      pay.completeRefund(fresh(), null, 'PayScrow refunded the buyer (no delivery details were submitted)');
      break;
    case 'dispute.status_changed': {
      const stage = String(p.disputeStage || '');
      if (stage === 'Resolved') {
        const t = String(p.resolutionType || '');
        if (t === 'Refund') pay.completeRefund(fresh(), null, `Dispute ${p.disputeReference}: refunded to the buyer`);
        else if (t === 'Close') pay.completeRelease(fresh(), null, `Dispute ${p.disputeReference}: closed, funds go to the seller`);
        else {
          db.prepare("UPDATE escrows SET status = 'split' WHERE id = ?").run(e.id);
          escrowEvent(e.id, 'dispute resolved: split', `${p.disputeReference}: buyer ${p.complainantAmount ?? '?'} / seller ${p.respondantAmount ?? '?'}`);
          for (const u of [e.buyer_id, e.seller_id]) tell(u, 'Dispute resolved', 'The funds were divided between you. See PayScrow for the amounts.');
          push.notifyAdmins({ title: 'Escrow dispute split', body: `Escrow #${e.id} (${p.disputeReference})`, url: '/admin?tab=escrow' });
        }
      } else {
        db.prepare("UPDATE escrows SET status = 'disputed' WHERE id = ? AND status IN ('funded','disputed')").run(e.id);
        escrowEvent(e.id, `dispute: ${stage}`, p.disputeReference || '');
        if (stage === 'NegotiationOpen' || stage === 'Reopened') for (const u of [e.buyer_id, e.seller_id]) tell(u, 'Escrow dispute', `Dispute ${p.disputeReference || ''} is open at PayScrow. Funds stay on hold until it is resolved.`);
      }
      break;
    }
    default:
  }
}

function verifySignature(req) {
  const secret = config.PAYSCROW_WEBHOOK_SECRET;
  const ts = req.get('x-payscrow-timestamp'), sig = req.get('x-payscrow-signature');
  if (!secret || !ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${req.rawBody || ''}`).digest('hex');
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

const router = express.Router();
router.post('/payscrow/webhook', (req, res) => {
  if (!verifySignature(req)) return res.sendStatus(401);
  const id = String(req.get('x-payscrow-delivery-id') || (req.body && req.body.eventId) || '');
  if (id && db.prepare('INSERT OR IGNORE INTO payscrow_events(id, at) VALUES(?,?)').run(id, Date.now()).changes === 0) return res.json({ received: true, duplicate: true });
  try {
    handleEvent(req.body || {});
  } catch (err) {
    console.error('PayScrow webhook failed:', err);
    if (id) db.prepare('DELETE FROM payscrow_events WHERE id = ?').run(id); // let PayScrow retry
    return res.sendStatus(500);
  }
  res.json({ received: true });
});

module.exports = { enabled, startTransaction, status, applyCode, submitDelivery, raiseDispute, sync, router };
