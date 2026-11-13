const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

const db = new Database(path.join(config.DATA_DIR, 'dangida.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'buyer',          -- buyer | agent | admin
  notif_seen_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT 'sale',        -- sale | rent | shortlet
  type TEXT NOT NULL DEFAULT 'house',          -- house | apartment | land | commercial | duplex | bungalow
  price INTEGER NOT NULL DEFAULT 0,            -- naira
  state TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  bedrooms INTEGER NOT NULL DEFAULT 0,
  bathrooms INTEGER NOT NULL DEFAULT 0,
  size_sqm INTEGER NOT NULL DEFAULT 0,
  features TEXT NOT NULL DEFAULT '',           -- comma separated
  title_doc TEXT NOT NULL DEFAULT '',          -- C of O, R of O, Deed ...
  contact_phone TEXT NOT NULL DEFAULT '',
  map_url TEXT NOT NULL DEFAULT '',
  unlock_fee INTEGER,                          -- NULL = site default
  easy_buy INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',        -- draft | pending | active | sold | rejected
  cover_media_id INTEGER,
  source TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  sold_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_prop_status ON properties(status, published_at);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                          -- image | video
  file TEXT NOT NULL DEFAULT '',
  thumb TEXT NOT NULL DEFAULT '',
  bytes INTEGER NOT NULL DEFAULT 0,
  orig_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',        -- ready | processing | failed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_media_prop ON media(property_id);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL,                       -- unlock | escrow | installment
  target_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | paid | failed
  provider TEXT NOT NULL DEFAULT 'paystack',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS unlocks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  payment_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, property_id)
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  months INTEGER NOT NULL,
  deposit_pct REAL NOT NULL,
  markup_pct REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  property_id INTEGER NOT NULL REFERENCES properties(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  plan_name TEXT NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | active | completed | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS installments (
  id INTEGER PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,                        -- 0 = deposit
  due_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'due',          -- due | paid
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS escrows (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  fee INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'awaiting_payment', -- awaiting_payment | funded | released | disputed | refunded | cancelled
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS escrow_events (
  id INTEGER PRIMARY KEY,
  escrow_id INTEGER NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
  actor_id INTEGER,
  event TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL DEFAULT 'sale',
  type TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  min_price INTEGER NOT NULL DEFAULT 0,
  max_price INTEGER NOT NULL DEFAULT 0,
  bedrooms INTEGER NOT NULL DEFAULT 0,
  details TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',         -- open | closed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  sub TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,                             -- NULL = all members
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '/',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wa_state (
  phone TEXT PRIMARY KEY,
  draft_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wa_seen (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  property_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'contact',        -- contact | listing | security
  name TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',         -- open | resolved
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'insight',    -- insight | news | guide
  body TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Columns added after the first release.
const addColumn = (table, name, ddl) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
};
addColumn('users', 'account_type', "TEXT NOT NULL DEFAULT 'individual'"); // individual | agent | agency | developer | service
addColumn('users', 'company', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'bio', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'city', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'service_category', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'verified', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'kyc_status', "TEXT NOT NULL DEFAULT 'none'");       // none | pending | approved | rejected
addColumn('users', 'kyc_doc_type', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'kyc_file', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'kyc_note', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'suspended', 'INTEGER NOT NULL DEFAULT 0');
addColumn('properties', 'verified', 'INTEGER NOT NULL DEFAULT 0');
addColumn('properties', 'featured', 'INTEGER NOT NULL DEFAULT 0');
addColumn('properties', 'new_dev', 'INTEGER NOT NULL DEFAULT 0');
addColumn('properties', 'lat', 'REAL');
addColumn('properties', 'lng', 'REAL');
addColumn('properties', 'nearby', "TEXT NOT NULL DEFAULT ''");
addColumn('properties', 'tour_url', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'referred_by', 'INTEGER');
addColumn('properties', 'distance_km', 'REAL');
addColumn('users', 'email', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
addColumn('installments', 'reminded_at', 'TEXT');
addColumn('escrows', 'credit', 'INTEGER NOT NULL DEFAULT 0');
addColumn('escrows', 'docs_checked', 'INTEGER NOT NULL DEFAULT 0');

const audit = (actorId, action, detail = '') =>
  db.prepare('INSERT INTO audit(actor_id, action, detail) VALUES(?,?,?)').run(actorId || null, String(action).slice(0, 120), String(detail).slice(0, 500));

const DEFAULT_SETTINGS = {
  default_unlock_fee: '0',    // view-details fee: removed (kept at 0). Pay-to-view code stays dormant.
  escrow_fee_pct: '1.5',
  support_whatsapp: '2348037572052',
  phones: '+234 803 757 2052, +234 816 130 4050',
  request_fee: '2000',        // paid by a buyer/agent to publish a property request (0 = free)
  inspection_fee: '5000',     // fallback when no price band applies
  insp_rent_limit: '2000000', insp_rent_low: '3000', insp_rent_high: '5000',            // rent and short-let: below limit / at or above
  insp_sale_t1: '5000000', insp_sale_f1: '3000', insp_sale_t2: '50000000', insp_sale_f2: '5000', insp_sale_f3: '10000', // sale bands
  insp_land_base: '3000', insp_land_km: '200', insp_land_max: '25000',                // land: base + per km from the city centre, capped     // paid to confirm an inspection appointment; credited towards the purchase
  title_check_fee: '25000',   // title verification report
  referral_reward: '0',       // naira paid to a referrer when the person they invited buys
  secondary_market: '0',      // 1 = investors may resell SPV units to other verified members
  contact_email: '',
  office_address: 'Office B09, Sadiq City Plaza, Rijiyar Zaki by Ring Road, Kano State, Nigeria',
  currency_rates: '{"USD":1600,"GBP":2050,"AED":435}', // naira per 1 unit, display only
};

const getSetting = (key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULT_SETTINGS[key] ?? null;
};
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
const allSettings = () => {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = getSetting(k);
  return out;
};

if (!db.prepare('SELECT 1 FROM plans LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO plans(name, months, deposit_pct, markup_pct) VALUES(?,?,?,?)');
  ins.run('Quick 6', 6, 40, 0);
  ins.run('Steady 12', 12, 30, 5);
  ins.run('Flexi 24', 24, 20, 12);
}

// One-time: the view-details fee was removed, so clear any value saved earlier.
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'unlock_fee_removed'").get()) {
  db.prepare("INSERT INTO settings(key,value) VALUES('default_unlock_fee','0') ON CONFLICT(key) DO UPDATE SET value='0'").run();
  db.prepare("INSERT INTO settings(key,value) VALUES('unlock_fee_removed','1')").run();
  db.prepare('UPDATE properties SET unlock_fee = NULL').run();
}

module.exports = { db, addColumn, audit, getSetting, setSetting, allSettings, DEFAULT_SETTINGS };
