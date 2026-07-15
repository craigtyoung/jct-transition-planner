const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3011;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SEED_DIR = path.join(__dirname, 'seeds');

// Ensure the data dir exists (Railway volume may mount empty on first deploy),
// then seed any missing files from the bundled read-only seeds/ folder.
fs.mkdirSync(DATA_DIR, { recursive: true });
try {
  for (const file of fs.readdirSync(SEED_DIR)) {
    const dest = path.join(DATA_DIR, file);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(SEED_DIR, file), dest);
    }
  }
} catch { /* no seeds dir — fine */ }

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/:file — read a JSON data file
app.get('/api/:file', (req, res) => {
  const name = req.params.file.replace(/[^a-z0-9-]/gi, '');
  const filePath = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Read error' });
  }
});

// Write-lock: if ADMIN_KEY is set (Railway), saves require a matching key.
// If unset (local dev), writes are open so local editing still works.
const ADMIN_KEY = process.env.ADMIN_KEY;

// POST /api/:file — write a JSON data file
app.post('/api/:file', (req, res) => {
  if (ADMIN_KEY && req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(403).json({ error: 'View only — editing is locked.' });
  }
  const name = req.params.file.replace(/[^a-z0-9-]/gi, '');
  const filePath = path.join(DATA_DIR, `${name}.json`);
  try {
    const payload = { ...req.body, lastUpdated: new Date().toISOString() };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    res.json({ ok: true, timestamp: payload.lastUpdated });
  } catch {
    res.status(500).json({ error: 'Write error' });
  }
});

app.listen(PORT, () => {
  console.log(`JCT Transition Planner → http://localhost:${PORT}`);
});
