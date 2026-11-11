// Automatic media compression + clean-up.
// Images -> WebP (max 1600px) + 480px thumbnail. Videos -> 720p H.264 via ffmpeg (if installed).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const sharp = require('sharp');
const config = require('./config');
const { db } = require('./db');

// Use the system ffmpeg when there is one, otherwise the copy bundled by the optional "ffmpeg-static"
// package (useful on shared hosting, where ffmpeg is rarely installed).
let FFMPEG = 'ffmpeg';
if (spawnSync(FFMPEG, ['-version']).status !== 0) {
  try { FFMPEG = require('ffmpeg-static') || FFMPEG; } catch { /* not installed */ }
}
const HAS_FFMPEG = spawnSync(FFMPEG, ['-version']).status === 0;
const newName = (ext) => `${crypto.randomBytes(16).toString('hex')}.${ext}`;
const abs = (file) => path.join(config.MEDIA_DIR, path.basename(file));
const rm = (file) => file && fs.promises.unlink(abs(file)).catch(() => {});
const size = (file) => fs.statSync(abs(file)).size;

async function compressImage(srcPath) {
  const file = newName('webp');
  const thumb = newName('webp');
  const base = sharp(srcPath, { failOn: 'none' }).rotate();
  await base.clone().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toFile(abs(file));
  await base.clone().resize(480, 360, { fit: 'cover' }).webp({ quality: 60 }).toFile(abs(thumb));
  return { file, thumb, bytes: size(file) + size(thumb) };
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-400) || `ffmpeg exited ${code}`))));
  });
}

async function compressVideo(srcPath) {
  const file = newName('mp4');
  const thumb = newName('webp');
  if (!HAS_FFMPEG) {
    await fs.promises.copyFile(srcPath, abs(file));
    return { file, thumb: '', bytes: size(file) };
  }
  await ffmpeg([
    '-i', srcPath,
    '-vf', "scale='min(1280,iw)':-2",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
    abs(file),
  ]);
  const poster = path.join(config.TMP_DIR, newName('jpg'));
  let hasThumb = false;
  try {
    await ffmpeg(['-i', abs(file), '-frames:v', '1', '-q:v', '4', poster]);
    await sharp(poster).resize(480, 360, { fit: 'cover' }).webp({ quality: 60 }).toFile(abs(thumb));
    hasThumb = true;
  } catch { /* poster is optional */ }
  fs.promises.unlink(poster).catch(() => {});
  return { file, thumb: hasThumb ? thumb : '', bytes: size(file) + (hasThumb ? size(thumb) : 0) };
}

// Videos are heavy: compress one at a time in the background.
let videoQueue = Promise.resolve();

/**
 * Compress an uploaded file and attach it to a property. The original upload is always deleted.
 * Returns the media row (videos come back with status "processing").
 */
async function addMedia(propertyId, srcPath, mimetype) {
  const origBytes = fs.statSync(srcPath).size;
  const isVideo = String(mimetype).startsWith('video/');
  const cleanup = () => fs.promises.unlink(srcPath).catch(() => {});
  let id;

  if (!isVideo) {
    try {
      const out = await compressImage(srcPath);
      id = db
        .prepare("INSERT INTO media(property_id, kind, file, thumb, bytes, orig_bytes) VALUES(?,?,?,?,?,?)")
        .run(propertyId, 'image', out.file, out.thumb, out.bytes, origBytes).lastInsertRowid;
    } finally {
      await cleanup();
    }
    const prop = db.prepare('SELECT cover_media_id FROM properties WHERE id = ?').get(propertyId);
    if (prop && !prop.cover_media_id) db.prepare('UPDATE properties SET cover_media_id = ? WHERE id = ?').run(id, propertyId);
  } else {
    id = db
      .prepare("INSERT INTO media(property_id, kind, orig_bytes, status) VALUES(?,?,?,'processing')")
      .run(propertyId, 'video', origBytes).lastInsertRowid;
    videoQueue = videoQueue.then(async () => {
      try {
        const out = await compressVideo(srcPath);
        const still = db.prepare('SELECT id FROM media WHERE id = ?').get(id);
        if (!still) { rm(out.file); rm(out.thumb); return; } // deleted while processing
        db.prepare("UPDATE media SET file=?, thumb=?, bytes=?, status='ready' WHERE id=?").run(out.file, out.thumb, out.bytes, id);
      } catch (e) {
        console.error('Video compression failed:', e.message);
        db.prepare("UPDATE media SET status='failed' WHERE id=?").run(id);
      } finally {
        await cleanup();
      }
    });
  }
  return db.prepare('SELECT * FROM media WHERE id = ?').get(id);
}

function deleteMediaRow(row) {
  rm(row.file);
  rm(row.thumb);
  db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
}

function deleteMedia(id) {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!row) return;
  deleteMediaRow(row);
  const prop = db.prepare('SELECT cover_media_id FROM properties WHERE id = ?').get(row.property_id);
  if (prop && prop.cover_media_id === id) {
    const next = db.prepare("SELECT id FROM media WHERE property_id = ? AND kind = 'image' ORDER BY id LIMIT 1").get(row.property_id);
    db.prepare('UPDATE properties SET cover_media_id = ? WHERE id = ?').run(next ? next.id : null, row.property_id);
  }
}

/** Once a property is sold: remove every photo/video except the cover image. Returns bytes freed. */
function purgeSoldMedia(propertyId) {
  const prop = db.prepare('SELECT cover_media_id FROM properties WHERE id = ?').get(propertyId);
  if (!prop) return 0;
  let coverId = prop.cover_media_id;
  if (!coverId) {
    const first = db.prepare("SELECT id FROM media WHERE property_id = ? AND kind = 'image' ORDER BY id LIMIT 1").get(propertyId);
    if (first) {
      coverId = first.id;
      db.prepare('UPDATE properties SET cover_media_id = ? WHERE id = ?').run(coverId, propertyId);
    }
  }
  let freed = 0;
  for (const row of db.prepare('SELECT * FROM media WHERE property_id = ?').all(propertyId)) {
    if (row.id === coverId) continue;
    freed += row.bytes;
    deleteMediaRow(row);
  }
  return freed;
}

function deleteAllMedia(propertyId) {
  for (const row of db.prepare('SELECT * FROM media WHERE property_id = ?').all(propertyId)) deleteMediaRow(row);
}

const whenIdle = () => videoQueue;

module.exports = { addMedia, deleteMedia, purgeSoldMedia, deleteAllMedia, whenIdle, HAS_FFMPEG };
