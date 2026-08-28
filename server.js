const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const compression = require("compression");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

const app = express();
const PORT = 3001;

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

//--- SQLite setup ---
const dbPath = path.join(dataDir, "portfolio.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

//--- Schema ---
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
    invested_base REAL,
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

  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    currency TEXT DEFAULT '',
    is_portfolio INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_lock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    pin_hash TEXT NOT NULL,
    recovery_hash TEXT NOT NULL,
    locked INTEGER NOT NULL DEFAULT 1
  );
`);

//--- New tables for realized P&L (FIFO) ---
db.exec(`
  CREATE TABLE IF NOT EXISTS realized_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_name TEXT NOT NULL,
    buy_id INTEGER,
    sell_id INTEGER,
    qty REAL NOT NULL,
    buy_price REAL,
    sell_price REAL,
    cost REAL NOT NULL,
    proceeds REAL NOT NULL,
    gain REAL NOT NULL,
    buy_date TEXT,
    sell_date TEXT,
    holding_days INTEGER,
    gain_type TEXT
  );
  CREATE TABLE IF NOT EXISTS closed_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    asset_class TEXT NOT NULL,
    asset_type TEXT DEFAULT '',
    broker TEXT DEFAULT '',
    currency TEXT DEFAULT 'INR',
    ticker TEXT DEFAULT '',
    total_qty REAL NOT NULL,
    total_cost REAL NOT NULL,
    total_proceeds REAL NOT NULL,
    realized_gain REAL NOT NULL,
    open_date TEXT,
    close_date TEXT,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
try { db.exec("ALTER TABLE holdings ADD COLUMN ticker TEXT DEFAULT '';"); } catch (e) {}
try { db.exec("ALTER TABLE holdings ADD COLUMN txn_type TEXT DEFAULT 'buy';"); } catch (e) {}
try { db.exec("ALTER TABLE holdings ADD COLUMN invested_base REAL;"); } catch (e) {}
try { db.exec("ALTER TABLE asset_classes ADD COLUMN color TEXT DEFAULT '';"); } catch (e) {}

// Seed default settings
const defaultCurrSetting = db.prepare("SELECT value FROM settings WHERE key = 'default_currency'").get();
if (!defaultCurrSetting) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('default_currency', '')").run();
}
const rateDisplaySetting = db.prepare("SELECT value FROM settings WHERE key = 'rate_display'").get();
if (!rateDisplaySetting) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('rate_display', '')").run();
}
const dateFormatSetting = db.prepare("SELECT value FROM settings WHERE key = 'date_format'").get();
if (!dateFormatSetting) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('date_format', 'MM/DD/YYYY')").run();
}

// Seed defaults if empty
const classCount = db.prepare("SELECT COUNT(*) as c FROM asset_classes").get().c;
if (classCount === 0) {
  const insertClass = db.prepare("INSERT OR IGNORE INTO asset_classes (name, sort_order) VALUES (?, ?)");
  const defaults = ["Indian Stock", "Indian Mutual Fund", "US Stock", "Crypto", "ETF", "Bond", "Gold"];
  defaults.forEach((name, i) => insertClass.run(name, i));
}

const typeCount = db.prepare("SELECT COUNT(*) as c FROM asset_types").get().c;
if (typeCount === 0) {
  const insertType = db.prepare("INSERT OR IGNORE INTO asset_types (name, sort_order) VALUES (?, ?)");
  ["Stocks", "Mutual Fund", "Shares", "Cryptocurrency", "ETF", "Bond", "Commodity"].forEach((name, i) => insertType.run(name, i));
}

const brokerCount = db.prepare("SELECT COUNT(*) as c FROM brokers").get().c;
if (brokerCount === 0) {
  const insertBroker = db.prepare("INSERT OR IGNORE INTO brokers (name, sort_order) VALUES (?, ?)");
  const existingBrokers = db.prepare("SELECT DISTINCT broker FROM holdings WHERE broker != ''").all();
  existingBrokers.forEach((row, i) => insertBroker.run(row.broker, i));
  if (existingBrokers.length === 0) {
    ["Zerodha", "Groww", "INDmoney", "SBI Direct", "Coin by Zerodha"].forEach((name, i) => insertBroker.run(name, i));
  }
}

//--- Helpers ---
const BCRYPT_ROUNDS = 10;

async function hashPin(pin) {
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

async function verifyPin(pin, hash) {
  // Support legacy SHA-256 hashes (migration path)
  if (hash && hash.length === 64 && /^[a-f0-9]{64}$/.test(hash)) {
    const sha256 = crypto.createHash("sha256").update(pin).digest("hex");
    return sha256 === hash;
  }
  return bcrypt.compare(pin, hash);
}

function generateRecoveryCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

//--- FIFO / Realized P&L helpers ---
const EPSILON_QTY = 1e-6;

function getBaseInvestedForRow(row, fxMap, defaultCur) {
  if (row.invested_base != null) return row.invested_base;
  const fx = row.currency === defaultCur ? 1 : (fxMap[row.currency] || 1);
  return (row.invested_amount || 0) * fx;
}

function rebuildAssetLots(assetName) {
  db.prepare("DELETE FROM realized_lots WHERE asset_name = ?").run(assetName);
  db.prepare("DELETE FROM closed_positions WHERE name = ?").run(assetName);
  const rows = db.prepare("SELECT * FROM holdings WHERE name = ? ORDER BY date ASC, id ASC").all(assetName);
  if (rows.length === 0) return;
  const defaultCur = getDefaultCurrency();
  // Build fx map from cached rates synchronously (fallback 1)
  const fxMap = {};
  // Use session cache if available; otherwise assume 1 (INR holdings unaffected)
  for (const k of Object.keys(ratesSessionCache)) {
    // keys are like "USDINR" — extract fromCurrency
    // We stored ratesSessionCache as key `${from}${to}` -> rate
    // For holdings we need rate fromCurrency->defaultCur, so reverse lookup by suffix
    if (k.endsWith(defaultCur)) {
      const from = k.slice(0, k.length - defaultCur.length);
      fxMap[from] = ratesSessionCache[k];
    }
  }
  // Queue of buys with remaining qty
  const buyQueue = [];
  for (const r of rows) {
    if ((r.txn_type || 'buy') === 'buy' && (r.quantity || 0) > 0) {
      const totalCost = getBaseInvestedForRow(r, fxMap, defaultCur);
      const qty = r.quantity;
      const costPerUnit = qty !== 0 ? totalCost / qty : 0;
      buyQueue.push({ id: r.id, date: r.date, qty, remaining: qty, costPerUnit, totalCost, asset_class: r.asset_class, asset_type: r.asset_type, broker: r.broker, currency: r.currency, ticker: r.ticker, buy_price: r.buy_price });
    }
  }
  const sells = rows.filter(r => (r.txn_type || 'buy') === 'sell' && (r.quantity || 0) < 0).sort((a,b) => a.date.localeCompare(b.date) || a.id - b.id);
  let totalProceeds = 0;
  let totalCostMatched = 0;
  const insertLot = db.prepare("INSERT INTO realized_lots (asset_name, buy_id, sell_id, qty, buy_price, sell_price, cost, proceeds, gain, buy_date, sell_date, holding_days, gain_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const sell of sells) {
    const sellQty = Math.abs(sell.quantity || 0);
    const sellTotalBase = Math.abs(getBaseInvestedForRow(sell, fxMap, defaultCur));
    // Proceeds: prefer sell buy_price (sell NAV) if set, else fallback to invested amount
    const pricePerUnit = Math.abs(sell.buy_price) || 0;
    const investedPerUnit = sellQty !== 0 && sellTotalBase !== 0 ? sellTotalBase / sellQty : 0;
    // If buy_price is close to investedPerUnit, it means user entered cost as invested; use buy_price if it looks like NAV (diff >1%)
    let proceedsPerUnit = 0;
    if (pricePerUnit > 0 && Math.abs(pricePerUnit - investedPerUnit) > 0.01) {
      proceedsPerUnit = pricePerUnit;
    } else if (pricePerUnit > 0) {
      proceedsPerUnit = pricePerUnit;
    } else {
      proceedsPerUnit = investedPerUnit;
    }
    let remainingSellQty = sellQty;
    totalProceeds += proceedsPerUnit * sellQty;
    while (remainingSellQty > EPSILON_QTY && buyQueue.length > 0) {
      const buy = buyQueue[0];
      const take = Math.min(buy.remaining, remainingSellQty);
      const cost = take * buy.costPerUnit;
      const proceeds = take * proceedsPerUnit;
      const gain = proceeds - cost;
      const holdingDays = Math.floor((new Date(sell.date) - new Date(buy.date)) / (1000*60*60*24));
      const gainType = holdingDays > 365 ? 'LTCG' : 'STCG';
      // For equity MF Indian, threshold is 12 months; we use 365 as proxy. LTCG/STCG label is indicative.
      insertLot.run(assetName, buy.id, sell.id, take, buy.costPerUnit, proceedsPerUnit, cost, proceeds, gain, buy.date, sell.date, holdingDays, gainType);
      totalCostMatched += cost;
      buy.remaining -= take;
      remainingSellQty -= take;
      if (buy.remaining <= EPSILON_QTY) buyQueue.shift();
    }
    // If sells exceed buys (short), remaining qty is ignored for lots — gain already counted with no cost
    if (remainingSellQty > EPSILON_QTY) {
      const gain = remainingSellQty * proceedsPerUnit;
      const holdingDays = 0;
      insertLot.run(assetName, null, sell.id, remainingSellQty, 0, proceedsPerUnit, 0, remainingSellQty * proceedsPerUnit, gain, null, sell.date, holdingDays, 'STCG');
      totalCostMatched += 0;
    }
  }
  // Determine if closed (net qty ~0)
  const netQty = rows.reduce((s, r) => s + (r.quantity || 0), 0);
  if (Math.abs(netQty) < EPSILON_QTY && sells.length > 0) {
    const buys = rows.filter(r => (r.txn_type || 'buy') !== 'sell');
    const totalQty = buys.reduce((s, r) => s + Math.abs(r.quantity || 0), 0);
    const totalCost = buys.reduce((s, r) => s + Math.abs(getBaseInvestedForRow(r, fxMap, defaultCur)), 0);
    // Use sell sum as proceeds if lots total differs due to zero-cost sells
    const realizedGain = db.prepare("SELECT COALESCE(SUM(gain),0) as g FROM realized_lots WHERE asset_name = ?").get(assetName).g;
    const assetRow = buys[0] || sells[0];
    const openDate = buys.length ? buys[0].date : sells[0].date;
    const closeDate = sells[sells.length-1].date;
    db.prepare("INSERT OR REPLACE INTO closed_positions (name, asset_class, asset_type, broker, currency, ticker, total_qty, total_cost, total_proceeds, realized_gain, open_date, close_date, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(assetName, assetRow.asset_class || 'Other', assetRow.asset_type || '', assetRow.broker || '', assetRow.currency || 'INR', assetRow.ticker || '', totalQty, totalCost, totalCost + realizedGain, realizedGain, openDate, closeDate, '');
  }
}

function rebuildAllLots() {
  const names = db.prepare("SELECT DISTINCT name FROM holdings").all().map(r => r.name);
  for (const n of names) rebuildAssetLots(n);
  // Cleanup orphan closed_positions (asset no longer has sells)
  const closedNames = db.prepare("SELECT name FROM closed_positions").all().map(r => r.name);
  for (const n of closedNames) {
    const holdings = db.prepare("SELECT * FROM holdings WHERE name = ?").all(n);
    const netQty = holdings.reduce((s, r) => s + (r.quantity || 0), 0);
    if (Math.abs(netQty) >= EPSILON_QTY) {
      db.prepare("DELETE FROM closed_positions WHERE name = ?").run(n);
    }
  }
}

// --- Persistent session secret ---
const secretPath = path.join(dataDir, "session-secret.key");
let SESSION_SECRET;
if (fs.existsSync(secretPath)) {
  SESSION_SECRET = fs.readFileSync(secretPath, "utf-8").trim();
} else {
  SESSION_SECRET = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretPath, SESSION_SECRET, "utf-8");
}

// --- Price refresh TTL ---
let lastPriceRefreshTime = 0;
const PRICE_REFRESH_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// --- Watchlist price cache (in-memory with TTL) ---
const WATCHLIST_PRICE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const watchlistPriceCache = {}; // { ticker: { data, timestamp } }

function getCachedQuote(ticker) {
  const entry = watchlistPriceCache[ticker.toUpperCase()];
  if (entry && (Date.now() - entry.timestamp < WATCHLIST_PRICE_CACHE_TTL_MS)) {
    return entry.data;
  }
  return null;
}

function setCachedQuote(ticker, data) {
  watchlistPriceCache[ticker.toUpperCase()] = { data, timestamp: Date.now() };
}

// Legacy helper for non-watchlist use (just returns price)
function getCachedPrice(ticker) {
  const quote = getCachedQuote(ticker);
  return quote ? quote.price : null;
}

function setCachedPrice(ticker, price) {
  setCachedQuote(ticker, { price, day_change: 0, day_change_pct: 0 });
}

let yfInstance = null;
let ratesSessionCache = {};
const RATES_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let ratesCacheTimestamp = 0;

function getDefaultCurrency() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'default_currency'").get();
  return (row && row.value) || "";
}

async function getYF() {
  if (yfInstance) return yfInstance;
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default || mod;
    if (typeof YahooFinance === "function" && YahooFinance.prototype) {
      yfInstance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    } else if (YahooFinance.quote) {
      yfInstance = YahooFinance;
    } else if (typeof YahooFinance === "function") {
      yfInstance = YahooFinance({ suppressNotices: ['yahooSurvey'] });
    } else {
      yfInstance = YahooFinance;
    }
    return yfInstance;
  } catch (e) {
    console.error("Failed to initialize yahoo-finance2:", e.message);
    return null;
  }
}

async function fetchExchangeRate(fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return 1;
  const key = `${fromCurrency}${toCurrency}`;
  // Return cached rate if still fresh
  if (ratesSessionCache[key] && (Date.now() - ratesCacheTimestamp < RATES_CACHE_TTL_MS)) {
    return ratesSessionCache[key];
  }
  try {
    const yf = await getYF();
    if (!yf) return ratesSessionCache[key] || 1;
    const ticker = `${fromCurrency}${toCurrency}=X`;
    const result = await yf.quote(ticker);
    if (result && result.regularMarketPrice) {
      ratesSessionCache[key] = result.regularMarketPrice;
      ratesCacheTimestamp = Date.now();
      return result.regularMarketPrice;
    }
  } catch (e) {
    console.error(`Failed to fetch ${fromCurrency} to ${toCurrency} rate:`, e.message);
  }
  return ratesSessionCache[key] || 1;
}

function getForeignCurrencies() {
  const defaultCur = getDefaultCurrency();
  const rows = db.prepare("SELECT DISTINCT currency FROM holdings WHERE currency != ? AND currency IS NOT NULL").all(defaultCur);
  return rows.map(r => r.currency);
}

async function getAllRates() {
  const defaultCur = getDefaultCurrency();
  const foreign = getForeignCurrencies();
  const rates = {};
  for (const cur of foreign) {
    rates[cur] = await fetchExchangeRate(cur, defaultCur);
  }
  return { default_currency: defaultCur, rates };
}

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

// Fetch full quote data including day change for watchlist
async function fetchQuoteData(ticker) {
  if (!ticker) return null;
  try {
    const yf = await getYF();
    if (!yf) return null;
    const result = await yf.quote(ticker);
    if (result && result.regularMarketPrice) {
      return {
        price: result.regularMarketPrice,
        day_change: result.regularMarketChange || 0,
        day_change_pct: result.regularMarketChangePercent || 0
      };
    }
  } catch (e) {
    console.error(`Failed to fetch quote for ${ticker}:`, e.message);
  }
  return null;
}

function isValidDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// Backfill lots after all helpers are defined (deferred to avoid TDZ on ratesSessionCache)
setImmediate(() => { try { rebuildAllLots(); } catch(e) { console.error("rebuildAllLots startup error:", e.message); } });

//--- Async route wrapper (fix #1.1) ---
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

app.use(express.json());

// Session Setup
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false, sameSite: "strict", maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// --- CSRF Protection ---
const CSRF_EXEMPT_PATHS = [
  "/api/lock/status",
  "/api/lock/unlock",
  "/api/lock/recovery",
  "/api/lock/setup",
  "/api/lock/disable",
  "/api/csrf-token"
];

function csrfTokenMiddleware(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  next();
}

function csrfProtectionMiddleware(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  if (CSRF_EXEMPT_PATHS.includes(req.path)) return next();
  const token = req.headers["x-csrf-token"];
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({ error: "Invalid CSRF token. Please refresh and try again." });
  }
  next();
}

function authMiddleware(req, res, next) {
  const openPaths = [
  "/api/lock/status",
  "/api/lock/unlock",
  "/api/lock/recovery",
  "/api/lock/setup",
  "/api/lock/disable",
  "/manifest.json",
  "/sw.js",
  "/favicon.svg",
  "/favicon-32.png",
  "/favicon-16.png",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png"
];
  // CSRF token endpoint is always open (before auth)
  if (req.path === "/api/csrf-token") {
    return next();
  }

  if (openPaths.includes(req.path)) {
    return next();
  }
  const lockRow = db.prepare("SELECT id FROM app_lock WHERE id = 1").get();
  if (!lockRow) {
    return next();
  }
  if (req.session && req.session.authenticated) {
    return next();
  }
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Unauthorized. Please unlock the app first." });
  }
  return res.send(getLoginPage());
}

function getLoginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Invest More Locked</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{ margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5efe6; display: flex; align-items: center; justify-content: center; min-height: 100vh; -webkit-font-smoothing: antialiased; }
  @media (prefers-color-scheme: dark) { body { background: #000000; } .lock-modal { background: #000000; border-color: #232323; } h2 { color: #e4e4e4; } .subtitle { color: #6a6a6a; } input[type="password"], input[type="text"] { background: #000000; border-color: #232323; color: #e4e4e4; } input:focus { border-color: #f5f5f5; box-shadow: 0 0 0 2px rgba(255,255,255,0.14); } button { background: #f5f5f5; color: #000000; } button:hover { opacity: 0.85; background: #f5f5f5; } .error { color: #f87171; } .recovery-link a { color: #f5f5f5; } }
  .lock-modal { background: #fdfbf7; border: 1px solid #e8ddd0; border-radius: 12px; padding: 36px 32px; width: 100%; max-width: 340px; text-align: center; }
  h2 { margin-bottom: 6px; font-size: 0.92rem; font-weight: 700; color: #1a1a1a; }
  .subtitle { color: #aaa; font-size: 0.72rem; margin: 0 0 18px; }
  input[type="password"], input[type="text"] { display: block; width: 100%; text-align: center; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 1.2rem; letter-spacing: 0.3em; margin-bottom: 10px; padding: 8px; border: 1px solid #e8ddd0; border-radius: 5px; background: #f5efe6; color: #2c241b; outline: none; transition: border-color 0.15s; }
  input:focus { border-color: #111; box-shadow: 0 0 0 2px rgba(0,0,0,0.1); }
  button { width: 100%; padding: 8px 16px; background: #111; color: #fff; border: none; border-radius: 5px; font-size: 0.76rem; font-weight: 550; cursor: pointer; margin-bottom: 8px; min-height: 34px; font-family: inherit; transition: opacity 0.15s; }
  button:hover { opacity: 0.85; }
  .error { color: #c53030; font-size: 0.72rem; display: none; margin: 6px 0; }
  .recovery-link { font-size: 0.72rem; margin-top: 6px; }
  .recovery-link a { color: #111; font-weight: 600; text-decoration: none; cursor: pointer; }
  .recovery-link a:hover { text-decoration: underline; }
  .recovery-section { display: none; margin-top: 10px; }
</style>
</head>
<body>
<div class="lock-modal">
  <h2>Invest More Locked</h2>
  <p class="subtitle">Enter your 6-digit PIN to access the app.</p>
  <input type="password" id="pin" maxlength="6" inputmode="numeric" pattern="[0-9]*" placeholder="••••••" autofocus />
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

app.use(csrfTokenMiddleware);

// CSRF token endpoint — returns the current session's CSRF token
// Must be registered after csrfTokenMiddleware so the token is initialized
app.get("/api/csrf-token", (req, res) => {
  return res.json({ token: req.session.csrfToken || "" });
});

app.use(csrfProtectionMiddleware);
app.use(authMiddleware);
app.use(compression());
app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html") || filePath.endsWith(".js") || filePath.endsWith(".css")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  }
}));

// --- SETTINGS APIS ---
app.get("/api/settings/asset-classes", (req, res) => {
  res.json(db.prepare("SELECT * FROM asset_classes ORDER BY sort_order, id").all());
});

app.post("/api/settings/asset-classes", (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  const count = db.prepare("SELECT COUNT(*) as c FROM asset_classes").get().c;
  if (count >= 10) return res.status(400).json({ error: "Maximum 10 categories allowed." });
  try {
    const result = db.prepare("INSERT INTO asset_classes (name, color, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM asset_classes))").run(name.trim(), color || '');
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: "Already exists." });
  }
});

app.put("/api/settings/asset-classes/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, color } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  const old = db.prepare("SELECT name FROM asset_classes WHERE id = ?").get(id);
  if (!old) return res.status(404).json({ error: "Not found." });

  db.transaction(() => {
    db.prepare("UPDATE asset_classes SET name = ?, color = ? WHERE id = ?").run(name.trim(), color || '', id);
    db.prepare("UPDATE holdings SET asset_class = ? WHERE asset_class = ?").run(name.trim(), old.name);
  })();
  res.json({ success: true });
});

app.delete("/api/settings/asset-classes/:id", (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare("SELECT name FROM asset_classes WHERE id = ?").get(id);
  if (!item) return res.status(404).json({ error: "Not found." });
  const count = db.prepare("SELECT COUNT(*) as c FROM holdings WHERE asset_class = ?").get(item.name).c;
  if (count > 0) {
    return res.status(400).json({ error: `Cannot delete "${item.name}" - ${count} holdings use this category. Batch reassign them first.` });
  }
  db.prepare("DELETE FROM asset_classes WHERE id = ?").run(id);
  res.json({ success: true });
});

//--- Asset Types ---
app.get("/api/settings/asset-types", (req, res) => {
  res.json(db.prepare("SELECT * FROM asset_types ORDER BY sort_order, id").all());
});

app.post("/api/settings/asset-types", (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  const count = db.prepare("SELECT COUNT(*) as c FROM asset_types").get().c;
  if (count >= 10) return res.status(400).json({ error: "Maximum 10 types allowed." });
  try {
    const result = db.prepare("INSERT INTO asset_types (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM asset_types))").run(name.trim());
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: "Already exists." });
  }
});

app.put("/api/settings/asset-types/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  const old = db.prepare("SELECT name FROM asset_types WHERE id = ?").get(id);
  if (!old) return res.status(404).json({ error: "Not found." });

  db.transaction(() => {
    db.prepare("UPDATE asset_types SET name = ? WHERE id = ?").run(name.trim(), id);
    db.prepare("UPDATE holdings SET asset_type = ? WHERE asset_type = ?").run(name.trim(), old.name);
  })();
  res.json({ success: true });
});

app.delete("/api/settings/asset-types/:id", (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare("SELECT name FROM asset_types WHERE id = ?").get(id);
  if (!item) return res.status(404).json({ error: "Not found." });
  const count = db.prepare("SELECT COUNT(*) as c FROM holdings WHERE asset_type = ?").get(item.name).c;
  if (count > 0) {
    return res.status(400).json({ error: `Cannot delete "${item.name}" - ${count} holdings use this type. Batch reassign them first.` });
  }
  db.prepare("DELETE FROM asset_types WHERE id = ?").run(id);
  res.json({ success: true });
});

//--- Brokers ---
app.get("/api/settings/brokers", (req, res) => {
  res.json(db.prepare("SELECT * FROM brokers ORDER BY sort_order, id").all());
});

app.post("/api/settings/brokers", (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  try {
    const result = db.prepare("INSERT INTO brokers (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM brokers))").run(name.trim());
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: "Already exists." });
  }
});

app.put("/api/settings/brokers/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  const old = db.prepare("SELECT name FROM brokers WHERE id = ?").get(id);
  if (!old) return res.status(404).json({ error: "Not found." });

  db.transaction(() => {
    db.prepare("UPDATE brokers SET name = ? WHERE id = ?").run(name.trim(), id);
    db.prepare("UPDATE holdings SET broker = ? WHERE broker = ?").run(name.trim(), old.name);
  })();
  res.json({ success: true });
});

app.delete("/api/settings/brokers/:id", (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare("SELECT name FROM brokers WHERE id = ?").get(id);
  if (!item) return res.status(404).json({ error: "Not found." });
  const count = db.prepare("SELECT COUNT(*) as c FROM holdings WHERE broker = ?").get(item.name).c;
  if (count > 0) {
    return res.status(400).json({ error: `Cannot delete "${item.name}" - ${count} holdings use this broker. Batch reassign them first.` });
  }
  db.prepare("DELETE FROM brokers WHERE id = ?").run(id);
  res.json({ success: true });
});

//--- Ticker mapping ---
app.get("/api/settings/tickers", (req, res) => {
  res.json(db.prepare("SELECT * FROM ticker_map ORDER BY asset_name").all());
});

app.put("/api/settings/tickers", (req, res) => {
  const { asset_name, ticker } = req.body;
  if (!asset_name || !ticker) return res.status(400).json({ error: "Asset name and ticker are required." });
  db.prepare("INSERT OR REPLACE INTO ticker_map (asset_name, ticker) VALUES (?, ?)").run(asset_name.trim(), ticker.trim());
  db.prepare("UPDATE holdings SET ticker = ? WHERE name = ?").run(ticker.trim(), asset_name.trim());
  res.json({ success: true });
});

app.delete("/api/settings/tickers/:name", (req, res) => {
  const assetName = req.params.name;
  const count = db.prepare("SELECT COUNT(*) as c FROM holdings WHERE name = ?").get(assetName).c;
  if (count > 0) {
    return res.status(400).json({ error: `Cannot delete - ${count} holdings use this ticker. Update the ticker value instead.` });
  }
  db.prepare("DELETE FROM ticker_map WHERE asset_name = ?").run(assetName);
  res.json({ success: true });
});

// --- HOLDINGS APIS ---
app.get("/api/autocomplete/assets", (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  if (!q) return res.json([]);
  const rows = db.prepare("SELECT DISTINCT name FROM holdings WHERE LOWER(name) LIKE ? ORDER BY name LIMIT 10").all(`%${q}%`);
  res.json(rows.map(r => r.name));
});

app.get("/api/assets/names", (req, res) => {
  const rows = db.prepare("SELECT DISTINCT name, COUNT(*) as count FROM holdings GROUP BY name ORDER BY name").all();
  res.json(rows);
});

app.get("/api/ticker-for-asset", (req, res) => {
  const name = (req.query.name || "").trim();
  if (!name) return res.json({ ticker: "" });
  const row = db.prepare("SELECT ticker FROM ticker_map WHERE asset_name = ?").get(name);
  res.json({ ticker: row ? row.ticker : "" });
});

// GET single holding by ID (fix #1.11)
app.get("/api/holdings/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM holdings WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const isSell = row.txn_type === "sell";
  const current_value = (!isSell && row.current_price && row.quantity > 0) ? (row.current_price * row.quantity) : null;
  const gain_loss = current_value != null ? (current_value - row.invested_amount) : null;
  const gain_loss_pct = (gain_loss != null && row.invested_amount) ? (gain_loss / row.invested_amount * 100) : null;
  res.json({ ...row, current_value, gain_loss, gain_loss_pct });
});

app.get("/api/holdings", (req, res) => {
  let rows = db.prepare("SELECT * FROM holdings ORDER BY date DESC, id DESC").all();

  const {
    name,
    year,
    month,
    asset_class,
    asset_type,
    broker,
    currency
  } = req.query;

  if (name) rows = rows.filter(r => r.name.toLowerCase().includes(name.toLowerCase()));

  if (year) {
    rows = rows.filter(r => r.date && r.date.substring(0, 4) === year);
  }

  if (month) {
    rows = rows.filter(r => r.date && r.date.substring(5, 7) === month);
  }

  if (asset_class) rows = rows.filter(r => r.asset_class === asset_class);
  if (asset_type) rows = rows.filter(r => r.asset_type === asset_type);
  if (broker) rows = rows.filter(r => r.broker === broker);
  if (currency) rows = rows.filter(r => r.currency === currency);

  rows = rows.map(r => {
    const isSell = r.txn_type === "sell";
    const current_value = (!isSell && r.current_price && r.quantity > 0) ? (r.current_price * r.quantity) : null;
    const gain_loss = current_value != null ? (current_value - r.invested_amount) : null;
    const gain_loss_pct = (gain_loss != null && r.invested_amount) ? (gain_loss / r.invested_amount * 100) : null;
    return { ...r, current_value, gain_loss, gain_loss_pct };
  });
  res.json(rows);
});

app.post("/api/holdings", (req, res) => {
  const { date, name, asset_class, asset_type, broker, txn_type, buy_price, quantity, invested_amount, currency, notes, ticker, invested_base } = req.body;
  if (!isValidDate(date)) return res.status(400).json({ error: "Invalid date format (YYYY-MM-DD)." });
  if (!name || !asset_class) return res.status(400).json({ error: "Name and asset class are required." });

  const type = (txn_type || "buy").toLowerCase();
  let qty = Number(quantity) || 0;
  let amt = Number(invested_amount) || 0;
  if (type === "sell") {
    qty = -Math.abs(qty);
    amt = -Math.abs(amt);
  }

  let resolvedTicker = (ticker || "").trim();
  if (!resolvedTicker) {
    const mapped = db.prepare("SELECT ticker FROM ticker_map WHERE asset_name = ?").get(name.trim());
    if (mapped) resolvedTicker = mapped.ticker;
  }

  const defaultCur = getDefaultCurrency();
  const holdingCurrency = (currency || defaultCur || "INR").toUpperCase();
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

  if (resolvedTicker) {
    db.prepare("INSERT OR REPLACE INTO ticker_map (asset_name, ticker) VALUES (?, ?)").run(name.trim(), resolvedTicker);
  }

  try { rebuildAssetLots(name.trim()); } catch(e) { console.error("rebuildAssetLots:", e.message); }
  res.json({ id: result.lastInsertRowid });
});

app.put("/api/holdings/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM holdings WHERE id = ?").get(id);
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

  const defaultCur = getDefaultCurrency();
  const holdingCurrency = (currency || defaultCur || "INR").toUpperCase();
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
    id, date,
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

  try {
    rebuildAssetLots(name.trim());
    if (existing.name !== name.trim()) rebuildAssetLots(existing.name);
  } catch(e) { console.error("rebuildAssetLots:", e.message); }
  res.json({ success: true });
});

app.delete("/api/holdings/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM holdings WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM holdings WHERE id = ?").run(id);
  try { rebuildAssetLots(existing.name); } catch(e) { console.error("rebuildAssetLots:", e.message); }
  res.json({ success: true });
});

// --- Copy Transaction (duplicate with today's date) ---
app.post("/api/holdings/:id/copy", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM holdings WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Not found." });

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const result = db.prepare(`
    INSERT INTO holdings (date, name, asset_class, asset_type, broker, txn_type, buy_price, quantity, invested_amount, currency, notes, ticker, invested_base)
    VALUES (@date, @name, @asset_class, @asset_type, @broker, @txn_type, @buy_price, @quantity, @invested_amount, @currency, @notes, @ticker, @invested_base)
  `).run({
    date: today,
    name: existing.name,
    asset_class: existing.asset_class,
    asset_type: existing.asset_type || "",
    broker: existing.broker || "",
    txn_type: existing.txn_type || "buy",
    buy_price: existing.buy_price || 0,
    quantity: existing.quantity || 0,
    invested_amount: existing.invested_amount || 0,
    currency: existing.currency || "INR",
    notes: existing.notes || "",
    ticker: existing.ticker || "",
    invested_base: existing.invested_base
  });

  try { rebuildAssetLots(existing.name); } catch(e) { console.error("rebuildAssetLots:", e.message); }
  res.json({ id: result.lastInsertRowid });
});

//--- Batch Operations ---
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
  const safeIds = ids.map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (safeIds.length === 0) return res.status(400).json({ error: "No valid IDs." });
  const placeholders = safeIds.map(() => "?").join(",");
  const sql = `UPDATE holdings SET ${setClauses.join(", ")} WHERE id IN (${placeholders})`;
  const stmt = db.prepare(sql);
  const result = stmt.run(...values, ...safeIds);
  try {
    const names = db.prepare(`SELECT DISTINCT name FROM holdings WHERE id IN (${safeIds.map(() => "?").join(",")})`).all(...safeIds).map(r=>r.name);
    // Also need to handle rename case via updates.name
    const affected = new Set(names);
    if (updates.name) affected.add(updates.name.trim());
    // If name wasn't in current holdings (rename old names), also rebuild old names from pre-update snapshot
    for (const n of affected) { try { rebuildAssetLots(n); } catch(e){} }
  } catch(e){}
  res.json({ success: true, updated: result.changes });
});

app.post("/api/holdings/batch-delete", (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "No IDs provided." });
  const safeIds = ids.map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (safeIds.length === 0) return res.status(400).json({ error: "No valid IDs." });
  const names = db.prepare(`SELECT DISTINCT name FROM holdings WHERE id IN (${safeIds.map(() => "?").join(",")})`).all(...safeIds).map(r=>r.name);
  const placeholders = safeIds.map(() => "?").join(",");
  const result = db.prepare(`DELETE FROM holdings WHERE id IN (${placeholders})`).run(...safeIds);
  for (const n of names) { try { rebuildAssetLots(n); } catch(e){} }
  res.json({ success: true, deleted: result.changes });
});

app.post("/api/holdings/rename-asset", (req, res) => {
  const { old_name, new_name } = req.body;
  if (!old_name || !old_name.trim()) return res.status(400).json({ error: "Old name is required." });
  if (!new_name || !new_name.trim()) return res.status(400).json({ error: "New name is required." });

  const oldName = old_name.trim();
  const newName = new_name.trim();
  if (oldName === newName) return res.status(400).json({ error: "Names are the same." });

  const count = db.prepare("SELECT COUNT(*) as c FROM holdings WHERE name = ?").get(oldName).c;
  if (count === 0) return res.status(404).json({ error: `No holdings found with name "${oldName}".` });

  db.transaction(() => {
    db.prepare("UPDATE holdings SET name = ? WHERE name = ?").run(newName, oldName);
    const tickerRow = db.prepare("SELECT ticker FROM ticker_map WHERE asset_name = ?").get(oldName);
    if (tickerRow) {
      db.prepare("DELETE FROM ticker_map WHERE asset_name = ?").run(oldName);
      db.prepare("INSERT OR REPLACE INTO ticker_map (asset_name, ticker) VALUES (?,?)").run(newName, tickerRow.ticker);
    }
  })();

  try { rebuildAssetLots(oldName); } catch(e){}
  try { rebuildAssetLots(newName); } catch(e){}
  res.json({ success: true, renamed: count, old_name: oldName, new_name: newName });
});

//--- Price updates & refresh ---
app.post("/api/refresh-prices", asyncHandler(async (req, res) => {
  // TTL check — skip if refreshed within last 5 minutes (unless force=true)
  const force = req.body && req.body.force;
  if (!force && (Date.now() - lastPriceRefreshTime < PRICE_REFRESH_TTL_MS)) {
    return res.json({ updated: 0, failed: 0, details: [], skipped: true, message: "Prices were refreshed recently. Use force:true to override." });
  }

  ratesSessionCache = {};
  const holdings = db.prepare("SELECT DISTINCT name, ticker FROM holdings WHERE ticker != '' AND ticker IS NOT NULL").all();
  const results = { updated: 0, failed: 0, details: [] };

  // Fetch prices in parallel batches of 5, also caches day change data
  const batchSize = 5;
  for (let i = 0; i < holdings.length; i += batchSize) {
    const batch = holdings.slice(i, i + batchSize);
    const quoteResults = await Promise.allSettled(batch.map(h => fetchQuoteData(h.ticker)));
    for (let j = 0; j < batch.length; j++) {
      const h = batch[j];
      const result = quoteResults[j];
      const quoteData = result.status === "fulfilled" ? result.value : null;
      const price = quoteData ? quoteData.price : null;
      if (price != null) {
        setCachedQuote(h.ticker, quoteData);
        db.prepare("UPDATE holdings SET current_price = ? WHERE name = ? AND ticker = ?").run(price, h.name, h.ticker);
        results.updated++;
        results.details.push({ name: h.name, ticker: h.ticker, price });
      } else {
        results.failed++;
        results.details.push({ name: h.name, ticker: h.ticker, price: null, error: "Failed" });
      }
    }
  }

  const defaultCur = getDefaultCurrency();
  const foreign = getForeignCurrencies();
  const rates = {};
  for (const cur of foreign) {
    rates[cur] = await fetchExchangeRate(cur, defaultCur);
  }
  results.rates = rates;
  lastPriceRefreshTime = Date.now();
  res.json(results);
}));

app.get("/api/price/:ticker", asyncHandler(async (req, res) => {
  const price = await fetchPrice(req.params.ticker);
  if (price != null) {
    res.json({ ticker: req.params.ticker, price });
  } else {
    res.status(404).json({ error: "Could not fetch price." });
  }
}));

app.get("/api/exchange-rate", asyncHandler(async (req, res) => {
  const defaultCur = getDefaultCurrency();
  const rateDisplay = db.prepare("SELECT value FROM settings WHERE key = 'rate_display'").get();
  const displayCur = (rateDisplay && rateDisplay.value) || "";
  const rates = {};

  if (displayCur && displayCur !== defaultCur) {
    rates[displayCur] = await fetchExchangeRate(displayCur, defaultCur);
  }
  const foreign = getForeignCurrencies();
  for (const cur of foreign) {
    if (!rates[cur]) {
      rates[cur] = await fetchExchangeRate(cur, defaultCur);
    }
  }
  res.json({ default_currency: defaultCur, rates, display_rate: displayCur });
}));

//--- Settings Currency endpoints ---
app.get("/api/settings/currency", (req, res) => {
  const defaultCur = getDefaultCurrency();
  const rateDisplay = db.prepare("SELECT value FROM settings WHERE key = 'rate_display'").get();
  const dateFormat = db.prepare("SELECT value FROM settings WHERE key = 'date_format'").get();
  const prevCurrency = db.prepare("SELECT value FROM settings WHERE key = 'previous_default_currency'").get();
  const prevRateDisplay = db.prepare("SELECT value FROM settings WHERE key = 'previous_rate_display'").get();
  const currencies = db.prepare("SELECT DISTINCT currency FROM holdings WHERE currency != '' AND currency IS NOT NULL").all().map(r => r.currency);
  const investedBaseCount = db.prepare("SELECT COUNT(*) as c FROM holdings WHERE invested_base IS NOT NULL").get().c;

  res.json({
    default_currency: defaultCur,
    rate_display: (rateDisplay && rateDisplay.value) || "",
    date_format: (dateFormat && dateFormat.value) || "MM/DD/YYYY",
    previous_default_currency: (prevCurrency && prevCurrency.value) || "",
    previous_rate_display: (prevRateDisplay && prevRateDisplay.value) || "",
    holding_currencies: currencies,
    invested_base_count: investedBaseCount
  });
});

app.put("/api/settings/currency", (req, res) => {
  const { currency, rate_display, date_format, save_previous } = req.body;
  if (save_previous) {
    const currentCur = getDefaultCurrency();
    const currentRate = db.prepare("SELECT value FROM settings WHERE key = 'rate_display'").get();
    if (currentCur) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('previous_default_currency', ?);").run(currentCur);
    }
    if (currentRate && currentRate.value) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('previous_rate_display', ?);").run(currentRate.value);
    }
  }

  if (currency !== undefined) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('default_currency', ?);").run(currency ? currency.toUpperCase() : "");
  }
  if (rate_display !== undefined) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('rate_display', ?);").run(rate_display ? rate_display.toUpperCase() : "");
  }
  if (date_format !== undefined) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('date_format', ?);").run(date_format);
  }

  const cur = getDefaultCurrency();
  const rd = db.prepare("SELECT value FROM settings WHERE key = 'rate_display'").get();
  const df = db.prepare("SELECT value FROM settings WHERE key = 'date_format'").get();
  res.json({ success: true, default_currency: cur, rate_display: (rd && rd.value) || "", date_format: (df && df.value) || "MM/DD/YYYY" });
});

app.post("/api/settings/currency/restore", (req, res) => {
  const prevCurrency = db.prepare("SELECT value FROM settings WHERE key = 'previous_default_currency'").get();
  const prevRateDisplay = db.prepare("SELECT value FROM settings WHERE key = 'previous_rate_display'").get();
  if (!prevCurrency || !prevCurrency.value) {
    return res.status(400).json({ error: "No previous currency configuration to restore." });
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('default_currency', ?);").run(prevCurrency.value);
  if (prevRateDisplay && prevRateDisplay.value) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('rate_display', ?);").run(prevRateDisplay.value);
  }
  db.prepare("DELETE FROM settings WHERE key = 'previous_default_currency'").run();
  db.prepare("DELETE FROM settings WHERE key = 'previous_rate_display'").run();
  res.json({ success: true, default_currency: prevCurrency.value, rate_display: (prevRateDisplay && prevRateDisplay.value) || "" });
});

//--- Analytics & Summary APIs ---
app.get("/api/summary", asyncHandler(async (req, res) => {
  const rows = db.prepare("SELECT * FROM holdings").all();
  const defaultCur = getDefaultCurrency();
  const rateData = await getAllRates();
  const summary = {
  by_class: {},
  by_type: {},
  total: { invested: 0, current_value: 0, gain_loss: 0, units: 0, realized_gain: 0, unrealized_gain: 0 },
  default_currency: defaultCur,
  rates: rateData.rates
};

const classesArr = db.prepare(
  "SELECT name FROM asset_classes ORDER BY sort_order, id"
).all();

classesArr.forEach(({ name }) => {
  summary.by_class[name] = {
    invested: 0,
    current_value: 0,
    gain_loss: 0,
    count: 0,
    units: 0
  };
});

  const rateDisplay = db.prepare("SELECT value FROM settings WHERE key = 'rate_display'").get();
  const displayCur = (rateDisplay && rateDisplay.value) || "";
  let displayRate = null;
  if (displayCur && displayCur !== defaultCur) {
    displayRate = rateData.rates[displayCur] || await fetchExchangeRate(displayCur, defaultCur);
  }
  summary.display_rate = displayRate;
  summary.display_rate_currency = displayCur;

  // Compute open positions via FIFO (remaining cost) and realized gain from lots
  const assetGroups = {};
  for (const h of rows) {
    const key = h.name;
    if (!assetGroups[key]) assetGroups[key] = [];
    assetGroups[key].push(h);
  }
  let totalRealized = 0;
  try {
    const row = db.prepare("SELECT COALESCE(SUM(gain),0) as g FROM realized_lots").get();
    totalRealized = row ? row.g : 0;
  } catch(e) {}
  // For FX, build map from rateData
  const fxFor = (cur) => cur === defaultCur ? 1 : (rateData.rates[cur] || 1);
  let totalUnrealized = 0;
  let totalOpenInvested = 0;
  let totalOpenValue = 0;
  let totalUnits = 0;
  for (const [assetName, assetRows] of Object.entries(assetGroups)) {
    assetRows.sort((a,b) => a.date.localeCompare(b.date) || a.id - b.id);
    const buyQueue = [];
    for (const r of assetRows) {
      if ((r.txn_type||'buy')==='buy' && (r.quantity||0)>0) {
        const fx = fxFor(r.currency);
        const totCost = r.invested_base != null ? r.invested_base : (r.invested_amount||0)*fx;
        const qty = r.quantity;
        const cpu = qty!==0 ? totCost/qty : 0;
        buyQueue.push({ remaining: qty, costPerUnit: cpu, asset_class: r.asset_class, asset_type: r.asset_type, currency: r.currency });
      }
    }
    const sells = assetRows.filter(r => (r.txn_type||'buy')==='sell');
    for (const s of sells) {
      let rem = Math.abs(s.quantity||0);
      while (rem > EPSILON_QTY && buyQueue.length>0) {
        const b = buyQueue[0];
        const take = Math.min(b.remaining, rem);
        b.remaining -= take;
        rem -= take;
        if (b.remaining <= EPSILON_QTY) buyQueue.shift();
      }
    }
    const remainingCost = buyQueue.reduce((sum,b)=> sum + b.remaining * b.costPerUnit, 0);
    const netQty = assetRows.reduce((s,r)=> s + (r.quantity||0), 0);
    if (Math.abs(netQty) < EPSILON_QTY) continue; // closed, not in open summary
    // Find current price for asset (prefer cached quote, fallback to row current_price)
    let price = null; let buyPriceFallback = null;
    let ticker = "";
    let cls = "Other";
    let typ = "Other";
    let cur = "INR";
    for (const r of assetRows) {
      if (r.ticker) ticker = r.ticker;
      if (r.asset_class) cls = r.asset_class;
      if (r.asset_type) typ = r.asset_type;
      if (r.currency) cur = r.currency;
      if (r.current_price) price = r.current_price;
      if (r.buy_price) buyPriceFallback = r.buy_price;
    }
    const cached = ticker ? getCachedQuote(ticker) : null;
    if (cached && cached.price) price = cached.price;
    if (price == null) price = buyPriceFallback;
    const fx = fxFor(cur);
    const curval = price ? netQty * price * fx : 0;
    const invested = remainingCost; // already in base
    const unrealized = curval - invested;
    if (!summary.by_class[cls]) summary.by_class[cls] = { invested:0, current_value:0, gain_loss:0, count:0, units:0 };
    if (!summary.by_type[typ]) summary.by_type[typ] = { invested:0, current_value:0, count:0 };
    summary.by_class[cls].invested += invested;
    summary.by_class[cls].current_value += curval;
    summary.by_class[cls].gain_loss += unrealized;
    summary.by_class[cls].count++;
    summary.by_class[cls].units += netQty;
    summary.by_type[typ].invested += invested;
    summary.by_type[typ].current_value += curval;
    summary.by_type[typ].count++;
    totalOpenInvested += invested;
    totalOpenValue += curval;
    totalUnits += netQty;
    totalUnrealized += unrealized;
  }
  summary.total.invested = totalOpenInvested;
  summary.total.current_value = totalOpenValue;
  summary.total.units = totalUnits;
  summary.total.unrealized_gain = totalUnrealized;
  summary.total.realized_gain = totalRealized;
  summary.total.gain_loss = totalUnrealized + totalRealized;

  // Calculate best performer (highest day change %) from cached quote data
  const assetDayChange = {};
  for (const h of rows) {
    if (h.txn_type === "sell" || !h.ticker) continue;
    const cached = getCachedQuote(h.ticker);
    if (!cached || cached.day_change_pct == null) continue;
    const key = h.name;
    if (!assetDayChange[key]) assetDayChange[key] = { name: key, day_change_pct: cached.day_change_pct };
  }
  let topGainer = null;
  let topGainPct = -Infinity;
  for (const a of Object.values(assetDayChange)) {
    if (a.day_change_pct > topGainPct) {
      topGainPct = a.day_change_pct;
      topGainer = { name: a.name, pct: a.day_change_pct };
    }
  }
  summary.top_gainer = topGainer;

  // Calculate total day change from cached quote data
  let totalDayChange = 0;
  const seenTickers = new Set();
  for (const h of rows) {
    if (!h.ticker || h.txn_type === "sell") continue;
    const cached = getCachedQuote(h.ticker);
    if (cached && cached.day_change != null) {
      const fx = h.currency === defaultCur ? 1 : (rateData.rates[h.currency] || 1);
      totalDayChange += cached.day_change * h.quantity * fx;
    }
  }
  summary.total.day_change = totalDayChange;
  summary.total.day_change_pct = summary.total.current_value > 0
    ? (totalDayChange / (summary.total.current_value - totalDayChange)) * 100
    : 0;

  res.json(summary);
}));

app.get("/api/allocation", asyncHandler(async (req, res) => {
  const rows = db.prepare("SELECT * FROM holdings").all();
  const defaultCur = getDefaultCurrency();
  const rateData = await getAllRates();
  const map = {};
  const groups = {};
  for (const h of rows) { if (!groups[h.name]) groups[h.name]=[]; groups[h.name].push(h); }
  for (const [name, assetRows] of Object.entries(groups)) {
    const netQty = assetRows.reduce((s,r)=> s + (r.quantity||0), 0);
    if (Math.abs(netQty) < EPSILON_QTY) continue;
    const rep = assetRows[0];
    let price = null; let ticker = ""; let buyFallback = null;
    for (const r of assetRows) { if (r.current_price) price = r.current_price; if (r.buy_price) buyFallback = r.buy_price; if (r.ticker) ticker = r.ticker; }
    const cached = ticker ? getCachedQuote(ticker) : null;
    if (cached && cached.price) price = cached.price;
    if (price == null) price = buyFallback;
    const fx = rep.currency === defaultCur ? 1 : (rateData.rates[rep.currency] || 1);
    const curval = price ? netQty * price * fx : 0;
    if (!map[name]) map[name] = { name, asset_class: rep.asset_class, value: 0 };
    map[name].value = curval;
  }
  res.json(Object.values(map).sort((a, b) => b.value - a.value));
}));

app.get("/api/breakdown", asyncHandler(async (req, res) => {
  const rows = db.prepare("SELECT * FROM holdings").all();
  const defaultCur = getDefaultCurrency();
  const rateData = await getAllRates();
  const classes = {};
  const fxFor = (cur) => cur === defaultCur ? 1 : (rateData.rates[cur] || 1);
  const groups = {};
  for (const h of rows) { if (!groups[h.name]) groups[h.name]=[]; groups[h.name].push(h); }
  for (const [assetName, assetRows] of Object.entries(groups)) {
    assetRows.sort((a,b)=> a.date.localeCompare(b.date) || a.id - b.id);
    const netQty = assetRows.reduce((s,r)=> s + (r.quantity||0), 0);
    if (Math.abs(netQty) < EPSILON_QTY) continue; // closed -> not in breakdown
    // FIFO remaining cost
    const buyQueue = [];
    for (const r of assetRows) {
      if ((r.txn_type||'buy')==='buy' && (r.quantity||0)>0) {
        const fx = fxFor(r.currency);
        const totCost = r.invested_base != null ? r.invested_base : (r.invested_amount||0)*fx;
        const qty = r.quantity;
        const cpu = qty!==0 ? totCost/qty : 0;
        buyQueue.push({ remaining: qty, costPerUnit: cpu });
      }
    }
    const sells = assetRows.filter(r => (r.txn_type||'buy')==='sell');
    for (const s of sells) {
      let rem = Math.abs(s.quantity||0);
      while (rem > EPSILON_QTY && buyQueue.length>0) {
        const b = buyQueue[0];
        const take = Math.min(b.remaining, rem);
        b.remaining -= take; rem -= take;
        if (b.remaining <= EPSILON_QTY) buyQueue.shift();
      }
    }
    const remainingCost = buyQueue.reduce((sum,b)=> sum + b.remaining * b.costPerUnit, 0);
    // Price / class from latest row with ticker/price
    let price = null; let buyFallback = null; let ticker = ""; let cls = "Other"; let assetType=""; let currency="INR";
    for (const r of assetRows) {
      if (r.ticker) ticker = r.ticker;
      if (r.asset_class) cls = r.asset_class;
      if (r.asset_type) assetType = r.asset_type;
      if (r.currency) currency = r.currency;
      if (r.current_price) price = r.current_price;
      if (r.buy_price) buyFallback = r.buy_price;
    }
    const cached = ticker ? getCachedQuote(ticker) : null;
    if (cached && cached.price) price = cached.price;
    if (price == null) price = buyFallback;
    const fx = fxFor(currency);
    const curval = price ? netQty * price * fx : 0;
    const invested = remainingCost;
    if (!classes[cls]) classes[cls] = { asset_class: cls, invested: 0, current_value: 0, units: 0, count: 0, assets: {} };
    classes[cls].invested += invested;
    classes[cls].current_value += curval;
    classes[cls].units += netQty;
    classes[cls].count++;
    const assetKey = assetName;
    if (!classes[cls].assets[assetKey]) {
      classes[cls].assets[assetKey] = { name: assetKey, asset_type: assetType, invested: 0, current_value: 0, units: 0, count: assetRows.length, current_price: null, currency, ticker: ticker || "", transactions: [] };
    }
    classes[cls].assets[assetKey].invested = invested;
    classes[cls].assets[assetKey].current_value = curval;
    classes[cls].assets[assetKey].units = netQty;
    // Build transactions for XIRR (buys negative, sells positive)
    for (const r of assetRows) {
      const fx2 = fxFor(r.currency);
      const amtBase = r.invested_base != null ? r.invested_base : (r.invested_amount||0)*fx2;
      classes[cls].assets[assetKey].transactions.push({ date: r.date, amount: -amtBase });
    }
    if (price) classes[cls].assets[assetKey].current_price = price * fx;
    if (ticker) classes[cls].assets[assetKey].ticker = ticker;
  }

  // Attach day_change_pct from cached quote data (no extra API calls)
  const result = Object.values(classes).map(c => ({
    ...c,
    gain_loss: c.current_value - c.invested,
    assets: Object.values(c.assets).sort((a, b) => b.invested - a.invested).map(a => {
      let day_change_pct = null;
      if (a.ticker) {
        const cached = getCachedQuote(a.ticker);
        if (cached && cached.day_change_pct != null) {
          day_change_pct = cached.day_change_pct;
        }
      }
      return {
        ...a,
        gain_loss: a.current_value - a.invested,
        day_change_pct
      };
    })
  })).sort((a, b) => b.current_value - a.current_value);

  res.json({ classes: result, default_currency: defaultCur });
}));

// Closed positions (realized) — open vs closed split
app.get("/api/closed-positions", (req, res) => {
  const rows = db.prepare("SELECT * FROM closed_positions ORDER BY close_date DESC, id DESC").all();
  const lots = db.prepare("SELECT * FROM realized_lots ORDER BY sell_date DESC, id DESC").all();
  res.json({ closed: rows, lots });
});

app.get("/api/capital-gains", (req, res) => {
  const fy = req.query.fy; // e.g. 2026-27 not used for filter yet, returns all
  const asset = req.query.asset;
  let lots = db.prepare("SELECT * FROM realized_lots ORDER BY sell_date DESC, id DESC").all();
  if (asset) lots = lots.filter(l => l.asset_name === asset);
  // FY filter: FY 2026-27 = 2026-04-01 to 2027-03-31
  if (fy && /^\d{4}-\d{2}$/.test(fy)) {
    const startYear = parseInt(fy.slice(0,4),10);
    const fyStart = `${startYear}-04-01`;
    const fyEnd = `${startYear+1}-03-31`;
    lots = lots.filter(l => l.sell_date >= fyStart && l.sell_date <= fyEnd);
  }
  const summary = { total_gain: 0, ltcg: 0, stcg: 0, count: lots.length };
  for (const l of lots) {
    summary.total_gain += l.gain || 0;
    if (l.gain_type === 'LTCG') summary.ltcg += l.gain || 0;
    else summary.stcg += l.gain || 0;
  }
  res.json({ lots, summary, fy: fy || null });
});

app.get("/api/monthly-investments", asyncHandler(async (req, res) => {
  const monthsParam = req.query.months;
  const months = monthsParam !== undefined ? Number(monthsParam) : 12;
  const defaultCur = getDefaultCurrency();
  const rateData = await getAllRates();
  const rows = db.prepare("SELECT date, invested_amount, invested_base, currency, current_price, quantity, asset_class FROM holdings ORDER BY date").all();
  const classesArr = db.prepare("SELECT name FROM asset_classes ORDER BY sort_order, id").all().map(r => r.name);
  const monthMap = {};

  for (const h of rows) {
    const month = h.date.substring(0, 7);
    if (!monthMap[month]) {
      monthMap[month] = { total: 0, by_class: {} };
      classesArr.forEach(c => { monthMap[month].by_class[c] = 0; });
    }
    const fx = h.currency === defaultCur ? 1 : (rateData.rates[h.currency] || 1);
    const amt = (h.invested_base != null) ? h.invested_base : (h.invested_amount || 0) * fx;
    monthMap[month].total += amt;
    const cls = h.asset_class || "Other";
    monthMap[month].by_class[cls] = (monthMap[month].by_class[cls] || 0) + amt;
  }

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

  // totalCurrentValue: open positions only (net qty * price), not sum of row quantities including sells
  const groupsCur = {};
  for (const h of rows) { if (!groupsCur[h.name]) groupsCur[h.name]=[]; groupsCur[h.name].push(h); }
  let totalCurrentValue = 0;
  for (const [nm, gr] of Object.entries(groupsCur)) {
    const netQty = gr.reduce((s,r)=> s + (r.quantity||0), 0);
    if (Math.abs(netQty) < EPSILON_QTY) continue;
    const rep = gr.find(r=> r.current_price) || gr.find(r=> r.buy_price) || gr[0];
    const fx = rep.currency === defaultCur ? 1 : (rateData.rates[rep.currency] || 1);
    let price = rep.current_price || rep.buy_price || 0;
    const tickerRow = gr.find(r=> r.ticker);
    const cached = tickerRow && tickerRow.ticker ? getCachedQuote(tickerRow.ticker) : null;
    const effPrice = (cached && cached.price) ? cached.price : price;
    totalCurrentValue += effPrice ? effPrice * netQty * fx : 0;
  }

  const sliced = months === 0 ? result : result.slice(-months);
  res.json({ months: sliced, classes: classesArr, total_current_value: totalCurrentValue, default_currency: defaultCur });
}));

//--- Vintage / Cohort Return Analysis ---
app.get("/api/vintage-returns", asyncHandler(async (req, res) => {
  const rows = db.prepare("SELECT date, invested_amount, invested_base, currency, current_price, quantity, txn_type, asset_class FROM holdings ORDER BY date").all();
  const defaultCur = getDefaultCurrency();
  const rateData = await getAllRates();

  // Group by purchase month: for each month, sum invested and current value (total + per category)
  const monthMap = {};
  const categoriesSet = new Set();

  for (const h of rows) {
    if (h.txn_type === "sell") continue;
    const month = h.date.substring(0, 7);
    const cls = h.asset_class || "Other";
    categoriesSet.add(cls);

    if (!monthMap[month]) monthMap[month] = { invested: 0, current_value: 0, by_class: {} };
    if (!monthMap[month].by_class[cls]) monthMap[month].by_class[cls] = { invested: 0, current_value: 0 };

    const fx = h.currency === defaultCur ? 1 : (rateData.rates[h.currency] || 1);
    const invested = (h.invested_base != null) ? h.invested_base : (h.invested_amount || 0) * fx;
    const curval = h.current_price ? (h.current_price * h.quantity * fx) : invested;

    monthMap[month].invested += invested;
    monthMap[month].current_value += curval;
    monthMap[month].by_class[cls].invested += invested;
    monthMap[month].by_class[cls].current_value += curval;
  }

  const months = Object.keys(monthMap).sort();
  const result = months.map(month => {
    const d = monthMap[month];
    const pnl_pct = d.invested > 0 ? ((d.current_value - d.invested) / d.invested) * 100 : 0;
    const by_class = {};
    for (const cls of categoriesSet) {
      const cd = d.by_class[cls];
      if (cd && cd.invested > 0) {
        by_class[cls] = { invested: cd.invested, current_value: cd.current_value, pnl_pct: ((cd.current_value - cd.invested) / cd.invested) * 100 };
      }
    }
    return { month, invested: d.invested, current_value: d.current_value, pnl_pct: Math.round(pnl_pct * 100) / 100, by_class };
  });

  res.json({ months: result, categories: Array.from(categoriesSet).sort(), default_currency: defaultCur });
}));

// --- WATCHLIST APIS ---
app.get("/api/watchlist", asyncHandler(async (req, res) => {
  const portfolioTickers = db.prepare("SELECT asset_name, ticker FROM ticker_map ORDER BY asset_name").all();
  const manualItems = db.prepare("SELECT * FROM watchlist WHERE is_portfolio = 0 ORDER BY created_at DESC").all();
  const items = [];
  const seenTickers = new Set();

  for (const pt of portfolioTickers) {
    seenTickers.add(pt.ticker.toUpperCase());
    const holding = db.prepare("SELECT currency FROM holdings WHERE ticker = ? LIMIT 1").get(pt.ticker);
    items.push({ id: null, ticker: pt.ticker, name: pt.asset_name, currency: holding ? holding.currency : "", is_portfolio: true, current_price: null, day_change: null, day_change_pct: null });
  }

  for (const mi of manualItems) {
    if (!seenTickers.has(mi.ticker.toUpperCase())) {
      items.push({ id: mi.id, ticker: mi.ticker, name: mi.name, currency: mi.currency || "", is_portfolio: false, current_price: null, day_change: null, day_change_pct: null });
      seenTickers.add(mi.ticker.toUpperCase());
    }
  }

  let orderedItems = items;
  const orderRow = db.prepare("SELECT value FROM settings WHERE key = 'watchlist_order'").get();
  if (orderRow && orderRow.value) {
    try {
      const savedOrder = JSON.parse(orderRow.value);
      const itemMap = {};
      for (const item of items) { itemMap[item.ticker.toUpperCase()] = item; }
      const sorted = [];
      for (const ticker of savedOrder) {
        const key = ticker.toUpperCase();
        if (itemMap[key]) { sorted.push(itemMap[key]); delete itemMap[key]; }
      }
      for (const remaining of Object.values(itemMap)) { sorted.push(remaining); }
      orderedItems = sorted;
    } catch(e) {}
  }

  // Fetch prices — use cache where available, only call Yahoo for stale/missing (fix #1.2)
  const batchSize = 5;
  for (let i = 0; i < orderedItems.length; i += batchSize) {
    const batch = orderedItems.slice(i, i + batchSize);
    const quoteResults = await Promise.allSettled(batch.map(item => {
      const cached = getCachedQuote(item.ticker);
      if (cached != null) return Promise.resolve(cached);
      return fetchQuoteData(item.ticker).then(data => {
        if (data != null) setCachedQuote(item.ticker, data);
        return data;
      });
    }));
    for (let j = 0; j < batch.length; j++) {
      const result = quoteResults[j];
      if (result.status === "fulfilled" && result.value != null) {
        batch[j].current_price = result.value.price;
        batch[j].day_change = result.value.day_change;
        batch[j].day_change_pct = result.value.day_change_pct;
      }
    }
  }
  res.json(orderedItems);
}));

app.post("/api/watchlist", asyncHandler(async (req, res) => {
  const { ticker, name } = req.body;
  if (!ticker || !ticker.trim()) return res.status(400).json({ error: "Ticker is required." });
  const cleanTicker = ticker.trim().toUpperCase();
  const displayName = (name || "").trim();

  const inPortfolio = db.prepare("SELECT ticker FROM ticker_map WHERE UPPER(ticker) = ?").get(cleanTicker);
  if (inPortfolio) return res.status(400).json({ error: "This ticker is already in your portfolio. It appears automatically in the watchlist." });

  const existing = db.prepare("SELECT id FROM watchlist WHERE UPPER(ticker) = ?").get(cleanTicker);
  if (existing) return res.status(400).json({ error: "This ticker is already in your watchlist." });

  const price = await fetchPrice(cleanTicker);
  if (price == null) return res.status(400).json({ error: `Could not fetch price for "${cleanTicker}". Verify the Yahoo Finance ticker symbol.` });

  let currency = '';
  let resolvedName = displayName;
  try {
    const yf = await getYF();
    if (yf) {
      const result = await yf.quote(cleanTicker);
      if (result) {
        if (result.currency) currency = result.currency;
        if (!resolvedName && (result.shortName || result.longName)) {
          resolvedName = result.shortName || result.longName;
        }
      }
    }
  } catch(e) {}
  if (!resolvedName) resolvedName = cleanTicker;

  const result = db.prepare("INSERT INTO watchlist (ticker, name, currency, is_portfolio) VALUES (?, ?, ?, 0)").run(cleanTicker, resolvedName, currency);
  res.json({ id: result.lastInsertRowid, ticker: cleanTicker, name: resolvedName, currency, current_price: price });
}));

app.delete("/api/watchlist/:id", (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare("SELECT * FROM watchlist WHERE id = ? AND is_portfolio = 0").get(id);
  if (!item) return res.status(404).json({ error: "Not found or cannot remove portfolio ticker." });
  db.prepare("DELETE FROM watchlist WHERE id = ?").run(id);
  res.json({ success: true });
});

app.put("/api/watchlist/:id", (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare("SELECT * FROM watchlist WHERE id = ? AND is_portfolio = 0").get(id);
  if (!item) return res.status(404).json({ error: "Not found or cannot edit portfolio ticker." });
  const { name, ticker } = req.body;
  if (!ticker || !ticker.trim()) return res.status(400).json({ error: "Ticker is required." });

  const cleanTicker = ticker.trim().toUpperCase();
  const cleanName = (name || "").trim() || cleanTicker;

  const dup = db.prepare("SELECT id FROM watchlist WHERE UPPER(ticker) = ? AND id != ?").get(cleanTicker, id);
  if (dup) return res.status(400).json({ error: "This ticker already exists in your watchlist." });

  db.prepare("UPDATE watchlist SET name = ?, ticker = ? WHERE id = ?").run(cleanName, cleanTicker, id);
  res.json({ success: true });
});

// --- LOCK & SECURITY APIS (bcrypt) ---
app.get("/api/lock/status", (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.json({ locked: false });
  }
  const row = db.prepare("SELECT locked FROM app_lock WHERE id = 1").get();
  res.json({ locked: row ? Boolean(row.locked) : false });
});

app.get("/api/lock/config", (req, res) => {
  const row = db.prepare("SELECT id FROM app_lock WHERE id = 1").get();
  res.json({ locked: !!row });
});

app.post("/api/lock/setup", asyncHandler(async (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
    return res.status(400).json({ error: "PIN must be exactly 6 digits." });
  }
  const recoveryCode = generateRecoveryCode();
  const pinHash = await hashPin(pin);
  const recoveryHash = await hashPin(recoveryCode);
  db.prepare("INSERT OR REPLACE INTO app_lock (id, pin_hash, recovery_hash, locked) VALUES (1, ?, ?, 1)").run(pinHash, recoveryHash);
  // Mark current session as authenticated so user can immediately disable without re-entering
  req.session.authenticated = true;
  res.json({ success: true, recoveryCode });
}));

app.post("/api/lock/unlock", asyncHandler(async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: "PIN required." });
  const row = db.prepare("SELECT pin_hash FROM app_lock WHERE id = 1").get();
  if (!row) return res.status(404).json({ error: "No lock configured." });

  const match = await verifyPin(pin, row.pin_hash);
  if (!match) return res.status(401).json({ error: "Incorrect PIN." });

  // If legacy hash, upgrade to bcrypt
  if (row.pin_hash.length === 64 && /^[a-f0-9]{64}$/.test(row.pin_hash)) {
    const newHash = await hashPin(pin);
    db.prepare("UPDATE app_lock SET pin_hash = ? WHERE id = 1").run(newHash);
  }

  req.session.authenticated = true;
  res.json({ success: true });
}));

app.post("/api/lock/disable", asyncHandler(async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: "PIN required." });
  const row = db.prepare("SELECT pin_hash FROM app_lock WHERE id = 1").get();
  if (!row) return res.status(404).json({ error: "No lock configured." });

  const match = await verifyPin(pin, row.pin_hash);
  if (!match) return res.status(401).json({ error: "Incorrect PIN." });

  db.prepare("DELETE FROM app_lock WHERE id = 1").run();
  res.json({ success: true });
}));

app.post("/api/lock/recovery", asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Recovery code required." });
  const row = db.prepare("SELECT recovery_hash FROM app_lock WHERE id = 1").get();
  if (!row) return res.status(404).json({ error: "No lock configured." });

  const match = await verifyPin(code.toUpperCase(), row.recovery_hash);
  if (!match) return res.status(401).json({ error: "Invalid recovery code." });

  db.prepare("DELETE FROM app_lock WHERE id = 1").run();
  req.session.authenticated = true;
  res.json({ success: true });
}));

app.post("/api/lock/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Failed to logout." });
    res.clearCookie("connect.sid");
    return res.json({ success: true });
  });
});

// --- EXPORT / IMPORT APIs (fix #5.4) ---
app.get("/api/export", (req, res) => {
  const data = {
    holdings: db.prepare("SELECT * FROM holdings").all(),
    asset_classes: db.prepare("SELECT * FROM asset_classes ORDER BY sort_order").all(),
    asset_types: db.prepare("SELECT * FROM asset_types ORDER BY sort_order").all(),
    brokers: db.prepare("SELECT * FROM brokers ORDER BY sort_order").all(),
    ticker_map: db.prepare("SELECT * FROM ticker_map").all(),
    watchlist: db.prepare("SELECT * FROM watchlist").all(),
    settings: db.prepare("SELECT * FROM settings").all(),
    realized_lots: db.prepare("SELECT * FROM realized_lots").all(),
    closed_positions: db.prepare("SELECT * FROM closed_positions").all()
  };
  res.setHeader("Content-Disposition", `attachment; filename="portfolio-backup-${new Date().toISOString().slice(0,10)}.json"`);
  res.json(data);
});

app.post("/api/import", (req, res) => {
  const data = req.body;
  if (!data || !data.holdings) return res.status(400).json({ error: "Invalid backup file." });

  try {
    db.transaction(() => {
      // Clear and reimport
      if (data.asset_classes) {
        db.prepare("DELETE FROM asset_classes").run();
        const stmt = db.prepare("INSERT INTO asset_classes (id, name, sort_order) VALUES (?, ?, ?)");
        for (const r of data.asset_classes) stmt.run(r.id, r.name, r.sort_order || 0);
      }
      if (data.asset_types) {
        db.prepare("DELETE FROM asset_types").run();
        const stmt = db.prepare("INSERT INTO asset_types (id, name, sort_order) VALUES (?, ?, ?)");
        for (const r of data.asset_types) stmt.run(r.id, r.name, r.sort_order || 0);
      }
      if (data.brokers) {
        db.prepare("DELETE FROM brokers").run();
        const stmt = db.prepare("INSERT INTO brokers (id, name, sort_order) VALUES (?, ?, ?)");
        for (const r of data.brokers) stmt.run(r.id, r.name, r.sort_order || 0);
      }
      if (data.ticker_map) {
        db.prepare("DELETE FROM ticker_map").run();
        const stmt = db.prepare("INSERT INTO ticker_map (asset_name, ticker) VALUES (?, ?)");
        for (const r of data.ticker_map) stmt.run(r.asset_name, r.ticker);
      }
      if (data.watchlist) {
        db.prepare("DELETE FROM watchlist").run();
        const stmt = db.prepare("INSERT INTO watchlist (id, ticker, name, currency, is_portfolio) VALUES (?, ?, ?, ?, ?)");
        for (const r of data.watchlist) stmt.run(r.id, r.ticker, r.name, r.currency || "", r.is_portfolio || 0);
      }
      if (data.settings) {
        db.prepare("DELETE FROM settings").run();
        const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
        for (const r of data.settings) stmt.run(r.key, r.value);
      }
      db.prepare("DELETE FROM holdings").run();
      const stmt = db.prepare("INSERT INTO holdings (id, date, name, asset_class, asset_type, broker, txn_type, buy_price, quantity, invested_amount, currency, current_price, notes, ticker, invested_base) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const r of data.holdings) {
        stmt.run(r.id, r.date, r.name, r.asset_class, r.asset_type || "", r.broker || "", r.txn_type || "buy", r.buy_price || 0, r.quantity || 0, r.invested_amount || 0, r.currency || "INR", r.current_price, r.notes || "", r.ticker || "", r.invested_base);
      }
      if (data.realized_lots) {
        db.prepare("DELETE FROM realized_lots").run();
        const s2 = db.prepare("INSERT INTO realized_lots (id, asset_name, buy_id, sell_id, qty, buy_price, sell_price, cost, proceeds, gain, buy_date, sell_date, holding_days, gain_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        for (const r of data.realized_lots) s2.run(r.id, r.asset_name, r.buy_id, r.sell_id, r.qty, r.buy_price, r.sell_price, r.cost, r.proceeds, r.gain, r.buy_date, r.sell_date, r.holding_days, r.gain_type);
      }
      if (data.closed_positions) {
        db.prepare("DELETE FROM closed_positions").run();
        const s3 = db.prepare("INSERT INTO closed_positions (id, name, asset_class, asset_type, broker, currency, ticker, total_qty, total_cost, total_proceeds, realized_gain, open_date, close_date, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        for (const r of data.closed_positions) s3.run(r.id, r.name, r.asset_class, r.asset_type, r.broker, r.currency, r.ticker, r.total_qty, r.total_cost, r.total_proceeds, r.realized_gain, r.open_date, r.close_date, r.notes||"", r.created_at);
      }
      // Rebuild lots after import to ensure consistency
      try { rebuildAllLots(); } catch(e){}
    })();
    res.json({ success: true, holdings: data.holdings.length });
  } catch(e) {
    res.status(500).json({ error: "Import failed: " + e.message });
  }
});

// --- Global error handler (fix #1.1) ---
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

process.on("SIGINT", () => { db.close(); process.exit(0); });
process.on("SIGTERM", () => { db.close(); process.exit(0); });

app.listen(PORT, () => {
  console.log(`Invest More running at http://localhost:${PORT}`);
  console.log(`Database: ${dbPath}`);
});
