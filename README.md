# Portfolio+

A self-hosted investment portfolio tracker that works with any asset class, any currency, and any broker. Built with Node.js, Express, SQLite, and vanilla JavaScript. Deploy on a VPS or run locally — your data stays on your server, not in someone else's cloud.

**Version 3.0.0**

---

## Why This Exists

Most portfolio trackers are either locked behind subscriptions, limited to specific markets, or require you to hand over financial data to third parties. This app gives you a single place to track everything you own — stocks, mutual funds, ETFs, crypto, gold, bonds, or anything else — across multiple currencies and brokers, with live price updates from Yahoo Finance.

---

## What's New in 3.0.0

### Dashboard Redesign
- **Summary row** — Total Invested, Current Value, P&L, and exchange rate displayed as a horizontal strip at the top
- **Three equal chart cards** — Category doughnut, Portfolio Value trend (invested vs current), and Monthly Investments bar chart side by side
- **Portfolio Value chart** — dedicated line chart with independent 1Y/2Y/3Y/5Y/All range selector showing cumulative invested vs portfolio value over time
- **Monthly Investments** — clean stacked bar chart (no more overlaid lines competing for scale)
- **"By Type" doughnut removed** — declutters the dashboard

### Bottom Navigation (Mobile)
- Tab buttons moved from top to bottom of the screen (native app feel)
- Icons + labels for Dashboard, Holdings, Watchlist, Settings
- Swipe left/right between sections still works
- Active tab highlighted with accent color

### Security Improvements
- **bcrypt PIN hashing** — PINs now hashed with bcrypt (10 rounds) instead of plain SHA-256
- **Legacy hash auto-upgrade** — existing SHA-256 hashes are transparently upgraded to bcrypt on next unlock
- **Persistent session secret** — sessions survive server restarts (stored in `data/session-secret.key`)
- **Immediate disable after setup** — no more "Unauthorized" error when trying to disable lock right after enabling

### Performance
- **Parallel price fetching** — watchlist and price refresh fetch in batches of 5 concurrently (was sequential)
- **Price refresh TTL** — server skips re-fetching if prices were refreshed within the last 5 minutes
- **Cached exchange rates** — holdings tab reuses fetched rates instead of re-fetching on every filter change
- **Chart.js pinned to v4.4.7** — no more unpinned CDN version that could break unexpectedly

### PWA & Offline
- **Service worker** — static assets cached for offline app shell loading
- **Network-first API** — API calls go to network, graceful offline error

### Bug Fixes
- **Notes save no longer corrupts data** — `invested_base` and `txn_type` are preserved when editing notes
- **Tab data loads on swipe** — swiping to a new section now loads its data (was showing stale/blank content)
- **Division by zero guard** — `toDisplayCurrency` no longer returns Infinity when exchange rate is 0
- **Async error handling** — all async routes wrapped with error handler; unhandled rejections no longer crash the server
- **Batch ID validation** — `Number.isFinite` check prevents edge cases with invalid IDs

### UX Improvements
- **Custom confirm/prompt modals** — native browser dialogs replaced with styled modals (consistent cross-platform)
- **Watchlist edit modal** — proper form instead of browser `prompt()`
- **Loading skeletons** — dashboard shows placeholder animation while data loads
- **Horizontal scroll indicator** — faded edge on tables hints at scrollable content
- **Autocomplete flip** — suggestion dropdown flips above the input when near the viewport bottom
- **Virtual keyboard handling** — modals resize when mobile keyboard appears

### Accessibility
- ARIA `role="tab"` / `role="tabpanel"` on navigation
- `role="img"` + `aria-label` on all chart canvases
- `.sr-only` utility class for screen-reader-only text

### Data Management
- **Full JSON export** — `GET /api/export` downloads all holdings, settings, tickers, watchlist
- **Full JSON import** — `POST /api/import` restores from a backup file
- **GET single holding** — `GET /api/holdings/:id` for efficient single-record access

### Consistency (with Expense Tracker)
- App Lock card styling, placeholder text, and recovery message matched across both apps
- Pull-to-refresh indicator flows with content (not fixed position)

---

## Features

### Dashboard

**Portfolio Summary** — horizontal row showing Total Invested, Current Value, Total P&L (with percentage and arrow), and a live exchange rate (configurable).

**By Category Chart** — doughnut chart showing allocation across categories (e.g., Stocks, Crypto, Gold) with percentage labels.

**Portfolio Value Chart** — line chart with two trend lines: cumulative invested (dashed) and estimated portfolio value (filled). Independent 1Y/2Y/3Y/5Y/All range selector.

**Monthly Investments Chart** — stacked bar chart showing monthly investment amounts broken down by category. Independent 1Y/2Y/3Y/5Y/All range selector.

**Category Breakdown Table** — expandable/collapsible pivot table grouped by category showing invested amount, current value, P&L, and P&L%. Expand to see individual assets.

**Currency Toggle** — header button switches between base currency and secondary currency display.

---

### Holdings

**Add Transaction** — collapsible form with date, buy/sell, asset name (autocomplete), category, type, broker, price, quantity, invested amount, currency, ticker, notes, and base-currency invested field for foreign transactions.

**All Holdings Table** — full transaction list with filters (search, category, broker, currency), batch operations (update category/type/broker, rename asset, delete), per-row edit/delete/notes actions.

**CSV Export** — download all holdings as a CSV file.

---

### Watchlist

At-a-glance live prices for portfolio tickers (auto-populated from ticker mappings) and manually added tickers. Add, edit, or remove items.

---

### Settings

- **Currency & Date Format** — base currency, exchange rate display, date format (MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD)
- **Categories** — up to 10, rename propagates to holdings
- **Types** — up to 10, rename propagates
- **Brokers** — unlimited, rename propagates
- **Ticker Mapping** — map asset names to Yahoo Finance symbols
- **App Lock** — 6-digit PIN with bcrypt hashing, recovery code, remember-for-today option

---

### Mobile Experience

- **Bottom navigation** — icon + label bar at screen bottom, thumb-friendly
- **Swipeable sections** — horizontal scroll-snap between all four sections
- **Collapsible header** — slides up on scroll down for more content space
- **Pull to refresh** — indicator moves with content (native feel)
- **Safe area support** — iPhone notch/Dynamic Island respected
- **No auto-zoom** — 16px font on all inputs
- **Virtual keyboard aware** — modals resize when keyboard appears

---

### Browser Compatibility

- Chrome (desktop + Android)
- Firefox (desktop + Android)
- Safari (macOS + iOS/iPadOS)
- Edge (desktop)

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| Backend | Node.js, Express |
| Database | SQLite via better-sqlite3 (WAL mode) |
| Frontend | Vanilla JavaScript (no framework, no build step) |
| Charts | Chart.js 4.4.7 (CDN) |
| Price Data | Yahoo Finance (yahoo-finance2) |
| Security | bcrypt (PIN hashing), express-session |
| PWA | Service worker, Web App Manifest |

---

## Running

```bash
cd portfolio-tracker
npm install
node server.js
```

Open `http://localhost:3001` in your browser.

---

## Data

All data is stored in `data/portfolio.db` (SQLite). Back up this file to preserve your portfolio. Use `GET /api/export` for a full JSON backup including settings and ticker mappings.
