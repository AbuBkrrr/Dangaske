// Set or reset a member's password (no WhatsApp codes any more).
// Usage on the server:  docker compose exec web node server/setpassword.js 2348037572052 "a-new-password" [admin]
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
// Pass 'admin' as a third argument to make the account an admin (no effect on other accounts).
if (process.argv[4] === 'admin') db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(u.id);
console.log(`Password set for +${phone}${process.argv[4] === 'admin' ? ' and role set to admin' : ''}`);
