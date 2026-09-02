# Invest More v4.19.1

Self-hosted investment portfolio tracker for any asset class, currency, and broker. Part of a unified suite with Spend Less.

## What's New in v4.19.1

### Vintage — Closed Excluded (Open-Only, like By Category)

- **No more phantom vintage** — `GET /api/vintage-returns` now excludes fully-closed assets (`netQty≈0` e.g. SBI ELSS) — vintage line no longer inflates as NAV climbs for sold funds.

## What's New in v4.19.0

### Holdings — Buy/Sell Filter + FIFO Footer Fix + Broker/Platform

- **Buy/Sell filter** — new `Buy/Sell: All/Buy/Sell` after `Broker/Platform` (`GET /api/holdings?txn_type`) — web same row (7 filters), mobile full-width. When `Buy/Sell` is set, footer shows signed net of filtered rows; otherwise FIFO open `1,687,189` matching Dashboard.
- **Holdings footer open-only** — was signed net `1,540,673`; now FIFO `remaining*costPerUnit` skipping closed (`SBI ELSS 145k` gap) — `2 entries` closed shows `0/0/0 · Closed — see Closed tab (Realized ₹1,026)`.
- **Broker → Broker/Platform** label uniform.

## What's New in v4.18.0

### Invested Over Time — Dual Line Restored + Monthly Cumulative Fix

- **Invested vs Portfolio Value restored** — `Invested Over Time` card shows both `Invested (FIFO open cumulative)` and `Portfolio Value (current)` trend lines again (was invested-only in 4.16.0).
- **Monthly cumulative excludes closed** — `GET /api/monthly-investments` cumulative now sums FIFO open remaining cost only; closed proceeds `762.91` no longer inflates the total.

## What's New in v4.17.0

### Rename — Portfolio Value → Invested Over Time

- Summary card `Portfolio Value` renamed to `Invested Over Time` to reflect it plots invested over time, not NAV.

## What's New in v4.16.0

### Value Trend — Invested Only

- Removed synthetic `Portfolio Value` line; chart showed invested only (reverted in 4.18.0).

## What's New in v4.15.0 / v4.14.0

### Value Trend Visual Tweaks

- `v4.14.0` removed fills to separate `Invested` vs `Portfolio Value` lines; `v4.15.0` reverted fill.

## What's New in v4.13.0

### Chart Tooltip — Current Value → Current

- Tooltip label now `Current` to match summary cards.

## What's New in v4.12.0

### Charts — Expense-Style Tooltips + Horizontal Bar Fixes

- Removed legends; external tooltip card like Spend Less.
- Fixed horizontal `By Category` bar X-axis/grid.

## What's New in v4.11.0

### Bar Transparency

- **Dashboard bars now 20% transparent** — `Current Value` horizontal bars (By Category) and `Monthly Investments` stacked bars use `hexToRgba(color, 0.8)` via new `hexToRgba()` helper, matching Spend Less v4.1.0's airy 80% opacity (was solid). Same hues, just glassy.

## What's New in v4.10.0

### Holdings — Notes Tooltip Shows Note

- Hovering the notes icon now shows the actual note (truncated to 60 chars with `…` at word boundary, collapsed whitespace) instead of generic `View notes`. Empty notes still show `Add note` faded. Applies to both table rows and mobile cards (`public/app.js` `noteTooltip`/`escAttr`).

### Closed — Lots Filters Now Auto + CSV Parity with Holdings

- **No more Filter button** — `Capital Gains Lots (FIFO)` filters on type (`input` debounced 300ms for Search, `change` for Year/Month) exactly like Holdings (`public/app.js` `debounce(loadClosed,300)`).
- **CSV download** — `Filter` replaced by `↓ CSV` (50/50 `Reset | ↓ CSV` via `holdings-filter-actions`, same `filter-reset-btn flex:1` on web + `filter-actions button flex:1` on mobile). CSV exports the currently filtered lots (`GET /api/capital-gains?search=&year=&month=&fy=`) as `Asset,Buy Date,Sell Date,Qty,Cost,Proceeds,Gain,Type,Days` → `portfolio-lots-YYYY-MM-DD.csv`.
- **Totals row moved** — `LTCG/STCG` totals are now a full-width faint bar (`holdings-summary-bar #cg-summary`) below the `Reset|CSV` row above the table, not an inline span beside the old Filter button — matches Holdings footer placement. Mobile bottom sheet no longer auto-closes on Filter/Reset; stays like Holdings (open/close via chip/close/overlay).

## What's New in v4.9.0

### Closed — Period Filter (Universal, Not FY) + Mobile Parity
- **FY → Period** — `Capital Gains Lots (FIFO)` now filters by `Period` (`Year [All▼]` 2020-2032 + `Month [All/January…December]`) and `Search` (asset name), not `FY 2026-27` text box. `FY Apr→Mar` kept for backward compat (`?fy=` still works), but `?year=2026&month=08` is universal (Jan→Dec) for `THB`/`USD`/`EUR`. See `server.js` `/api/capital-gains?year=&month=&search=`.
- **Mobile** — `Closed` now has `Mobile search bar + Filters chip → bottom sheet` (like `Holdings`), `Year`/`Month`/`Search` inside the sheet, `Reset` clears all. Desktop keeps `Filters` row inline + `Filter` button. No horizontal scroll (`Closed` tables hide `≤768px`, card stacks show).

### Edit — Ticker Alignment on Web
- `Edit Holding` `Ticker` hint `Optional for sells — only needed for live prices. Asset name is enough.` was a separate grid item to the right of the field → now inside the `Ticker` label below the input (`<small>`), so it stacks vertically and aligns to the field (same as `Proceeds` hint). Applies to `Add` too.

## What's New in v4.8.0

### Holdings Footer — Dual Currency & Clear Labels
- **Clearly spelled out** — footer now `7 entries — Invested: ₹X | Current Value: ₹Y | P&L: ₹Z` (was `entries | Invested: …`). Uses `—` and full `Current Value`.
- **Foreign also shown** — when filtered rows are single foreign currency (e.g. `USD` with base `INR`), footer appends ` (USD: Invested $A | Value $B | P&L $C)` using raw `invested_amount`/`current_value` in that currency. No double-count for mixed-currency views.

### FX & Edit Fixes
- **USD sell FX fixed** — `FIFO` proceeds now convert `sell price (USD) × FX` to base `INR` when `invested_base` is not manually entered; when you fill `Proceeds received in INR` (e.g. Tesla `₹40,000`), that manual base value is used directly. Closed `Proceeds` for Tesla now correctly shows `₹40,000` (was `₹398` from unconverted USD).
- **Edit popover** — `Invested in INR` box now correctly shows `Proceeds received in INR` when editing a `Sell` with `USD` currency (was stuck on `Invested`). Both `Buy/Sell` and `Currency` toggles now reword the box. `Ticker` is now optional for sells (hint: “only needed for live prices”).

### Closed Mobile — No Horizontal Scroll
- `Closed` tab tables (`Closed Positions` 7-col, `Lots` 9-col) now hide on mobile `≤768px` and show card stacks (`#closed-mobile-cards`, `#cg-lots-mobile-cards`) like `Holdings`/`Dashboard` (`pivot-mobile-cards`).

## What's New in v4.7.0

### Holdings → Sell UX Now Unambiguous (Option A)
- **Dynamic labels** — `Buy/Sell` toggle renames `Price` → `Buy Price (per unit)` / `Sell Price (per unit)`, `Quantity` → `Quantity` / `Quantity Sold`, `Amount Invested` → `Amount Invested` / `Proceeds`. Placeholders switch too (`e.g. 88.06` for sell). `Ticker` hides on sell.
- **Hint** — `Proceeds = Sell Price × Quantity Sold` appears only for sells (`visibility:hidden` when buy, so vertical alignment stays level).
- **Vertical alignment fix** — Holdings form grid now `align-items: start` with `min-height` hint; the `Proceeds` field no longer sits higher than `Quantity Sold`/`Currency` when sell is selected. See `public/style.css` `.grid` / `.field-hint`.

### Closed Tab — Currency-Aware Tax Hint
- **Generic vs India** — `Capital Gains Lots (FIFO)` description now checks `baseCurrency`. `INR` → `12.5% LTCG (Sec 112A) above ₹1,25,000 for equity >12mo — check current FY rules.` Non-INR → `FIFO — indicative, tax rules vary by country.` Prevents showing Indian exemption to US/EU users.
- **Rule in `AGENTS.md`** — added `Tax Law Maintenance` section: before any release, verify FY's 112A rate/exemption/holding period with CBDT and update `public/app.js` hint + `server.js` `gain_type` (>365d).

## What's New in v4.6.0

### Realized vs Unrealized — FIFO Cost Basis + Closed Positions
- **Bye phantom P&L** — `Dashboard` summary now splits `Invested (Open)` / `Current Value (Open)` / `Unrealized P&L` / `Realized P&L` / `Total P&L`. Full switch `SBI ELSS → Nifty 50` nets `Invested +1,45,702` to open, `Current Value` unchanged, `Realized +1,45,702` instead of lingering +1.45L as phantom.
- **FIFO lots** — `realized_lots` table built per asset on every `POST/PUT/DELETE` of holdings (`server.js` `rebuildAssetLots`). Sells consume oldest buys first; per-lot `gain`, `holding_days`, `LTCG (>365d)` vs `STCG`. Handles full and **partial** sells (partial leaves remaining qty/cost in pivot).
- **Closed Positions** — new `Closed` tab + `GET /api/closed-positions` aggregates fully-closed assets (`total_qty/cost/proceeds/realized_gain`) and per-lot table.
- **Capital Gains API** — `GET /api/capital-gains?fy=2026-27&asset=` filters by FY (Apr-Mar) and summarizes `ltcg/stcg` for tax. Used by Closed tab's FY filter.
- **Breakdown/Allocation/Monthly now open-only** — pivot, allocation, and `total_current_value` sum only open positions (`net qty × price` with `buy_price` fallback if no Yahoo price yet). Holdings ledger still keeps every transaction.
- **Export/import includes** `realized_lots` + `closed_positions` and rebuilds on import.

## What's New in v4.5.0

### Dashboard & Holdings — Mobile Cards Now Glanceable (Option B)
- **P&L % in header** — every mobile card header now shows both absolute P&L (`₹12,340`) and percentage (`4.20%`) stacked and color-coded (green/red). Category headers, asset cards, TOTAL card, and holdings cards all follow it. Web tables unchanged — desktop keeps its 9/15-column tables.
- **2×2 financial grid** — pivot category/asset/TOTAL cards use a 2-column grid: Invested | Current Value / Return% | XIRR. Holdings cards: Invested | Current Value / Qty @ Price | Current Price. Replaces the previous vertical `Units`-first list.
- **Secondary context line** — pivot assets show a faint foot line: `10.5 units @ avg ₹9,523 · Now ₹1,200`. Holdings meta is split into two lines: `BUY Equity · INR` on top, `date · broker` faint below (was one crammed line).
- **Day change clearer** — pivot assets prefix `Day:` and keep colored arrow.
- **Divider + spacing** — thin divider separates header/meta from grid; nested asset cards stay on `var(--bg)` vs page cards `var(--surface)`. Same `Outfit`/`Fraunces` fonts, only mobile cards changed.

## What's New in v4.4.0

### Holdings — Batch Bar Matches the Expense Tracker
- **Select All (mobile)** — the mobile batch bar now has a **Select All / Deselect All** toggle that selects every visible holding at once (label flips based on state). Desktop keeps its table-header "select all" checkbox.
- **"Clear Selection" → "Clear"** — nomenclature now matches the expense tracker.
- **Buttons restyled** — Apply and Clear now use the same ghost `.btn-secondary` style as the expense tracker's batch bar (transparent, theme-aware border/text) instead of the solid accent Apply button, so light and dark mode look consistent.

## What's New in v4.3.0

### Holdings — Batch Bar Now Honors the Theme
- **Batch action bar restyled** — the bar is now a soft strip that adapts to the theme (light and dark), matching the app's design language. In dark mode the Apply/Clear buttons were white-on-white (invisible) — fixed. The dropdown, Apply, and Clear all use theme colors.
- **Batch dropdown matches the buttons** — the batch action select is now the same height (34px) and styling as the adjacent Apply/Clear buttons (fixes the misaligned field on Safari and other browsers).

### Holdings (Mobile) — Long-Press to Select
- **Card checkboxes removed** — on mobile, holdings cards are no longer selected via a checkbox.
- **Long-press a card to select it** — hold ~0.5s to toggle selection: the batch bar appears, the card gets an accent highlight, and a haptic buzz confirms it.
- **Tap-to-toggle while the batch bar is open** — once the batch bar is visible, plain taps on other cards toggle them too, making multi-select fast (same pattern as the expense tracker's reports).
- Long-press on action buttons is ignored (buttons keep working), finger-move cancels (scrolling stays safe), and the native long-press context menu is suppressed.
- **Web unchanged** — the desktop table keeps its per-row checkboxes and Select All.

## What's New in v4.2.1

### Settings (Mobile) — Ticker Mapping No Longer Side-Scrolls
- **Asset names wrap instead of overflowing** — the last remaining horizontal-scroll spot is fixed: on mobile, the Ticker Mapping table's asset-name column is narrowed (~50%) and long asset names now wrap onto multiple lines (no ellipsis, nothing truncated). The ticker input and action buttons keep their natural width.
- **Mobile is now fully side-scroll free** — dashboard, holdings, watchlist, and settings all fit the screen width with no horizontal scrolling.
- **Web unchanged** — the desktop ticker table keeps its fixed layout and single-line names.

## What's New in v4.2.0

### Dashboard (Mobile) — Expandable Category Cards
- **Tap a category card to reveal its assets** — each category card is now an accordion: tapping the header expands a sub-card per asset (name, type, day change, units, invested, current value, current price, XIRR). Only one category is open at a time; the TOTAL card stays static.
- **Asset type always visible** — the asset name clamps to two lines with an ellipsis when long, and the type label sits on its own row underneath so it's never hidden.

### Holdings (Mobile) — Reset & CSV Outside the Filter Popover
- **Reset and ↓ CSV are always visible** — they moved out of the Filters bottom-sheet into their own row beside the search bar (matching the expense tracker's reports tab). The popover now only holds the search + year/month/category/broker/currency selectors.
- **Reset clears the mobile search box too.**

### Form Field Colors — Dropdown vs Text Input
- **Dropdowns use the second-level color** — every `select` (add/edit forms, filters, settings) now uses the `--surface` (second sepia) background; **text inputs keep the near-white `--elevated` background**. Applied on mobile and web, matching the expense tracker's pattern.

### Web — Holdings Filters Row Full Width
- **Filters row spans the full card** — the year/month/category/broker/currency selectors are widened ~10–20% and the search box absorbs the rest, so the first row fills the width like the Reset/CSV row below it.

## What's New in v4.1.0

### Mobile — No Horizontal Scrolling
- **Holdings tab → transaction cards** — on mobile (≤768px), each transaction renders as a card instead of the 14-column table: asset name + P&L (colored), buy/sell badge · date · broker · category · currency, and a 2×2 grid (Invested, Current Value, Current Price, Qty) with the usual edit/copy/notes/delete actions. P&L % and buy price are dropped from the mobile card only; the desktop table keeps every column.
- **Dashboard → category cards** — the Category Breakdown pivot table becomes category-level cards on mobile (category name + P&L, asset count, Invested / Current Value / XIRR) plus a TOTAL card. Assets stay collapsed on mobile; the desktop pivot table is unchanged.
- **Watchlist → cards** — each watchlist item renders as a card (name + price, ticker + source badge, actions) on mobile.
- **Desktop unchanged** — the web/desktop layout, tables, and columns are exactly as before; the mobile cards are hidden and only tables show.
- **Batch select works on cards** — card checkboxes feed the same batch action bar (update category/type/broker, rename, delete) as the desktop table.

## What's New in v4.0.0

### Rebrand — "Invest More"
- **New name** — the app is now called **Invest More** (was "Portfolio+") everywhere: browser tab title, header, PWA install name, iOS home-screen title, lock screen, and server startup log
- **New icons** — all icons (favicon, PWA icons, apple-touch-icon) redesigned as a **Fraunces wordmark** — the same serif as the header title — with "Invest" and "More" stacked on two rows in sepia on a dark rounded square, baked as vector paths so they render identically on every platform
- **Same app, new look** — no data or functionality changed; only branding and icons

## What's New in v3.15.0

### New Transaction Form Fixes
- **Asset Name no longer overlaps Category** — the Asset Name input (which uses an autocomplete wrapper for the suggestions dropdown) was keeping its default intrinsic width instead of filling its grid column, causing it to spill over the Category dropdown next to it. All form inputs/selects now fill their grid cell (`width: 100%`).
- **FAB reads "New transaction"** — the floating action button now shows a text label ("New transaction", lowercase "t") alongside the plus icon, matching the Spend Less "Add expense" FAB style. It changed from a plain circular icon button to a pill-shaped button with text.
- **Removed drag handle** — the little horizontal drag bar at the top of the New Transaction and Filters bottom-sheet pop-overs has been removed.

## What's New in v3.14.0

### Warm Sepia Light Theme
- **Warm off-white background** — light theme now uses a warm, sepia-tinted off-white (`#f5efe6` page / `#fdfbf7` cards) instead of cool gray (`#f4f4f4`) / pure white (`#ffffff`); easier on the eyes for long sessions
- **Complementary palette retinted warm** — text (`#2c241b`), secondary/faint text (`#6b5c4c` / `#9a8a7a`), borders (`#e8ddd0` / `#ede5d8`), and focus glows (`rgba(44,36,27,0.06/0.11)`) all shifted warm so cards, inputs, dividers, and active states feel cohesive on the sepia background
- **PWA + lock screen updated** — `meta theme-color`, `manifest.json` `background_color`/`theme_color`, and the server-rendered lock page (`server.js`) all now use the sepia tokens so the standalone/PWA chrome and pre-auth screen match the app

### Dark Theme Contrast Lift
- **More hierarchy in dark** — dark `--surface` lifted from `#0a0a0a` → `#141414` and borders from `#1f1f1f` → `#2a2a2a` (`--border-subtle` `#161616` → `#1e1e1e`) so cards lift off the pitch-black `#000000` page; lock-screen dark borders updated to `#232323` to match
- **Applies to both `data-theme="dark"` and `prefers-color-scheme` fallback** — no change to accent or semantic colors

## What's New in v3.13.2

### Dark Mode Fix
- **Pitch black background** — dark mode `--bg` changed from `#0a0a0a` to `#000000` for a true pitch-black background, matching Scrawl's dark theme

## What's New in v3.13.1

### Remaining Emoji Cleanup
- **Lock badge** — replaced 🔒 emoji with inline SVG padlock icon in the App Lock section
- **Recovery warning** — replaced ⚠ emoji with inline SVG warning triangle icon in the PIN setup recovery message

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
- **Complete visual redesign** — unified design language shared with Spend Less and other suite apps (Dictation Tool, DocuChat AI)
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

### Font & Style Consistency (with Spend Less)
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
- **Summary bar moved above table** — The entries/invested/value/P&L summary now displays above the holdings table in a subtle, compact style (matching the Spend Less reports tab)

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
