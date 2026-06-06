# Portfolio+

A self-hosted investment portfolio tracker that works with any asset class, any currency, and any broker. Built with Node.js, Express, SQLite, and vanilla JavaScript. Deploy on a VPS or run locally — your data stays on your server, not in someone else's cloud.

**Version 2.1.0**

---

## Why This Exists

Most portfolio trackers are either locked behind subscriptions, limited to specific markets, or require you to hand over financial data to third parties. This app gives you a single place to track everything you own — stocks, mutual funds, ETFs, crypto, gold, bonds, or anything else — across multiple currencies and brokers, with live price updates from Yahoo Finance.

---

## Features

### Dashboard

**Portfolio Summary Cards** Four at-a-glance metrics: Total Invested, Current Value, P&L (with percentage), and a live exchange rate (configurable). All values reflect your configured base currency.

**Allocation Charts** Two doughnut charts showing portfolio allocation by category (e.g., Stocks, Crypto, Gold) and by type (e.g., Mutual Fund, ETF, Shares). Percentages are shown inline on labels.

**Monthly Investments Chart** A combo chart (stacked bars + trend lines) showing:

- Monthly investment amounts broken down by category (stacked bars)
- Cumulative invested value (dashed line)
- Estimated portfolio value trajectory (filled line)

Range selector: 1Y, 2Y, 3Y, 5Y, or All time. "All" shows your complete history from the very first transaction.

**Category Breakdown Table** An expandable/collapsible pivot table grouped by category. Each category row shows invested amount, current value, P&L, and P&L%. Expand a category to see individual assets with their units, current price, and per-asset P&L.

Units and current price are only shown at the individual asset level (not at the category or total level, where they would be meaningless). If foreign currency holdings exist, a tooltip (ⓘ icon) explains how invested amounts are derived.

**Currency Toggle** A button in the header lets you switch between viewing all values in your base currency or in a secondary currency (e.g., toggle between ₹ INR and $ USD). One click, entire dashboard re-renders.

---

### Holdings

**Add Transaction** A collapsible form for recording buy or sell transactions. Fields include:

- Date, Buy/Sell toggle, Asset Name (with autocomplete from existing holdings)
- Category, Type, Broker/Platform (all configurable dropdowns)
- Price per unit, Quantity, Total invested amount
- Currency (20+ options, or hidden if currency is not configured)
- Yahoo Finance ticker symbol (for live price updates)
- Notes (free text)
- "Invested in base currency" field (appears only when the selected currency differs from your base currency — stores the actual amount you spent in your home currency)

When you select Sell, the ticker field hides (you already have it). Quantity and amount are stored as negative values automatically.

**Asset Name Autocomplete** Start typing an asset name and existing names appear as suggestions. Selecting one auto-populates the ticker if a mapping exists.

**All Holdings Table** A full table of every transaction with columns for date, buy/sell badge, name, category, broker, currency, price, quantity, invested, current price, current value, P&L, P&L%, and action buttons.

**Filters** Filter by asset name search, category, broker, or currency. One-click "Reset" clears all filters.

**Batch Operations** Select multiple rows via checkboxes (includes Select All with indeterminate state), then:

- Batch update category, type, or broker
- Batch delete with confirmation

**Per-Row Actions**

- Edit (opens a modal with all fields pre-populated)
- Delete (with confirmation)
- Notes (popup editor for adding/editing notes per transaction)

**Sort Order** Holdings are displayed most recent first (by date descending, then by ID descending). A past-dated transaction sits in its chronological position.

---

### Settings

**Currency Configuration**

The app supports a currency-agnostic mode by default. If you don't need multi-currency tracking, leave it unconfigured — all values display as raw numbers with no currency symbols or conversions.

When you configure a base currency:

- All portfolio values display in that currency with the appropriate symbol
- A secondary "Show Exchange Rate" option lets you pick a currency pair to display on the dashboard
- The currency selector appears in the add/edit transaction forms
- Foreign currency transactions show an additional "Invested in [base currency]" field

If you disable currency after having holdings in multiple currencies, the app shows a strong warning explaining the consequences. Your previous configuration is saved and can be restored with one click at any time.

20+ currencies supported: AED, AUD, CAD, CHF, CNY, EUR, GBP, HKD, INR, JPY, KRW, MYR, NZD, SAR, SEK, SGD, THB, TWD, USD, ZAR.

**Categories** Define your own asset categories (e.g., "Indian Stock", "US Stock", "Crypto", "Gold", "Real Estate"). Maximum 10. Renaming a category propagates to all holdings that use it. Cannot delete a category while holdings reference it.

**Types** Define asset types within categories (e.g., "Mutual Fund", "ETF", "Shares", "Cryptocurrency", "Bond"). Same rename propagation and delete protection.

**Brokers / Platforms** Track which platform each holding is on (e.g., "Zerodha", "Vanguard", "Coinbase"). Same rules — rename propagates, delete is protected.

**Ticker Mapping** Map asset names to Yahoo Finance ticker symbols for automatic live price updates. Examples:

| Asset Name | Ticker |
|---|---|
| Reliance Industries | `RELIANCE.NS` |
| Tesla Inc. | `TSLA` |
| Bitcoin | `BTC-INR` |
| SBI Bluechip Fund | `0P0000XVL9.BO` |

Tickers can be edited inline in the settings table. When you add a new holding with a ticker, the mapping is saved automatically for future use.

**App Lock** Protect the app with a 6-digit numeric PIN:

- Set a PIN and receive a one-time recovery code (save it securely)
- On next visit, the app shows a lock screen requiring PIN entry
- "Remember for today" option skips the PIN for the rest of the day in the same browser
- Recovery code unlocks and removes the lock if you forget your PIN
- Can be disabled at any time from Settings (requires current PIN)

---

### Price Updates

**Automatic on page load** — every time you open the app, it fetches current prices from Yahoo Finance for all holdings that have a ticker mapping.

**Manual refresh** — the "🔄 Prices" button in the header triggers a fresh fetch for all tickers.

**Exchange rates** — fetched live via Yahoo Finance (e.g., `USDINR=X`). Cached per session to avoid duplicate calls.

**What gets updated:**

- `current_price` on all holdings with a valid ticker
- Exchange rates for all foreign currencies in your holdings
- Dashboard, charts, and breakdown all reflect the latest values

---

### Multi-Currency (Detailed)

The app handles foreign currency investments without masking what you actually spent:

1. You add a holding in USD (or any non-base currency)
2. An additional field appears: "Invested in [your base currency]" — you enter the actual amount that left your bank account in your home currency (e.g., the INR you converted to buy those USD shares)
3. In all summaries and breakdowns, the invested column shows that real base-currency amount — not a fluctuating live-rate conversion
4. Current value still uses live exchange rates (because that's what it's worth today)
5. P&L = current value (live) minus what you actually spent (fixed) — gives you true profit/loss including forex impact

The Holdings table continues to show amounts in the original currency for each row, so you can reconcile with your broker statements.

---

### Dark Mode

Full dark theme with pitch-black background (saves battery on OLED screens):

- All cards, inputs, selects, modals, and charts themed
- Safari-specific fixes for calendar picker icons and select chevrons
- Toggle via the 🌙/☀ button in the header
- Preference saved in localStorage

---

### Mobile Experience

The app is designed mobile-first for use on phones (iPhone and Android):

- **Collapsible header** — the app title bar (name, currency toggle, refresh button) slides up and hides when you scroll down, giving more screen real estate to content. Scrolling up brings it back instantly. Tab bar stays fixed at all times.
- **Swipeable tabs** — horizontal scroll-snap between Dashboard, Holdings, Watchlist, and Settings. Swipe left/right or tap the tab buttons.
- **Pull to refresh** — pull down on any tab to reload data
- **Chart tooltip dismiss** — tapping outside a chart or tapping the same data point again dismisses the tooltip (no more stuck tooltips on touch devices)
- **No auto-zoom on iOS** — all inputs use 16px font size
- **Touch-friendly targets** — minimum 40px height on all buttons and inputs
- **Stacked forms** — all form fields go single-column on mobile
- **Horizontal scroll tables** — data tables scroll sideways without breaking layout
- **Batch bar stacks vertically** — dropdowns and buttons go full-width
- **Tooltip tap-to-toggle** — the ⓘ icon works on touch (hover doesn't exist on mobile)
- **Safe area support** — respects iPhone notch/Dynamic Island via `env(safe-area-inset-top)`
- **Dynamic viewport height** — uses 100dvh with fallback for Android Chrome's collapsing address bar

---

### Browser Compatibility

Tested and working on:

- **Chrome** (desktop + Android)
- **Firefox** (desktop + Android)
- **Safari** (macOS + iOS/iPadOS)
- **Edge** (desktop)

Safari-specific handling includes:

- `-webkit-backdrop-filter` for blur effects
- `-webkit-appearance: none` for consistent select styling
- Custom SVG chevron on dropdowns (Safari hides the native one with `appearance: none`)
- `-webkit-overflow-scrolling: touch` for smooth scroll containers
- `touch-action: manipulation` to prevent double-tap zoom delay
- Dark mode calendar picker icon inversion
- `viewport-fit=cover` for notch-safe layout on iPhone

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| Backend | Node.js, Express |
| Database | SQLite via better-sqlite3 (WAL mode) |
| Frontend | Vanilla JavaScript (no framework, no build step) |
| Charts | Chart.js (loaded via CDN) |
| Price Data | Yahoo Finance (yahoo-finance2