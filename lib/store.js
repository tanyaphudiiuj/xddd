const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function load() {
  if (!fs.existsSync(DATA_FILE)) {
    return { groups: {}, startedAt: Date.now() };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return { groups: {}, startedAt: Date.now() };
  }
}

let db = load();

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function getGroup(id) {
  if (!db.groups[id]) {
    db.groups[id] = { antilink: false, welcome: false, muted: false };
    save();
  }
  return db.groups[id];
}

function setGroup(id, patch) {
  db.groups[id] = { ...getGroup(id), ...patch };
  save();
  return db.groups[id];
}

module.exports = { getGroup, setGroup, db };
