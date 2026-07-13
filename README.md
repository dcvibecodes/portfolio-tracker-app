# Portfolio+ v3.13.0

Self-hosted investment portfolio tracker for any asset class, currency, and broker. Part of a unified suite with Expenses+.

## What's New in v3.13.0

### Theme Flash Fix
- **Zero-flash dark mode** — inline `<script>` in `<head>` sets the correct theme before the first paint; no more white flash on dark-mode devices
- **CSS media query fallback** — `@media (prefers-color-scheme: dark)` applies dark variables even before JS runs, covering edge cases

## What's New in v3.12.0

### Skeleton Loading
- **Shimmer placeholders on page load** — summary cards, pivot breakdown table, and holdings table show animated skeleton placeholders while data loads from the server
- **Instant perceived speed** — the page structure appears immediately instead of blank containers, reducing perceived load time on slow connections
- **Zero impact after load** — skeletons are pure HTML that gets overwritten when real data arrives; no residual code or styling
- **Works on mobile and desktop** — responsive skeleton shapes adapt to container width

## What's New in v3.11.0

### Emoji Purge — SVG Icons Everywhere
- **All action buttons now use SVG icons** — edit (pencil), delete (trash), copy (clipboard), notes (file), save (checkmark) are all inline SVGs that inherit `currentColor`
- **Consistent cross-platform rendering** — no more emoji differences between Windows, Mac, iOS, and Android
- **Settings list buttons** — save (💾) and delete (🗑️) replaced with SVG checkmark and trash icons
- **Watchlist actions** — edit and delete buttons now use SVGs
- **Ticker table** — save and delete buttons converted to SVGs

## What's New in v3.10.0

### Design Overhaul — Monochrome Design Language
- **Complete visual redesign** — unified design language shared with Expenses+ and other suite apps (Dictation Tool, DocuChat AI)
- **Inter font** — switched from system fonts to Inter via Google Fonts
- **Monochrome accent** — replaced blue (#3b82f6) with near-black (#111) in light mode, near-white (#f5f5f5) in dark mode
- **No shadows** — surfaces rely on subtle borders instead of box-shadow
- **Compact spacing** — smaller buttons (34px height), tighter card padding, reduced font sizes
- **Segmented navigation** — tab bar as glassmorphic segmented control (desktop) / bottom tab bar (mobile)
- **Lock screen redesigned** — monochrome design with prefers-color-scheme dark mode support

### Theme Toggle
- **Settings → Theme** — segmented control (Auto / Light / Dark) at the top of the Settings tab
- **Auto** follows device theme (default); Light/Dark force a specific mode
- **Persisted in localStorage**

### Category Colors
- **Color picker per category** — each category in Settings now has a clickable color dot; click to open native color picker
- **Colors stored in database** — `color` column added to `asset_classes` table
- **Propagated to all charts** — By Category chart, Monthly Investments, Investment Vintage all use the custom colors
- **Fallback palette** — categories without a custom color use a muted default palette

### Refresh Prices Button
- **SVG icon** — replaced the 🔄 emoji with a clean SVG refresh icon (circular arrows)
- **Icon-only button** — no text label, just the icon in a properly centered 28×28px button matching the header design language
- **Loading states** — shows "…" while fetching, "✓ N" on success, "✗" on error

### FAQ Updates
- Added category colors FAQ
- Added theme toggle FAQ

## What's New in v3.9.0

### XIRR Column in Category Breakdown
- **XIRR (annualized return)** — new column in the pivot table showing XIRR at asset, category, and portfolio levels
- **Newton-Raphson solver** with bisection fallback for robustness
- **Handles multiple buys per asset** — accounts for SIP timing and amounts correctly
- **Sell-aware** — sell transactions contribute as positive cash inflows
- **CAGR fallback** — single-transaction assets compute direct CAGR (no iteration needed)
- **Category-level XIRR** — combines all cash flows within a category, including zero-cost assets (RSUs/gifted shares)

### FAQs Section
- **11 accordion-style FAQs** added to the Settings tab covering dashboard, transactions, filters, watchlist, currency, tickers, XIRR, export, and app lock
- **Pure CSS accordion** — no JavaScript needed, works on all devices including dark mode

### Layout
- **Tighter pivot table cells** — reduced padding and font size to fit 9 columns without side-scrolling on desktop

### Bug Fix — Safari/iOS Bottom Sheet
- **Swipe-to-dismiss fix on Safari/iOS** — after swiping down to close a bottom sheet, tapping the FAB now opens the sheet on the first tap (previously required two taps on Safari and PWA); root cause was Safari not registering the transform reset before the CSS class change; fixed with a forced reflow between operations

## What's New in v3.8.0

### Caching & Deploy
- **No-cache static headers** — HTML/JS/CSS now served with `no-cache, no-store, must-revalidate`; browser always fetches fresh files on refresh, eliminating stale-cache issues after deploys
- **Data TTL extended to 6 hours** — price cache, watchlist cache, exchange rate cache, and dashboard localStorage cache all set to 6-hour TTL (was 5 minutes); reduces Yahoo Finance API calls; manual "🔄 Prices" button still forces immediate refresh

### Scroll Fix (Chromium)
- **`overflow-x: clip` replaces `overflow-x: hidden`** — fixes vertical scrolling blocked on Chrome/Edge
- **Pull-to-refresh disabled** — `overscroll-behavior-y: contain` prevents browser pull-to-refresh; eliminates conflict with swipe-to-dismiss

## What's New in v3.7.0

### Holdings — Mobile Search & Filters
- **Inline search + filter chip** — replaced the filter FAB with a compact search bar and "Filters" pill above the table; search is always visible, filters open as a bottom sheet
- **Table-first view** — holdings data immediately visible on mobile without scrolling past UI

### Swipe to Dismiss
- **All bottom sheets** — swipe down to dismiss the New Transaction and Filters sheets; drag handle shown at top
- **Instant dismiss** — no visual snap-back; sheet disappears immediately on threshold

### Font & Style Consistency (with Expenses+)
- **Summary card values** — `1.1rem` (was `1.2rem`)
- **Chart headings (h3)** — `0.75rem`, uppercase, letter-spacing (was `0.9rem`, normal case)
- **Toast weight** — `font-weight: 600` added
- **`.btn-secondary`** — rule added with `font-size: 0.85rem; font-weight: 500`

### FAB Position Fix
- **PWA safe area** — FAB at `bottom: 110px` to clear nav bar in Safari and PWA standalone mode

### Bug Fix
- **Duplicate "New Transaction" heading** — removed duplicate when form card is inside the mobile bottom sheet

## What's New in v3.6.0

### Holdings — Mobile Redesign
- **FAB for new transactions** — on mobile, the "New Transaction" form is hidden; a floating "+" button opens it as a bottom sheet
- **Inline search + filter chip** — compact search bar always visible above the table on mobile; "Filters" chip opens year/month/category/broker/currency in a bottom sheet
- **Table-first view** — holdings table is immediately visible on mobile without scrolling past form or filter UI
- **Scroll lock** — background page locked while any bottom sheet is open
- **Desktop form always visible** — "New Transaction" heading added, form fields shown by default (no toggle)

### Copy Transaction — Confirmation
- **Confirm before copying** — clicking the 📋 copy button now shows a confirmation dialog explaining what will happen (duplicate with today's date) before creating the copy

### App Lock
- **Auto-focus PIN field** — cursor is now in the PIN input with keyboard open when the lock screen appears

## What's New in v3.5.0

### Holdings — Copy Transaction
- **One-click copy** — Each transaction row now has a 📋 copy button that duplicates the transaction with today's date
- **Instant feedback** — Toast notification confirms "Transaction copied"
- **No UI disruption** — The copied transaction appears at the top of the list (sorted by date) and can be edited in place if needed

### Session
- **Extended session duration** — Authenticated session now lasts 7 days (previously 24 hours)

## What's New in v3.4.0

### Dashboard — Investment Vintage Chart
- **New chart: Investment Vintage** — Shows P&L% for each month's purchases (cohort analysis). Answers "which month's investments have performed best?"
- **Category filter** — Toggle between All or any individual category to isolate that category's vintage performance
- **Range selector** — 1Y/2Y/3Y/5Y/All (defaults to All to show full investment history)
- **2x2 chart layout** — Dashboard charts now arranged in a balanced 2-column grid (By Category + Portfolio Value | Monthly Investments + Investment Vintage)

### Performance
- **Gzip compression** — All responses compressed via `compression` middleware (~76% bandwidth reduction)
- **Deferred script loading** — Chart.js and app.js load with `defer`, unblocking first paint
- **CDN preconnect** — DNS prefetch + preconnect to jsdelivr CDN eliminates cold-start latency
- **Static asset caching** — `Cache-Control: max-age=1d` on all static files
- **Service worker pre-caching** — `style.css` and `app.js` now pre-cached for instant repeat visits

### Safari Favicon Fix
- **PNG favicons prioritized over SVG** — Safari now correctly displays the favicon (Safari doesn't support SVG favicons)
- **Mask icon added** — Pinned tab icon for Safari desktop

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
- Investment Vintage chart (P&L% by purchase month, category filter, 1Y/2Y/3Y/5Y/All)
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
- Categories with custom colors (propagated to all charts), Types, Brokers (rename propagates)
- Ticker mapping (asset name → Yahoo Finance symbol)
- Theme toggle (Auto / Light / Dark)
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
