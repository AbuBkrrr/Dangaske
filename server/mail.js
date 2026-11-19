// Email (SMTP): codes, receipts and alerts for members who add a confirmed email address.
// Without SMTP settings, messages are logged instead of sent.
const config = require('./config');

let transport = null;
if (config.SMTP_HOST) {
  transport = require('nodemailer').createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });
}
const LIVE = Boolean(transport);
const valid = (email) => /^[^\s@<>"]{1,64}@[^\s@<>"]{1,180}\.[a-z]{2,}$/i.test(String(email || ''));
const footer = (text) => `${text}\n\n—\n${config.SITE_NAME}\n${config.COMPANY}\n${config.BASE_URL}`;

/** Send and report the outcome, including the mail server's own error. Never throws. */
async function deliver(to, subject, text) {
  if (!valid(to)) return { ok: false, error: 'That email address is not valid.' };
  if (!LIVE) {
    console.log(`[email:demo] -> ${to}: ${subject} | ${text.split('\n')[0]}`);
    return { ok: true, demo: true };
  }
  try {
    await transport.sendMail({ from: `"${config.SITE_NAME}" <${config.MAIL_FROM}>`, to, subject, text: footer(text) });
    return { ok: true };
  } catch (e) {
    console.error('Email failed:', e.message);
    return { ok: false, error: e.message };
  }
}

async function send(to, subject, text) {
  return (await deliver(to, subject, text)).ok;
}

module.exports = { send, deliver, valid, LIVE };
