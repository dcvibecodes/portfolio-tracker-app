# Portfolio+ v3.1.0

Self-hosted investment portfolio tracker for any asset class, currency, and broker. Part of a unified suite with Expenses+.

## What's New in v3.1.0

### Mobile Compatibility
- **Fixed bottom tab bar** — navigation pinned to screen bottom on phones (icon + label, native app feel)
- **No zoom on input focus** — viewport locked with `maximum-scale=1.0`, all inputs at 16px font
- **Single-column layouts** — forms, filters, charts, and settings reflow to one column on mobile
- **Tables scroll internally** — holdings, pivot, watchlist, and ticker tables side-scroll within their container (no page-level horizontal scroll)
- **No text overlap** — ticker table uses auto layout, min-widths enforce spacing
- **Summary cards: 2-per-row** — portfolio totals always show in a 2-column grid on mobile
- **Tab navigation fixed** — click handlers now work on all screen sizes (removed 640px gate)
- **Safe area support** — bottom nav respects iPhone home indicator via `env(safe-area-inset-bottom)`
- **Bottom-sheet modals** — modals slide up from bottom on small screens

### Design Unification (with Expenses+)
- **Focus-visible** — added `:focus-visible` outline rule (was missing, Expenses+ already had it)
- **Autocomplete z-index** — unified to 1100 (was 50)
- **By Category chart** — changed from doughnut/pie to horizontal bar chart for better readability

### Dashboard
- **By Category** — now a horizontal bar chart (replaced doughnut) showing category values with colored bars and percentage in tooltip

## Features

### Dashboard
- Portfolio summary strip (Total Invested, Current Value, P&L, exchange rate)
- By Category bar chart
- Portfolio Value trend line chart (invested vs value, 1Y/2Y/3Y/5Y/All)
- Monthly Investments stacked bar chart (by category, 1Y/2Y/3Y/5Y/All)
- Category Breakdown pivot table (expand/collapse)
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
