// Set or reset a member's password (no WhatsApp codes any more).
// Usage on the server:  docker compose exec web node server/setpassword.js 2348037572052 "a-new-password"
const auth = require('./auth');
const { db } = require('./db');

const phone = auth.normalizePhone(process.argv[2]);
const password = process.argv[3] || '';
if (!phone || password.length < 8) {
  console.log('Usage: node server/setpassword.js <phone> <password of at least 8 characters>');
  process.exit(1);
}
const u = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
if (!u) {
  console.log('No account with that number.');
  process.exit(1);
}
db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(password), u.id);
console.log(`Password set for +${phone}`);
