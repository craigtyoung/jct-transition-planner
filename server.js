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

// Site-wide password gate (HTTP Basic Auth). If SITE_PASSWORD is set (Railway),
// every page and API call requires the shared login. Unset (local dev) = open.
const SITE_USER = process.env.SITE_USER || 'jct';
const SITE_PASSWORD = process.env.SITE_PASSWORD;
if (SITE_PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
      if (user === SITE_USER && pass === SITE_PASSWORD) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="JCT Transition Planner"');
    return res.status(401).send('Authentication required.');
  });
}

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

// POST /api/:file — write a JSON data file (open to anyone past the site gate)
app.post('/api/:file', (req, res) => {
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
