// Data layer: reads Claude Code credentials + usage API, and computes
// per-model cost from local ~/.claude/projects JSONL logs (ccusage-style).
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CRED_FILE = path.join(CLAUDE_DIR, '.credentials.json');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

// Claude Code's public OAuth client id (same one the CLI uses for refresh)
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

// USD per 1M tokens: [input, output, cacheWrite, cacheRead]
const PRICING = [
  { match: /fable-5|mythos/, price: [10, 50, 12.5, 1] },
  { match: /opus-4-[5678]/, price: [5, 25, 6.25, 0.5] },
  { match: /opus/, price: [15, 75, 18.75, 1.5] },
  { match: /sonnet/, price: [3, 15, 3.75, 0.3] },
  { match: /haiku-4-5/, price: [1, 5, 1.25, 0.1] },
  { match: /haiku/, price: [0.8, 4, 1, 0.08] },
];
const FALLBACK_PRICE = [5, 25, 6.25, 0.5];

function priceFor(model) {
  const m = (model || '').toLowerCase();
  for (const p of PRICING) if (p.match.test(m)) return p.price;
  return FALLBACK_PRICE;
}

function costUSD(model, u) {
  const [pin, pout, pw, pr] = priceFor(model);
  return (
    ((u.input || 0) * pin +
      (u.output || 0) * pout +
      (u.cacheWrite || 0) * pw +
      (u.cacheRead || 0) * pr) /
    1e6
  );
}

// ---------- HTTP helpers ----------
function httpsJSON(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

// ---------- OAuth credentials ----------
function readCreds() {
  try {
    return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

async function refreshToken(creds) {
  const oauth = creds && creds.claudeAiOauth;
  if (!oauth || !oauth.refreshToken) return null;
  const body = JSON.stringify({
    grant_type: 'refresh_token',
    refresh_token: oauth.refreshToken,
    client_id: OAUTH_CLIENT_ID,
  });
  const res = await httpsJSON(
    {
      hostname: 'console.anthropic.com',
      path: '/v1/oauth/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    },
    body
  );
  if (res.status !== 200 || !res.json || !res.json.access_token) return null;
  // Write rotated tokens back so Claude Code keeps working
  const updated = { ...creds };
  updated.claudeAiOauth = {
    ...oauth,
    accessToken: res.json.access_token,
    refreshToken: res.json.refresh_token || oauth.refreshToken,
    expiresAt: Date.now() + (res.json.expires_in || 3600) * 1000,
  };
  try {
    fs.writeFileSync(CRED_FILE, JSON.stringify(updated), 'utf8');
  } catch (_) {}
  return updated.claudeAiOauth.accessToken;
}

async function getAccessToken() {
  const creds = readCreds();
  const oauth = creds && creds.claudeAiOauth;
  if (!oauth) return null;
  if (oauth.accessToken && oauth.expiresAt && oauth.expiresAt > Date.now() + 60000) {
    return oauth.accessToken;
  }
  return refreshToken(creds);
}

// ---------- Plan limits from the OAuth usage endpoint ----------
async function fetchPlanUsage() {
  const token = await getAccessToken();
  if (!token) return { ok: false, reason: 'no_token' };
  const res = await httpsJSON({
    hostname: 'api.anthropic.com',
    path: '/api/oauth/usage',
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'Content-Type': 'application/json',
    },
  });
  if (res.status !== 200 || !res.json) return { ok: false, reason: `http_${res.status}` };

  const out = { ok: true, limits: [] };
  const j = res.json;
  if (Array.isArray(j.limits)) {
    for (const l of j.limits) {
      out.limits.push({
        kind: l.kind,
        label:
          l.kind === 'session'
            ? 'Session (5h)'
            : l.kind === 'weekly_all'
              ? 'Weekly (all)'
              : (l.scope && l.scope.model && l.scope.model.display_name) || l.kind,
        percent: l.percent != null ? l.percent : (l.utilization || 0) * 100,
        resetsAt: l.resets_at || null,
      });
    }
  } else {
    if (j.five_hour)
      out.limits.push({
        kind: 'session',
        label: 'Session (5h)',
        percent: (j.five_hour.utilization || 0) * 100,
        resetsAt: j.five_hour.resets_at || null,
      });
    if (j.seven_day)
      out.limits.push({
        kind: 'weekly_all',
        label: 'Weekly (all)',
        percent: (j.seven_day.utilization || 0) * 100,
        resetsAt: j.seven_day.resets_at || null,
      });
  }
  return out;
}

// ---------- Local JSONL scan: per-model tokens & cost ----------
function listJsonlFiles(maxAgeDays) {
  const files = [];
  const cutoff = Date.now() - maxAgeDays * 86400000;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.jsonl')) {
        try {
          if (fs.statSync(full).mtimeMs >= cutoff) files.push(full);
        } catch (_) {}
      }
    }
  }
  walk(PROJECTS_DIR);
  return files;
}

function scanLocalUsage(days = 7) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const windowMs = Date.now() - days * 86400000;

  const seen = new Set();
  const perModel = {}; // model -> {today:{...}, week:{...}}

  const bucketAdd = (bucket, u) => {
    bucket.input += u.input;
    bucket.output += u.output;
    bucket.cacheWrite += u.cacheWrite;
    bucket.cacheRead += u.cacheRead;
  };

  for (const file of listJsonlFiles(days + 1)) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    for (const line of content.split('\n')) {
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch (_) { continue; }
      const msg = o.message;
      if (!msg || !msg.usage || !msg.model || msg.model === '<synthetic>') continue;
      const ts = Date.parse(o.timestamp || '');
      if (!ts || ts < windowMs) continue;
      // Streaming duplicates the same message across many lines — dedupe
      const key = (msg.id || '') + ':' + (o.requestId || o.uuid || '');
      if (msg.id && seen.has(key)) continue;
      if (msg.id) seen.add(key);

      const u = {
        input: msg.usage.input_tokens || 0,
        output: msg.usage.output_tokens || 0,
        cacheWrite: msg.usage.cache_creation_input_tokens || 0,
        cacheRead: msg.usage.cache_read_input_tokens || 0,
      };
      if (!perModel[msg.model]) {
        perModel[msg.model] = {
          today: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
          week: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
        };
      }
      bucketAdd(perModel[msg.model].week, u);
      if (ts >= todayMs) bucketAdd(perModel[msg.model].today, u);
    }
  }

  const models = Object.entries(perModel)
    .map(([model, b]) => ({
      model,
      todayCost: costUSD(model, b.today),
      weekCost: costUSD(model, b.week),
      todayTokens: b.today.input + b.today.output + b.today.cacheWrite + b.today.cacheRead,
      weekTokens: b.week.input + b.week.output + b.week.cacheWrite + b.week.cacheRead,
    }))
    .sort((a, b) => b.weekCost - a.weekCost);

  return {
    models,
    totalToday: models.reduce((s, m) => s + m.todayCost, 0),
    totalWeek: models.reduce((s, m) => s + m.weekCost, 0),
  };
}

// ---------- USD -> THB rate (cached 12h, fallback 36) ----------
let rateCache = { value: 36, at: 0, live: false };
async function fetchThbRate() {
  if (Date.now() - rateCache.at < 12 * 3600000) return rateCache;
  try {
    const res = await httpsJSON({
      hostname: 'open.er-api.com',
      path: '/v6/latest/USD',
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const thb = res.json && res.json.rates && res.json.rates.THB;
    if (res.status === 200 && thb > 0) {
      rateCache = { value: thb, at: Date.now(), live: true };
    }
  } catch (_) {}
  if (!rateCache.at) rateCache.at = Date.now(); // don't retry every refresh on failure
  return rateCache;
}

async function getAll() {
  const [plan, local, rate] = await Promise.all([
    fetchPlanUsage().catch((e) => ({ ok: false, reason: String(e) })),
    Promise.resolve().then(() => scanLocalUsage(7)),
    fetchThbRate().catch(() => rateCache),
  ]);
  return {
    plan,
    local,
    thbRate: rate.value,
    thbLive: rate.live,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { getAll, scanLocalUsage, fetchPlanUsage };

// CLI test: node usage.js
if (require.main === module) {
  getAll().then((r) => console.log(JSON.stringify(r, null, 2)));
}
