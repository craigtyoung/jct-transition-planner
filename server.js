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

// Merge newly-added court configurations from the seed into existing data.
// Adds missing config keys ONLY — never overwrites values the user has edited.
try {
  const liveFm = path.join(DATA_DIR, 'financial-model.json');
  const seedFm = path.join(SEED_DIR, 'financial-model.json');
  if (fs.existsSync(liveFm) && fs.existsSync(seedFm)) {
    const live = JSON.parse(fs.readFileSync(liveFm, 'utf8'));
    const seed = JSON.parse(fs.readFileSync(seedFm, 'utf8'));
    if (seed.configurations && live.configurations) {
      let changed = false;
      for (const k of Object.keys(seed.configurations)) {
        if (!live.configurations[k]) { live.configurations[k] = seed.configurations[k]; changed = true; }
      }
      if (changed) fs.writeFileSync(liveFm, JSON.stringify(live, null, 2));
    }
  }
} catch { /* non-fatal */ }

// Role-aware auth (HTTP Basic Auth). If SITE_PASSWORD is set (Railway), every
// page and API call requires a login. Two roles:
//   owner   (SITE_USER / SITE_PASSWORD)       — full read/write
//   partner (PARTNER_USER / PARTNER_PASSWORD) — read-only, limited data
// Unset SITE_PASSWORD (local dev) = open, treated as owner.
const SITE_USER = process.env.SITE_USER || 'jct';
const SITE_PASSWORD = process.env.SITE_PASSWORD;
const PARTNER_USER = process.env.PARTNER_USER || 'partner';
const PARTNER_PASSWORD = process.env.PARTNER_PASSWORD;
if (SITE_PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
      if (user === SITE_USER && pass === SITE_PASSWORD) { req.role = 'owner'; return next(); }
      if (PARTNER_PASSWORD && user === PARTNER_USER && pass === PARTNER_PASSWORD) { req.role = 'partner'; return next(); }
    }
    res.set('WWW-Authenticate', 'Basic realm="JCT Transition Planner"');
    return res.status(401).send('Authentication required.');
  });
} else {
  app.use((req, res, next) => { req.role = 'owner'; next(); }); // local dev = full access
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Report the caller's role so the client can adapt nav + controls.
app.get('/api/whoami', (req, res) => res.json({ role: req.role || 'owner' }));

// Which data a partner may read, and how each file is trimmed before sending.
const PARTNER_READABLE = new Set(['build-plan', 'financial-model', 'context']);
function filterForPartner(name, data) {
  if (name === 'financial-model') {
    // Build scope only — no income, operating costs, pro-forma, or financing.
    const out = { selectedConfig: data.selectedConfig, configurations: {} };
    for (const k in (data.configurations || {})) {
      const c = data.configurations[k];
      out.configurations[k] = { label: c.label, courts: c.courts, buildCost: c.buildCost, buildBreakdown: c.buildBreakdown || [] };
    }
    return out;
  }
  if (name === 'context') {
    // Only contacts explicitly flagged shared.
    return { groups: (data.groups || [])
      .map(g => ({ id: g.id, title: g.title, contacts: (g.contacts || []).filter(ct => ct.shared) }))
      .filter(g => g.contacts.length) };
  }
  return data;
}
// Treat as partner-scoped when it's a real partner login OR an owner explicitly
// previewing (?as=partner) — so the preview shows exactly what a partner sees.
function partnerScoped(req) {
  return req.role === 'partner' || (req.role === 'owner' && req.query.as === 'partner');
}

// POST /api/chat — "Ask the Planner" assistant.
// Proxies to the Anthropic API. The API key stays server-side (env var) and is
// NEVER sent to the browser. Grounds every answer in the live planner JSON data.
app.post('/api/chat', async (req, res) => {
  if (partnerScoped(req)) return res.status(403).json({ error: 'The assistant is not available in the shared view.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'The assistant is not configured yet. Set ANTHROPIC_API_KEY in the server environment (Railway → Variables) and redeploy.'
    });
  }
  if (typeof fetch !== 'function') {
    return res.status(500).json({ error: 'Server runtime has no fetch — needs Node 18+.' });
  }
  const messages = Array.isArray(req.body && req.body.messages) ? req.body.messages : null;
  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'No messages provided.' });
  }

  // Gather all planner data files as grounding context.
  let dataBlock = '';
  try {
    for (const file of fs.readdirSync(DATA_DIR)) {
      if (!file.endsWith('.json') || file === 'probe.json') continue;
      try {
        dataBlock += `\n=== ${file} ===\n${fs.readFileSync(path.join(DATA_DIR, file), 'utf8')}\n`;
      } catch { /* skip unreadable */ }
    }
  } catch { /* no data dir — proceed without grounding */ }

  const system = `You are the assistant for the Joshua Creek Tennis (JCT) Transition Planner — a private planning tool for relocating the tennis club to a new site on William Halton Parkway, Oakville, Ontario, targeting a September 2028 opening.

Answer questions using ONLY the planner data below. Be concise, specific, and cite the actual numbers, names, and contacts. If something isn't in the data, say so plainly — never invent figures, costs, dates, or contact details. All money is in Canadian dollars. When discussing a cost line, note whether the data marks it as shared (golf + tennis) or tennis-only.

=== PLANNER DATA ===${dataBlock}`;

  const model = process.env.CHAT_MODEL || 'claude-haiku-4-5-20251001';

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system,
        messages: messages.slice(-12).map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || '')
        }))
      })
    });
    if (!r.ok) {
      const errText = await r.text();
      return res.status(502).json({ error: `Anthropic API error (${r.status}). ${errText.slice(0, 300)}` });
    }
    const data = await r.json();
    const reply = (data.content || [])
      .filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    res.json({ reply: reply || '(no response)' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to reach the assistant: ' + ((e && e.message) || 'unknown error') });
  }
});

// GET /api/:file — read a JSON data file
app.get('/api/:file', (req, res) => {
  const name = req.params.file.replace(/[^a-z0-9-]/gi, '');
  const filePath = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (partnerScoped(req)) {
      if (!PARTNER_READABLE.has(name)) return res.status(403).json({ error: 'Not available in the shared view.' });
      return res.json(filterForPartner(name, data));
    }
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Read error' });
  }
});

// POST /api/:file — write a JSON data file (owner only; partners are read-only)
app.post('/api/:file', (req, res) => {
  if (req.role === 'partner') return res.status(403).json({ error: 'Read-only access.' });
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
