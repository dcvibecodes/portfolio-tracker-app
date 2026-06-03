const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const Database = require("better-sqlite3");
const session = require("express-session");

const app = express();
const PORT = 3001;

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// --- SQLite setup ---
const dbPath = path.join(dataDir, "portfolio.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// --- Schema ---
db.exec(`
  CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    asset_class TEXT NOT NULL,
    asset_type TEXT DEFAULT '',
    broker TEXT DEFAULT '',
    txn_type TEXT DEFAULT 'buy',
    buy_price REAL DEFAULT 0,
    quantity REAL DEFAULT 0,
    invested_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'INR',
    current_price REAL,
    notes TEXT DEFAULT '',
    ticker TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS asset_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS asset_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS brokers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ticker_map (
    asset_name TEXT PRIMARY KEY,
    ticker TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS app_lock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    pin_hash TEXT NOT NULL,
    recovery_hash TEXT NOT NULL,
    locked INTEGER NOT NULL DEFAULT 1
  );
`);

// Add ticker column if upgrading from old schema
try { db.exec(`ALTER TABLE holdings ADD COLUMN ticker TEXT DEFAULT ''`); } catch (e) { /* already exists */ }
// Add txn_type column if upgrading from old schema
try { db.exec(`ALTER TABLE holdings ADD COLUMN txn_type TEXT DEFAULT 'buy'`); } catch (e) { /* already exists */ }
// Add invested_base column — stores invested amount in user's base currency (for foreign-currency holdings)
try { db.exec(`ALTER TABLE holdings ADD COLUMN invested_base REAL`); } catch (e) { /* already exists */ }

// Seed default currency setting
const defaultCurrSetting = db.prepare(`SELECT value FROM settings WHERE key = 'default_currency'`).get();
if (!defaultCurrSetting) {
  // Default: no currency configured (currency-agnostic mode)
  db.prepare(`INSERT INTO settings (key, value) VALUES ('default_currency', '')`).run();
}
const rateDisplaySetting = db.prepare(`SELECT value FROM settings WHERE key = 'rate_display'`).get();
if (!rateDisplaySetting) {
  db.prepare(`INSERT INTO settings (key, value) VALUES ('rate_display', '')`).run();
}

// --- Seed defaults if empty ---
const classCount = db.prepare(`SELECT COUNT(*) as c FROM asset_classes`).get().c;
if (classCount === 0) {
  const insertClass = db.prepare(`INSERT OR IGNORE INTO asset_classes (name, sort_order) VALUES (?, ?)`);
  const defaults = ["Indian Stock", "Indian Mutual Fund", "US Stock", "Crypto", "ETF", "Bond", "Gold"];
  defaults.forEach((name, i) => insertClass.run(name, i));
}

const typeCount = db.prepare(`SELECT COUNT(*) as c FROM asset_types`).get().c;
if (typeCount === 0) {
  const insertType = db.prepare(`INSERT OR IGNORE INTO asset_types (name, sort_order) VALUES (?, ?)`);
  ["Stocks", "Mutual Fund", "Shares", "Cryptocurrency", "ETF", "Bond", "Commodity"].forEach((name, i) => insertType.run(name, i));
}

const brokerCount = db.prepare(`SELECT COUNT(*) as c FROM brokers`).get().c;
if (brokerCount === 0) {
  const insertBroker = db.prepare(`INSERT OR IGNORE INTO brokers (name, sort_order) VALUES (?, ?)`);
  // Seed from existing holdings
  const existingBrokers = db.prepare(`SELECT DISTINCT broker FROM holdings WHERE broker != ''`).all();
  existingBrokers.forEach((row, i) => insertBroker.run(row.broker, i));
  if (existingBrokers.length === 0) {
    ["Zerodha", "Groww", "INDmoney", "SBI Direct", "Coin by Zerodha"].forEach((name, i) => insertBroker.run(name, i));
  }
}

// --- Lock helpers ---
function hashPin(pin) {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

function generateRecoveryCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

// --- Multi-currency exchange rate system ---
let yfInstance = null;
// Session-level cache: rates cached per server request batch (cleared on price refresh)
let ratesSessionCache = {};

function getDefaultCurrency() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'default_currency'`).get();
  return (row && row.value) || "";
}

async function getYF() {
  if (yfInstance) return yfInstance;
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default || mod;
    if (typeof YahooFinance === "function" && YahooFinance.prototype) {
      yfInstance = new YahooFinance();
    } else if (YahooFinance.quote) {
      yfInstance = YahooFinance;
    } else if (typeof YahooFinance === "function") {
      yfInstance = YahooFinance();
    } else {
      yfInstance = YahooFinance;
    }
  } catch (e) {
    console.error("Failed to initialize yahoo-finance2:", e.message);
  }
  return yfInstance;
}

async function fetchExchangeRate(fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return 1;
  const key = `${fromCurrency}${toCurrency}`;
  // Use session cache if available (avoids duplicate fetches within same page load)
  if (ratesSessionCache[key]) return ratesSessionCache[key];

  try {
    const yf = await getYF();
    if (!yf) return 1;
    const ticker = `${fromCurrency}${toCurrency}=X`;
    const result = await yf.quote(ticker);
    if (result && result.regularMarketPrice) {
      ratesSessionCache[key] = result.regularMarketPrice;
      return result.regularMarketPrice;
    }
  } catch (e) {
    console.error(`Failed to fetch ${fromCurrency}→${toCurrency} rate:`, e.message);
  }
  return ratesSessionCache[key] || 1;
}

// Get conversion rate from a holding's currency to the default currency
async function getFxToDefault(holdingCurrency) {
  const defaultCur = getDefaultCurrency();
  if (holdingCurrency === defaultCur) return 1;
  return await fetchExchangeRate(holdingCurrency, defaultCur);
}

// Get all foreign currencies used in holdings (not equal to default)
function getForeignCurrencies() {
  const defaultCur = getDefaultCurrency();
  const rows = db.prepare(`SELECT DISTINCT currency FROM holdings WHERE currency != ?`).all(defaultCur);
  return rows.map(r => r.currency);
}

// Get all rates for foreign currencies → default
async function getAllRates() {
  const defaultCur = getDefaultCurrency();
  const foreign = getForeignCurrencies();
  const rates = {};
  for (const cur of foreign) {
    rates[cur] = await fetchExchangeRate(cur, defaultCur);
  }
  return { default_currency: defaultCur, rates };
}

// --- Price fetching ---
async function fetchPrice(ticker) {
  if (!ticker) return null;
  try {
    const yf = await getYF();
    if (!yf) return null;
    const result = await yf.quote(ticker);
    if (result && result.regularMarketPrice) {
      return result.regularMarketPrice;
    }
  } catch (e) {
    console.error(`Failed to fetch price for ${ticker}:`, e.message);
  }
  return null;
}

function isValidDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

app.use(express.json());

// --- Session middleware ---
const SESSION_SECRET = crypto.randomBytes(32).toString("hex");

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// --- Auth middleware ---
function authMiddleware(req, res, next) {
  const openPaths = [
    "/api/lock/status",
    "/api/lock/config",
    "/api/lock/unlock",
    "/api/lock/recovery",
    "/api/lock/setup"
  ];

  if (openPaths.includes(req.path)) {
    return next();
  }

  // If no lock is configured, allow all access (first-time setup)
  const lockRow = db.prepare("SELECT id FROM app_lock WHERE id = 1").get();
  if (!lockRow) {
    return next();
  }

  // If session is authenticated, allow through
  if (req.session && req.session.authenticated) {
    return next();
  }

  // Not authenticated — block
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Unauthorized. Please unlock the app first." });
  }

  // For browser requests (HTML, CSS, JS), serve minimal lock page
  return res.send(getLoginPage());
}

function getLoginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portfolio Tracker - Locked</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .lock-modal { background: #fff; border-radius: 16px; padding: 48px 40px; width: 100%; max-width: 380px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
    h2 { margin-bottom: 8px; font-size: 20px; color: #1a1a2e; }
    .subtitle { color: #666; font-size: 13px; margin: 0 0 20px; }
    input[type="password"], input[type="text"] { display: block; width: 100%; text-align: center; font-family: monospace; font-size: 1.4rem; letter-spacing: 0.3em; margin-bottom: 12px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; }
    button { width: 100%; padding: 12px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; margin-bottom: 10px; }
    button:hover { background: #2563eb; }
    .error { color: #e74c3c; font-size: 13px; display: none; margin: 8px 0; }
    .recovery-link { font-size: 13px; margin-top: 8px; }
    .recovery-link a { color: #3b82f6; font-weight: 600; text-decoration: none; cursor: pointer; }
    .recovery-section { display: none; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="lock-modal">
    <h2>Portfolio Tracker Locked</h2>
    <p class="subtitle">Enter your 6-digit PIN to access the app.</p>
    <input type="password" id="pin" maxlength="6" inputmode="numeric" pattern="[0-9]*" placeholder="••••••" />
    <button id="unlock-btn" type="button">Unlock</button>
    <p class="error" id="error"></p>
    <p class="recovery-link"><a id="show-recovery">Forgot PIN? Use recovery code</a></p>
    <div class="recovery-section" id="recovery-section">
      <input type="text" id="recovery-input" placeholder="Recovery code" />
      <button id="recovery-btn" type="button">Recover</button>
    </div>
  </div>
  <script>
    const errorEl = document.getElementById("error");
    document.getElementById("unlock-btn").addEventListener("click", async () => {
      const pin = document.getElementById("pin").value;
      if (!pin) return;
      const resp = await fetch("/api/lock/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      if (resp.ok) { window.location.reload(); }
      else { const d = await resp.json(); errorEl.textContent = d.error || "Incorrect PIN"; errorEl.style.display = "block"; }
    });
    document.getElementById("pin").addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("unlock-btn").click(); });
    document.getElementById("show-recovery").addEventListener("click", () => { document.getElementById("recovery-section").style.display = "block"; });
    document.getElementById("recovery-btn").addEventListener("click", async () => {
      const code = document.getElementById("recovery-input").value;
      if (!code) return;
      const resp = await fetch("/api/lock/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      if (resp.ok) { window.location.reload(); }
      else { const d = await resp.json(); errorEl.textContent = d.error || "Invalid code"; errorEl.style.display = "block"; }
    });
  </script>
</body>
</html>`;
}

app.use(authMiddleware);

// Static files AFTER auth
app.use(express.static(path.join(__dirname, "public")));

// ===========================
// SETTINGS APIs
// ===========================

// --- Asset Classes ---
app.get("/api/settings/asset-classes", (req, res) => {
  res.json(db.prepare(`SELECT * FROM asset_classes ORDER BY sort_order, id`).all());
});

app.post("/api/settings/asset-classes", (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  const count = db.prepare(`SELECT COUNT(*) as c FROM asset_classes`).get().c;
  if (count >= 10) return res.status(400).json({ error: "Maximum 10 categories allowed." });
  try {
    const result = db.prepare(`INSERT INTO asset_classes (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM asset_classes))`).run(name.trim());
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: "Already exists." });
  }
});

app.put("/api/settings/asset-classes/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  const old = db.prepare(`SELECT name FROM asset_classes WHERE id = ?`).get(id);
  if (!old) return res.status(404).json({ error: "Not found." });

  db.transaction(() => {
    db.prepare(`UPDATE asset_classes SET name = ? WHERE id = ?`).run(name.trim(), id);
    // Propagate rename to all holdings
    db.prepare(`UPDATE holdings SET asset_class = ? WHERE asset_class = ?`).run(name.trim(), old.name);
  })();
  res.json({ success: true });
});

app.delete("/api/settings/asset-classes/:id", (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare(`SELECT name FROM asset_classes WHERE id = ?`).get(id);
  if (!item) return res.status(404).json({ error: "Not found." });
  const count = db.prepare(`SELECT COUNT(*) as c FROM holdings WHERE asset_class = ?`).get(item.name).c;
  if (count > 0) {
    return res.status(400).json({ error: `Cannot delete "${item.name}" — ${count} holdings use this category. Batch reassign them first.` });
  }
  db.prepare(`DELETE FROM asset_classes WHERE id = ?`).run(id);
  res.json({ success: true });
});

// --- Asset Types ---
app.get("/api/settings/asset-types", (req, res) => {
  res.json(db.prepare(`SELECT * FROM asset_types ORDER BY sort_order, id`).all());
});

app.post("/api/settings/asset-types", (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  const count = db.prepare(`SELECT COUNT(*) as c FROM asset_types`).get().c;
  if (count >= 10) return res.status(400).json({ error: "Maximum 10 types allowed." });
  try {
    const result = db.prepare(`INSERT INTO asset_types (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM asset_types))`).run(name.trim());
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: "Already exists." });
  }
});

app.put("/api/settings/asset-types/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  const old = db.prepare(`SELECT name FROM asset_types WHERE id = ?`).get(id);
  if (!old) return res.status(404).json({ error: "Not found." });

  db.transaction(() => {
    db.prepare(`UPDATE asset_types SET name = ? WHERE id = ?`).run(name.trim(), id);
    db.prepare(`UPDATE holdings SET asset_type = ? WHERE asset_type = ?`).run(name.trim(), old.name);
  })();
  res.json({ success: true });
});

app.delete("/api/settings/asset-types/:id", (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare(`SELECT name FROM asset_types WHERE id = ?`).get(id);
  if (!item) return res.status(404).json({ error: "Not found." });
  const count = db.prepare(`SELECT COUNT(*) as c FROM holdings WHERE asset_type = ?`).get(item.name).c;
  if (count > 0) {
    return res.status(400).json({ error: `Cannot delete "${item.name}" — ${count} holdings use this type. Batch reassign them first.` });
  }
  db.prepare(`DELETE FROM asset_types WHERE id = ?`).run(id);
  res.json({ success: true });
});

// --- Brokers ---
app.get("/api/settings/brokers", (req, res) => {
  res.json(db.prepare(`SELECT * FROM brokers ORDER BY sort_order, id`).all());
});

app.post("/api/settings/brokers", (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  try {
    const result = db.prepare(`INSERT INTO brokers (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM brokers))`).run(name.trim());
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: "Already exists." });
  }
});

app.put("/api/settings/brokers/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  const old = db.prepare(`SELECT name FROM brokers WHERE id = ?`).get(id);
  if (!old) return res.status(404).json({ error: "Not found." });

  db.transaction(() => {
    db.prepare(`UPDATE brokers SET name = ? WHERE id = ?`).run(name.trim(), id);
    db.prepare(`UPDATE holdings SET broker = ? WHERE broker = ?`).run(name.trim(), old.name);
  })();
  res.json({ success: true });
});

app.delete("/api/settings/brokers/:id", (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare(`SELECT name FROM brokers WHERE id = ?`).get(id);
  if (!item) return res.status(404).json({ error: "Not found." });
  const count = db.prepare(`SELECT COUNT(*) as c FROM holdings WHERE broker = ?`).get(item.name).c;
  if (count > 0) {
    return res.status(400).json({ error: `Cannot delete "${item.name}" — ${count} holdings use this broker. Batch reassign them first.` });
  }
  db.prepare(`DELETE FROM brokers WHERE id = ?`).run(id);
  res.json({ success: true });
});

// --- Ticker mapping ---
app.get("/api/settings/tickers", (req, res) => {
  res.json(db.prepare(`SELECT * FROM ticker_map ORDER BY asset_name`).all());
});

app.put("/api/settings/tickers", (req, res) => {
  const { asset_name, ticker } = req.body;
  if (!asset_name || !ticker) return res.status(400).json({ error: "Asset name and ticker are required." });
  db.prepare(`INSERT OR REPLACE INTO ticker_map (asset_name, ticker) VALUES (?, ?)`).run(asset_name.trim(), ticker.trim());
  // Also update holdings that have this asset name
  db.prepare(`UPDATE holdings SET ticker = ? WHERE name = ?`).run(ticker.trim(), asset_name.trim());
  res.json({ success: true });
});

app.delete("/api/settings/tickers/:name", (req, res) => {
  const assetName = req.params.name;
  const count = db.prepare(`SELECT COUNT(*) as c FROM holdings WHERE name = ?`).get(assetName).c;
  if (count > 0) {
    return res.status(400).json({ error: `Cannot delete — ${count} holdings use this ticker. Update the ticker value instead.` });
  }
  db.prepare(`DELETE FROM ticker_map WHERE asset_name = ?`).run(assetName);
  res.json({ success: true });
});

// ===========================
// HOLDINGS APIs
// ===========================

// Asset name autocomplete
app.get("/api/autocomplete/assets", (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  if (!q) return res.json([]);
  const rows = db.prepare(`SELECT DISTINCT name FROM holdings WHERE LOWER(name) LIKE ? ORDER BY name LIMIT 10`).all(`%${q}%`);
  res.json(rows.map(r => r.name));
});

// Get ticker for an asset name
app.get("/api/ticker-for-asset", (req, res) => {
  const name = (req.query.name || "").trim();
  if (!name) return res.json({ ticker: "" });
  const row = db.prepare(`SELECT ticker FROM ticker_map WHERE asset_name = ?`).get(name);
  res.json({ ticker: row ? row.ticker : "" });
});

// GET all holdings
app.get("/api/holdings", (req, res) => {
  let rows = db.prepare(`SELECT * FROM holdings ORDER BY date DESC, id DESC`).all();
  const { name, asset_class, asset_type, broker, currency } = req.query;

  if (name) rows = rows.filter(r => r.name.toLowerCase().includes(name.toLowerCase()));
  if (asset_class) rows = rows.filter(r => r.asset_class === asset_class);
  if (asset_type) rows = rows.filter(r => r.asset_type === asset_type);
  if (broker) rows = rows.filter(r => r.broker === broker);
  if (currency) rows = rows.filter(r => r.currency === currency);

  rows = rows.map(r => {
    // For sell transactions, no current value (units are gone)
    const isSell = r.txn_type === "sell";
    const current_value = (!isSell && r.current_price && r.quantity > 0) ? r.current_price * r.quantity : null;
    const gain_loss = current_value != null ? current_value - r.invested_amount : null;
    const gain_loss_pct = (gain_loss != null && r.invested_amount)
      ? (gain_loss / r.invested_amount * 100) : null;
    return { ...r, current_value, gain_loss, gain_loss_pct };
  });

  res.json(rows);
});

// POST new holding
app.post("/api/holdings", (req, res) => {
  const { date, name, asset_class, asset_type, broker, txn_type, buy_price, quantity, invested_amount, currency, notes, ticker, invested_base } = req.body;
  if (!isValidDate(date)) return res.status(400).json({ error: "Invalid date format (YYYY-MM-DD)." });
  if (!name || !asset_class) return res.status(400).json({ error: "Name and asset class are required." });

  const type = (txn_type || "buy").toLowerCase();
  // For sell transactions, store quantity and invested_amount as negative
  let qty = Number(quantity) || 0;
  let amt = Number(invested_amount) || 0;
  if (type === "sell") {
    qty = -Math.abs(qty);
    amt = -Math.abs(amt);
  }

  // Resolve ticker from ticker_map if not provided
  let resolvedTicker = (ticker || "").trim();
  if (!resolvedTicker) {
    const mapped = db.prepare(`SELECT ticker FROM ticker_map WHERE asset_name = ?`).get(name.trim());
    if (mapped) resolvedTicker = mapped.ticker;
  }

  // For foreign currency holdings, store the base-currency invested amount
  // If currency == default_currency, invested_base is same as invested_amount (not stored separately)
  // If no currency is configured (empty default), skip invested_base logic
  const defaultCur = getDefaultCurrency();
  const holdingCurrency = (currency || defaultCur || "").toUpperCase();
  let investedBase = null;
  if (defaultCur && holdingCurrency && holdingCurrency !== defaultCur && invested_base != null && invested_base !== "") {
    investedBase = type === "sell" ? -Math.abs(Number(invested_base)) : Number(invested_base) || null;
  }

  const result = db.prepare(`
    INSERT INTO holdings (date, name, asset_class, asset_type, broker, txn_type, buy_price, quantity, invested_amount, currency, notes, ticker, invested_base)
    VALUES (@date, @name, @asset_class, @asset_type, @broker, @txn_type, @buy_price, @quantity, @invested_amount, @currency, @notes, @ticker, @invested_base)
  `).run({
    date,
    name: name.trim(),
    asset_class: asset_class.trim(),
    asset_type: (asset_type || "").trim(),
    broker: (broker || "").trim(),
    txn_type: type,
    buy_price: Number(buy_price) || 0,
    quantity: qty,
    invested_amount: amt,
    currency: holdingCurrency,
    notes: (notes || "").trim(),
    ticker: resolvedTicker,
    invested_base: investedBase
  });

  // Auto-save ticker mapping if provided
  if (resolvedTicker) {
    db.prepare(`INSERT OR REPLACE INTO ticker_map (asset_name, ticker) VALUES (?, ?)`).run(name.trim(), resolvedTicker);
  }

  res.json({ id: result.lastInsertRowid });
});

// PUT update holding
app.put("/api/holdings/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM holdings WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: "Not found." });

  const { date, name, asset_class, asset_type, broker, txn_type, buy_price, quantity, invested_amount, currency, notes, ticker, invested_base } = req.body;
  if (!isValidDate(date)) return res.status(400).json({ error: "Invalid date format (YYYY-MM-DD)." });

  const type = (txn_type || existing.txn_type || "buy").toLowerCase();
  let qty = Number(quantity) || 0;
  let amt = Number(invested_amount) || 0;
  if (type === "sell") {
    qty = -Math.abs(qty);
    amt = -Math.abs(amt);
  }

  // For foreign currency holdings, store the base-currency invested amount
  const defaultCur = getDefaultCurrency();
  const holdingCurrency = (currency || defaultCur || "").toUpperCase();
  let investedBase = null;
  if (defaultCur && holdingCurrency && holdingCurrency !== defaultCur && invested_base != null && invested_base !== "") {
    investedBase = type === "sell" ? -Math.abs(Number(invested_base)) : Number(invested_base) || null;
  }

  db.prepare(`
    UPDATE holdings SET
      date = @date, name = @name, asset_class = @asset_class, asset_type = @asset_type,
      broker = @broker, txn_type = @txn_type, buy_price = @buy_price, quantity = @quantity, invested_amount = @invested_amount,
      currency = @currency, notes = @notes, ticker = @ticker, invested_base = @invested_base
    WHERE id = @id
  `).run({
    id,
    date,
    name: name.trim(),
    asset_class: asset_class.trim(),
    asset_type: (asset_type || "").trim(),
    broker: (broker || "").trim(),
    txn_type: type,
    buy_price: Number(buy_price) || 0,
    quantity: qty,
    invested_amount: amt,
    currency: holdingCurrency,
    notes: (notes || "").trim(),
    ticker: (ticker || "").trim(),
    invested_base: investedBase
  });

  res.json({ success: true });
});

// DELETE holding
app.delete("/api/holdings/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM holdings WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: "Not found." });
  db.prepare(`DELETE FROM holdings WHERE id = ?`).run(id);
  res.json({ success: true });
});

// --- Batch operations ---
app.post("/api/holdings/batch-update", (req, res) => {
  const { ids, updates } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "No IDs provided." });
  if (!updates || typeof updates !== "object") return res.status(400).json({ error: "No updates provided." });

  const allowedFields = ["asset_class", "asset_type", "broker", "currency", "name", "ticker"];
  const setClauses = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined && value !== null) {
      setClauses.push(`${key} = ?`);
      values.push(typeof value === "string" ? value.trim() : value);
    }
  }

  if (setClauses.length === 0) return res.status(400).json({ error: "No valid fields to update." });

  const placeholders = ids.map(() => "?").join(",");
  const sql = `UPDATE holdings SET ${setClauses.join(", ")} WHERE id IN (${placeholders})`;

  const stmt = db.prepare(sql);
  const result = stmt.run(...values, ...ids.map(Number));

  res.json({ success: true, updated: result.changes });
});

app.post("/api/holdings/batch-delete", (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "No IDs provided." });

  const placeholders = ids.map(() => "?").join(",");
  const result = db.prepare(`DELETE FROM holdings WHERE id IN (${placeholders})`).run(...ids.map(Number));

  res.json({ success: true, deleted: result.changes });
});

// --- Refresh prices for all holdings ---
app.post("/api/refresh-prices", async (req, res) => {
  // Clear session cache to force fresh exchange rates
  ratesSessionCache = {};

  const holdings = db.prepare(`SELECT DISTINCT name, ticker FROM holdings WHERE ticker != '' AND ticker IS NOT NULL`).all();
  const results = { updated: 0, failed: 0, details: [] };

  for (const h of holdings) {
    const price = await fetchPrice(h.ticker);
    if (price != null) {
      db.prepare(`UPDATE holdings SET current_price = ? WHERE name = ? AND ticker = ?`).run(price, h.name, h.ticker);
      results.updated++;
      results.details.push({ name: h.name, ticker: h.ticker, price });
    } else {
      results.failed++;
      results.details.push({ name: h.name, ticker: h.ticker, price: null, error: "Failed" });
    }
  }

  // Also refresh exchange rates
  const defaultCur = getDefaultCurrency();
  const foreign = getForeignCurrencies();
  const rates = {};
  for (const cur of foreign) {
    rates[cur] = await fetchExchangeRate(cur, defaultCur);
  }
  results.rates = rates;

  res.json(results);
});

// --- Fetch single price ---
app.get("/api/price/:ticker", async (req, res) => {
  const price = await fetchPrice(req.params.ticker);
  if (price != null) {
    res.json({ ticker: req.params.ticker, price });
  } else {
    res.status(404).json({ error: "Could not fetch price." });
  }
});

// --- USD/INR rate ---
app.get("/api/exchange-rate", async (req, res) => {
  const defaultCur = getDefaultCurrency();
  const rateDisplay = db.prepare(`SELECT value FROM settings WHERE key = 'rate_display'`).get();
  const displayCur = (rateDisplay && rateDisplay.value) || "";

  const rates = {};
  // Fetch the configured display rate
  if (displayCur && displayCur !== defaultCur) {
    rates[displayCur] = await fetchExchangeRate(displayCur, defaultCur);
  }
  // Also fetch rates for all foreign currencies in holdings (for conversion)
  const foreign = getForeignCurrencies();
  for (const cur of foreign) {
    if (!rates[cur]) {
      rates[cur] = await fetchExchangeRate(cur, defaultCur);
    }
  }

  res.json({ default_currency: defaultCur, rates, display_rate: displayCur });
});

// --- Settings: default currency ---
app.get("/api/settings/currency", (req, res) => {
  const defaultCur = getDefaultCurrency();
  const rateDisplay = db.prepare(`SELECT value FROM settings WHERE key = 'rate_display'`).get();
  const prevCurrency = db.prepare(`SELECT value FROM settings WHERE key = 'previous_default_currency'`).get();
  const prevRateDisplay = db.prepare(`SELECT value FROM settings WHERE key = 'previous_rate_display'`).get();
  // Check if multiple currencies exist in holdings
  const currencies = db.prepare(`SELECT DISTINCT currency FROM holdings WHERE currency != '' AND currency IS NOT NULL`).all().map(r => r.currency);
  res.json({
    default_currency: defaultCur,
    rate_display: (rateDisplay && rateDisplay.value) || "",
    previous_default_currency: (prevCurrency && prevCurrency.value) || "",
    previous_rate_display: (prevRateDisplay && prevRateDisplay.value) || "",
    holding_currencies: currencies
  });
});

app.put("/api/settings/currency", (req, res) => {
  const { currency, rate_display, save_previous } = req.body;

  // If disabling currency, save the current state for undo
  if (save_previous) {
    const currentCur = getDefaultCurrency();
    const currentRate = db.prepare(`SELECT value FROM settings WHERE key = 'rate_display'`).get();
    if (currentCur) {
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('previous_default_currency', ?)`).run(currentCur);
    }
    if (currentRate && currentRate.value) {
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('previous_rate_display', ?)`).run(currentRate.value);
    }
  }

  if (currency !== undefined) {
    const val = currency ? currency.toUpperCase() : "";
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('default_currency', ?)`).run(val);
  }
  if (rate_display !== undefined) {
    const val = rate_display ? rate_display.toUpperCase() : "";
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('rate_display', ?)`).run(val);
  }
  const cur = getDefaultCurrency();
  const rd = db.prepare(`SELECT value FROM settings WHERE key = 'rate_display'`).get();
  res.json({ success: true, default_currency: cur, rate_display: (rd && rd.value) || "" });
});

// Restore previous currency configuration
app.post("/api/settings/currency/restore", (req, res) => {
  const prevCurrency = db.prepare(`SELECT value FROM settings WHERE key = 'previous_default_currency'`).get();
  const prevRateDisplay = db.prepare(`SELECT value FROM settings WHERE key = 'previous_rate_display'`).get();

  if (!prevCurrency || !prevCurrency.value) {
    return res.status(400).json({ error: "No previous currency configuration to restore." });
  }

  // Restore currency settings
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('default_currency', ?)`).run(prevCurrency.value);
  if (prevRateDisplay && prevRateDisplay.value) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('rate_display', ?)`).run(prevRateDisplay.value);
  }

  // Clear the saved previous state
  db.prepare(`DELETE FROM settings WHERE key = 'previous_default_currency'`).run();
  db.prepare(`DELETE FROM settings WHERE key = 'previous_rate_display'`).run();

  res.json({ success: true, default_currency: prevCurrency.value, rate_display: (prevRateDisplay && prevRateDisplay.value) || "" });
});

// --- Summary API ---
app.get("/api/summary", async (req, res) => {
  const rows = db.prepare(`SELECT * FROM holdings`).all();
  const defaultCur = getDefaultCurrency();
  const rateData = await getAllRates();

  const summary = { by_class: {}, by_type: {}, total: { invested: 0, current_value: 0, gain_loss: 0, units: 0 }, default_currency: defaultCur, rates: rateData.rates };

  // Get configured display rate for the summary card
  const rateDisplay = db.prepare(`SELECT value FROM settings WHERE key = 'rate_display'`).get();
  const displayCur = (rateDisplay && rateDisplay.value) || "";
  let displayRate = null;
  if (displayCur && displayCur !== defaultCur) {
    displayRate = rateData.rates[displayCur] || await fetchExchangeRate(displayCur, defaultCur);
  }
  summary.display_rate = displayRate;
  summary.display_rate_currency = displayCur;

  for (const h of rows) {
    const cls = h.asset_class || "Other";
    if (!summary.by_class[cls]) {
      summary.by_class[cls] = { invested: 0, current_value: 0, gain_loss: 0, count: 0, units: 0 };
    }

    const typ = h.asset_type || "Other";
    if (!summary.by_type[typ]) {
      summary.by_type[typ] = { invested: 0, current_value: 0, count: 0 };
    }

    // Convert to default currency
    // For invested: use invested_base if available (actual base currency outflow), else convert via live rate
    const fx = h.currency === defaultCur ? 1 : (rateData.rates[h.currency] || 1);
    const invested = (h.invested_base != null) ? h.invested_base : (h.invested_amount || 0) * fx;
    const curVal = h.current_price ? h.current_price * h.quantity * fx : 0;

    summary.by_class[cls].invested += invested;
    summary.by_class[cls].current_value += curVal;
    summary.by_class[cls].gain_loss += curVal - invested;
    summary.by_class[cls].count++;
    summary.by_class[cls].units += h.quantity || 0;

    summary.by_type[typ].invested += invested;
    summary.by_type[typ].current_value += curVal;
    summary.by_type[typ].count++;

    summary.total.invested += invested;
    summary.total.current_value += curVal;
    summary.total.units += h.quantity || 0;
  }
  summary.total.gain_loss = summary.total.current_value - summary.total.invested;

  res.json(summary);
});

// --- Allocation breakdown ---
app.get("/api/allocation", async (req, res) => {
  const rows = db.prepare(`SELECT * FROM holdings`).all();
  const defaultCur = getDefaultCurrency();
  const rateData = await getAllRates();
  const map = {};

  for (const h of rows) {
    const fx = h.currency === defaultCur ? 1 : (rateData.rates[h.currency] || 1);
    const curVal = h.current_price ? h.current_price * h.quantity * fx : ((h.invested_base != null) ? h.invested_base : (h.invested_amount || 0) * fx);
    const key = h.name;
    if (!map[key]) map[key] = { name: key, asset_class: h.asset_class, value: 0 };
    map[key].value += curVal;
  }

  const items = Object.values(map).sort((a, b) => b.value - a.value);
  res.json(items);
});

// --- Detailed breakdown (hierarchical: class > asset name) ---
app.get("/api/breakdown", async (req, res) => {
  const rows = db.prepare(`SELECT * FROM holdings`).all();
  const defaultCur = getDefaultCurrency();
  const rateData = await getAllRates();

  const classes = {};

  for (const h of rows) {
    const cls = h.asset_class || "Other";
    if (!classes[cls]) classes[cls] = { asset_class: cls, invested: 0, current_value: 0, units: 0, count: 0, assets: {} };

    const fx = h.currency === defaultCur ? 1 : (rateData.rates[h.currency] || 1);
    // For invested: use invested_base if available (actual base currency outflow), else convert via live rate
    const invested = (h.invested_base != null) ? h.invested_base : (h.invested_amount || 0) * fx;
    const curVal = h.current_price ? h.current_price * h.quantity * fx : 0;
    const qty = h.quantity || 0;

    classes[cls].invested += invested;
    classes[cls].current_value += curVal;
    classes[cls].units += qty;
    classes[cls].count++;

    const assetKey = h.name;
    if (!classes[cls].assets[assetKey]) {
      classes[cls].assets[assetKey] = { name: assetKey, asset_type: h.asset_type, invested: 0, current_value: 0, units: 0, count: 0, current_price: null, currency: h.currency };
    }
    classes[cls].assets[assetKey].invested += invested;
    classes[cls].assets[assetKey].current_value += curVal;
    classes[cls].assets[assetKey].units += qty;
    classes[cls].assets[assetKey].count++;
    // Keep latest current_price (converted to default currency for display)
    if (h.current_price) {
      classes[cls].assets[assetKey].current_price = h.current_price * fx;
    }
  }

  // Convert assets map to sorted array
  const result = Object.values(classes).map(c => ({
    ...c,
    gain_loss: c.current_value - c.invested,
    assets: Object.values(c.assets).sort((a, b) => b.invested - a.invested).map(a => ({
      ...a,
      gain_loss: a.current_value - a.invested
    }))
  })).sort((a, b) => b.current_value - a.current_value);

  res.json({ classes: result, default_currency: defaultCur });
});

// --- Monthly investment data ---
app.get("/api/monthly-investments", async (req, res) => {
  const monthsParam = req.query.months;
  const months = monthsParam !== undefined ? Number(monthsParam) : 12;
  const defaultCur = getDefaultCurrency();
  const rateData = await getAllRates();

  // Get all holdings with their dates, amounts, and classes
  const rows = db.prepare(`SELECT date, invested_amount, invested_base, currency, current_price, quantity, asset_class FROM holdings ORDER BY date`).all();

  // Get all asset classes for consistent ordering
  const classesArr = db.prepare(`SELECT name FROM asset_classes ORDER BY sort_order, id`).all().map(r => r.name);

  // Group by month and asset class
  const monthMap = {};

  for (const h of rows) {
    const month = h.date.substring(0, 7); // YYYY-MM
    if (!monthMap[month]) {
      monthMap[month] = { total: 0, by_class: {} };
      classesArr.forEach(c => { monthMap[month].by_class[c] = 0; });
    }
    const fx = h.currency === defaultCur ? 1 : (rateData.rates[h.currency] || 1);
    // Use invested_base if available (actual base currency outflow), else convert via live rate
    const amt = (h.invested_base != null) ? h.invested_base : (h.invested_amount || 0) * fx;
    monthMap[month].total += amt;
    const cls = h.asset_class || "Other";
    monthMap[month].by_class[cls] = (monthMap[month].by_class[cls] || 0) + amt;
  }

  // Build sorted array of all months from first to current
  const allMonths = Object.keys(monthMap).sort();
  if (allMonths.length === 0) return res.json({ months: [], classes: classesArr, default_currency: defaultCur });

  const now = new Date();
  const currentMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const firstMonth = allMonths[0];

  const result = [];
  let cursor = new Date(firstMonth + "-01");
  const end = new Date(currentMonth + "-01");
  let cumInvested = 0;

  while (cursor <= end) {
    const key = cursor.getFullYear() + "-" + String(cursor.getMonth() + 1).padStart(2, "0");
    const entry = monthMap[key];
    const invested = entry ? entry.total : 0;
    cumInvested += invested;

    const byClass = {};
    classesArr.forEach(c => { byClass[c] = entry ? (entry.by_class[c] || 0) : 0; });

    result.push({ month: key, invested, cumulative_invested: cumInvested, by_class: byClass });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // Current portfolio value for the trend line
  const totalCurrentValue = rows.reduce((s, h) => {
    const fx = h.currency === defaultCur ? 1 : (rateData.rates[h.currency] || 1);
    return s + (h.current_price ? h.current_price * h.quantity * fx : 0);
  }, 0);

  // Slice to requested range
  const sliced = months === 0 ? result : result.slice(-months);

  res.json({ months: sliced, classes: classesArr, total_current_value: totalCurrentValue, default_currency: defaultCur });
});

// --- Lock APIs ---
app.get("/api/lock/status", (req, res) => {
  // If session is already authenticated, tell the frontend the app is unlocked
  if (req.session && req.session.authenticated) {
    return res.json({ locked: false });
  }
  const row = db.prepare("SELECT locked FROM app_lock WHERE id = 1").get();
  res.json({ locked: row ? Boolean(row.locked) : false });
});

app.get("/api/lock/config", (req, res) => {
  // Always returns the real lock configuration state (used by Settings tab)
  const row = db.prepare("SELECT locked FROM app_lock WHERE id = 1").get();
  res.json({ locked: row ? Boolean(row.locked) : false });
});

app.post("/api/lock/setup", (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
    return res.status(400).json({ error: "PIN must be exactly 6 digits." });
  }
  const recoveryCode = generateRecoveryCode();
  const pinHash = hashPin(pin);
  const recoveryHash = hashPin(recoveryCode);
  db.prepare("INSERT OR REPLACE INTO app_lock (id, pin_hash, recovery_hash, locked) VALUES (1, ?, ?, 1)").run(pinHash, recoveryHash);
  res.json({ success: true, recoveryCode });
});

app.post("/api/lock/unlock", (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: "PIN required." });
  const row = db.prepare("SELECT pin_hash FROM app_lock WHERE id = 1").get();
  if (!row) return res.status(404).json({ error: "No lock configured." });
  if (hashPin(pin) !== row.pin_hash) return res.status(401).json({ error: "Incorrect PIN." });
  req.session.authenticated = true;
  res.json({ success: true });
});

app.post("/api/lock/disable", (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: "PIN required." });
  const row = db.prepare("SELECT pin_hash FROM app_lock WHERE id = 1").get();
  if (!row) return res.status(404).json({ error: "No lock configured." });
  if (hashPin(pin) !== row.pin_hash) return res.status(401).json({ error: "Incorrect PIN." });
  db.prepare("DELETE FROM app_lock WHERE id = 1").run();
  res.json({ success: true });
});

app.post("/api/lock/recovery", (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Recovery code required." });
  const row = db.prepare("SELECT recovery_hash FROM app_lock WHERE id = 1").get();
  if (!row) return res.status(404).json({ error: "No lock configured." });
  if (hashPin(code.toUpperCase()) !== row.recovery_hash) return res.status(401).json({ error: "Invalid recovery code." });
  db.prepare("DELETE FROM app_lock WHERE id = 1").run();
  req.session.authenticated = true;
  res.json({ success: true });
});

app.post("/api/lock/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Failed to logout." });
    res.clearCookie("connect.sid");
    return res.json({ success: true });
  });
});

process.on("SIGINT", () => { db.close(); process.exit(0); });
process.on("SIGTERM", () => { db.close(); process.exit(0); });

app.listen(PORT, () => {
  console.log(`Finance Portfolio Tracker running at http://localhost:${PORT}`);
  console.log(`Database: ${dbPath}`);
});
