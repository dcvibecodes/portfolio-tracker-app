# Portfolio+ v3.3.0

Self-hosted investment portfolio tracker for any asset class, currency, and broker. Part of a unified suite with Expenses+.

## What's New in v3.3.0

### Holdings Tab
- **Summary bar moved above table** — The entries/invested/value/P&L summary now displays above the holdings table in a subtle, compact style (matching the Expenses+ reports tab)

### Dashboard — By Category Chart
- **Invested line overlay** — The horizontal bar chart now shows a gray line with dots representing invested amounts per category, alongside the colored current-value bars. Legend and tooltips distinguish both datasets.

## What's New in v3.2.0

### Performance — Multi-Layer Caching
- **Client-side localStorage caching** — Dashboard, watchlist render instantly from cache on repeat visits (5 min TTL)
- **Server-side price cache** — Watchlist and quote data cached in-memory, avoids redundant Yahoo Finance calls
- **Server-side exchange rate TTL** — Rates cached for 5 minutes, shared across all endpoints
- **Non-blocking price refresh** — `initApp()` no longer waits for Yahoo price fetch; UI renders immediately, prices update in background
- **Parallel init** — Dropdowns and currency config load concurrently instead of sequentially

### Dashboard Enhancements
- **Day Change card** — Shows total portfolio day change value and percentage (color-coded green/red)
- **Top Gainer Today card** — Highlights the asset with the highest intraday gain % (with ellipsis for long names)
- **Day Chg% column in breakdown table** — Each asset row shows its intraday change percentage with colored arrows

### Watchlist
- **Cached quote data** — Server caches full Yahoo quote (price + day change) per ticker, reducing API calls

## Features

### Dashboard
- Portfolio summary strip (Total Invested, Current Value, P&L, Day Change, Top Gainer Today, exchange rate)
- By Category bar chart
- Portfolio Value trend line chart (invested vs value, 1Y/2Y/3Y/5Y/All)
- Monthly Investments stacked bar chart (by category, 1Y/2Y/3Y/5Y/All)
- Category Breakdown pivot table with day change % per asset
- Currency toggle (switch display between base and alt currency)

### Holdings
- Add/edit transactions (buy/sell, any currency, any broker)
- Asset name autocomplete from history
- Filters (search, category, broker, currency)
- Batch operations (update category/type/broker, rename asset, delete)
- Per-row edit, delete, notes
- CSV export

### Watchlist
- Live prices from Yahoo Finance
- Auto-populated from ticker mappings + manual additions
- Add, edit, remove items

### Settings
- Base currency + exchange rate display
- Categories, Types, Brokers (rename propagates)
- Ticker mapping (asset name → Yahoo Finance symbol)
- Date format (MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD)
- App Lock (6-digit PIN, bcrypt, recovery code, remember-for-today)

### Security
- bcrypt PIN hashing (10 rounds)
- Legacy hash auto-upgrade
- Persistent session secret
- Rate limiting on auth endpoints

### PWA & Offline
- Service worker (static asset caching)
- Web App Manifest (installable)

## Setup

```bash
npm install
npm start
```

Runs at http://localhost:3001

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express |
| Database | SQLite via better-sqlite3 (WAL mode) |
| Frontend | Vanilla JS (no framework, no build step) |
| Charts | Chart.js 4.4.7 (CDN) |
| Price Data | Yahoo Finance (yahoo-finance2) |
| Security | bcrypt, express-session |
| PWA | Service worker, Web App Manifest |

## Data

All data stored in `data/portfolio.db` (SQLite). Back up this file to preserve your portfolio. Use `GET /api/export` for a full JSON backup.
