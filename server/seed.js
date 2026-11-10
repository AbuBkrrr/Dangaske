// Demo data so the site can be explored: `npm run seed`. Do not run on a live site.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('./config');
const { db } = require('./db');
const auth = require('./auth');
const listings = require('./listings');
const media = require('./media');

const SAMPLES = [
  ['4 bedroom duplex with BQ', 'sale', 'duplex', 85000000, 'Kano', 'Kano', 'Nassarawa GRA', 4, 5, 600, 'C of O', 'BQ, borehole, parking for 4, fitted kitchen', true],
  ['3 bedroom bungalow, fenced and gated', 'sale', 'bungalow', 32000000, 'Kano', 'Kano', 'Hotoro', 3, 3, 450, 'R of O', 'Fenced, gate house, tiled', true],
  ['Dry plot in a developing estate', 'sale', 'land', 6500000, 'Kaduna', 'Kaduna', 'Millennium City', 0, 0, 900, 'Deed of assignment', 'Surveyed, road access', true],
  ['2 bedroom serviced apartment', 'rent', 'apartment', 2400000, 'FCT Abuja', 'Abuja', 'Gwarinpa', 2, 2, 110, '', '24h power, security, parking', false],
  ['Corner-piece commercial plot', 'sale', 'commercial', 120000000, 'FCT Abuja', 'Abuja', 'Wuse 2', 0, 0, 1500, 'C of O', 'Corner piece, tarred road', false],
  ['5 bedroom detached house', 'sale', 'house', 150000000, 'Lagos', 'Lekki', 'Chevron Drive', 5, 6, 520, 'Governor\'s consent', 'Pool, BQ, smart home', true],
];
const COLORS = [['#17573f', '#e3b04b'], ['#1f5fa8', '#f2ead8'], ['#7a4a1e', '#f3d9a4'], ['#3a4a6b', '#d8e2f0'], ['#5a2d4e', '#f0d6e6'], ['#205b5b', '#d6efe9']];

async function picture(i, n) {
  const [a, b] = COLORS[i % COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="1600" height="1200" fill="url(#g)"/><rect y="900" width="1600" height="300" fill="#00000022"/>
    <path d="M800 ${330 + n * 30} 430 640h110v330h200V780h120v190h200V640h110z" fill="#ffffffdd"/>
    <text x="800" y="1090" font-family="Georgia,serif" font-size="54" fill="#fff" text-anchor="middle">Sample photo ${n + 1}</text></svg>`;
  const tmp = path.join(config.TMP_DIR, `seed-${i}-${n}.png`);
  await sharp(Buffer.from(svg)).png().toFile(tmp);
  return tmp;
}

(async () => {
  if (db.prepare('SELECT 1 FROM properties LIMIT 1').get()) return console.log('Listings already exist - nothing seeded.');
  const admin = auth.upsertUser(config.ADMIN_PHONES[0] || '2348000000001', { name: config.COMPANY });
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
  admin.role = 'admin';
  for (const [i, s] of SAMPLES.entries()) {
    const p = listings.createProperty(admin, {
      title: s[0], purpose: s[1], type: s[2], price: s[3], state: s[4], city: s[5], area: s[6], bedrooms: s[7], bathrooms: s[8], size_sqm: s[9],
      title_doc: s[10], features: s[11], easy_buy: s[12], address: `Plot ${10 + i}, ${s[6]}, ${s[5]}`,
      description: `${s[0]} in ${s[6]}, ${s[5]}.\n\nThis is sample content created by the seed script so you can explore the site. Replace it with your real listings.`,
    });
    for (let n = 0; n < 3; n++) await media.addMedia(p.id, await picture(i, n), 'image/png');
    listings.publish(listings.getProperty(p.id));
  }
  if (!fs.existsSync(config.MEDIA_DIR)) throw new Error('media dir missing');
  console.log(`Seeded ${SAMPLES.length} sample listings. Admin phone: +${admin.phone}`);
})();
