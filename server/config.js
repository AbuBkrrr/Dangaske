const path = require('path');
const fs = require('fs');

try {
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
} catch (e) {
  console.warn('Could not load .env:', e.message);
}

const env = process.env;
const digits = (s) => String(s || '').replace(/\D/g, '');

const config = {
  PORT: Number(env.PORT) || 3000,
  BASE_URL: (env.BASE_URL || `http://localhost:${Number(env.PORT) || 3000}`).replace(/\/$/, ''),
  SITE_NAME: env.SITE_NAME || 'Dangaske Real Estate',
  COMPANY: env.COMPANY_NAME || 'Dangaske Real Estate',
  RC_NUMBER: env.RC_NUMBER || '8511141',
  SESSION_SECRET: env.SESSION_SECRET || 'dev-secret-change-me',
  DATA_DIR: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
  PRODUCTION: env.NODE_ENV === 'production',
  DEFAULT_COUNTRY_CODE: digits(env.DEFAULT_COUNTRY_CODE) || '234',
  ADMIN_PHONES: (env.ADMIN_PHONES || '').split(',').map(digits).filter(Boolean),

  WHATSAPP_TOKEN: env.WHATSAPP_TOKEN || '',
  WHATSAPP_PHONE_ID: env.WHATSAPP_PHONE_ID || '',
  WHATSAPP_VERIFY_TOKEN: env.WHATSAPP_VERIFY_TOKEN || '',
  WHATSAPP_APP_SECRET: env.WHATSAPP_APP_SECRET || '',
  WHATSAPP_OTP_TEMPLATE: env.WHATSAPP_OTP_TEMPLATE || '',
  WHATSAPP_OTP_TEMPLATE_LANG: env.WHATSAPP_OTP_TEMPLATE_LANG || 'en',

  PAYSTACK_SECRET_KEY: env.PAYSTACK_SECRET_KEY || '',

  VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY || '',
  VAPID_SUBJECT: env.VAPID_SUBJECT || 'mailto:admin@example.com',

  SMTP_HOST: env.SMTP_HOST || '',
  SMTP_PORT: Number(env.SMTP_PORT) || 465,
  SMTP_USER: env.SMTP_USER || '',
  SMTP_PASS: env.SMTP_PASS || '',
  MAIL_FROM: env.MAIL_FROM || env.SMTP_USER || 'no-reply@localhost',
  // Secret for the hourly reminder URL called by the host's cron job
  CRON_KEY: env.CRON_KEY || '',

  PAYSCROW_API_KEY: env.PAYSCROW_API_KEY || '',
  PAYSCROW_BASE_URL: (env.PAYSCROW_BASE_URL || 'https://api.payscrow.net').replace(/\/$/, ''),
  PAYSCROW_WEBHOOK_SECRET: env.PAYSCROW_WEBHOOK_SECRET || '',

  ANDROID_PACKAGE: env.ANDROID_PACKAGE || '',
  ANDROID_SHA256: (env.ANDROID_SHA256 || '').split(',').map((x) => x.trim()).filter(Boolean),

  FB_PAGE_ID: env.FB_PAGE_ID || '',
  FB_PAGE_TOKEN: env.FB_PAGE_TOKEN || '',
  TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID || '',
};

config.MEDIA_DIR = path.join(config.DATA_DIR, 'media');
config.TMP_DIR = path.join(config.DATA_DIR, 'tmp');
config.WHATSAPP_LIVE = Boolean(config.WHATSAPP_TOKEN && config.WHATSAPP_PHONE_ID);
config.PAYMENTS_LIVE = Boolean(config.PAYSTACK_SECRET_KEY);
// Private test servers only: lets the simulated checkout work with NODE_ENV=production. Also marks the site noindex.
config.TEST_MODE = process.env.ALLOW_DEMO_PAYMENTS === '1';
config.DEMO_PAYMENTS_OK = !config.PRODUCTION || config.TEST_MODE;

for (const d of [config.DATA_DIR, config.MEDIA_DIR, config.TMP_DIR]) fs.mkdirSync(d, { recursive: true });

if (config.PRODUCTION && config.SESSION_SECRET === 'dev-secret-change-me') {
  throw new Error('SESSION_SECRET must be set in production');
}

module.exports = config;
