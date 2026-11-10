// Optional auto-posting of new listings to the company's own social pages.
// (Visitors can also share any listing themselves from the share bar on the site.)
const config = require('./config');

async function autoPost(p) {
  const url = `${config.BASE_URL}/p/${p.id}`;
  const where = [p.area, p.city, p.state].filter(Boolean).join(', ');
  const text =
    `${p.title}\n₦${Number(p.price).toLocaleString('en-NG')}` +
    (where ? `\n${where}` : '') +
    (p.easy_buy ? '\nEasy-buy instalment plans available' : '') +
    `\n\nView on ${config.SITE_NAME}: ${url}`;
  const jobs = [];

  if (config.FB_PAGE_ID && config.FB_PAGE_TOKEN) {
    jobs.push(
      fetch(`https://graph.facebook.com/v21.0/${config.FB_PAGE_ID}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, link: url, access_token: config.FB_PAGE_TOKEN }),
      }).then(check('Facebook'))
    );
  }
  if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, text }),
      }).then(check('Telegram'))
    );
  }
  await Promise.allSettled(jobs);
}

const check = (name) => async (res) => {
  if (!res.ok) console.error(`${name} auto-post failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
};

module.exports = { autoPost };
