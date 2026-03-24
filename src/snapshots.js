const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');

const PKG_VERSION = require('../package.json').version;

function urlHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 8);
}

function snapshotDir(url) {
  const hostname = new URL(url).hostname;
  return path.join(config.OUTPUT_DIR, 'snapshots', hostname);
}

function saveSnapshot(url, extractorName, data) {
  const dir = snapshotDir(url);
  fs.mkdirSync(dir, { recursive: true });

  const ts = new Date().toISOString();
  const tsFile = ts.replace(/[:.]/g, '-').slice(0, 19);
  const hash = urlHash(url);
  const fileName = `${extractorName}-${hash}-${tsFile}.json`;
  const filePath = path.join(dir, fileName);

  const snapshot = {
    url,
    extractor: extractorName,
    timestamp: ts,
    version: PKG_VERSION,
    data,
  };

  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  return filePath;
}

function loadLatestSnapshot(url, extractorName) {
  const dir = snapshotDir(url);
  if (!fs.existsSync(dir)) return null;

  const hash = urlHash(url);
  const prefix = `${extractorName}-${hash}-`;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  const contents = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
  return { timestamp: contents.timestamp, data: contents.data };
}

module.exports = { saveSnapshot, loadLatestSnapshot };
