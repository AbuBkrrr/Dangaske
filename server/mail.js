// Email (SMTP) used alongside WhatsApp. Without SMTP settings, messages are logged instead of sent.
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

/** Send a plain-text email. Never throws: email is a secondary channel. Resolves to true when sent. */
async function send(to, subject, text) {
  if (!valid(to)) return false;
  const body = `${text}\n\n—\n${config.SITE_NAME}\n${config.COMPANY}\n${config.BASE_URL}`;
  if (!LIVE) {
    console.log(`[email:demo] -> ${to}: ${subject} | ${text.split('\n')[0]}`);
    return true;
  }
  try {
    await transport.sendMail({ from: `"${config.SITE_NAME}" <${config.MAIL_FROM}>`, to, subject, text: body });
    return true;
  } catch (e) {
    console.error('Email failed:', e.message);
    return false;
  }
}

module.exports = { send, valid, LIVE };
