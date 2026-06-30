(function () {
  "use strict";

  //--- Theme Management (auto-detect system preference) ---
  function applySystemTheme() {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
  }
  applySystemTheme();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applySystemTheme);

  //--- Tab Navigation ---
  const tabBtns = document.querySelectorAll(".bottom-nav-btn");
  const tabContents = document.querySelectorAll(".tab-content");
  let currentTab = "dashboard";

  function switchToTab(tabName) {
    if (currentTab === tabName) return;
    currentTab = tabName;
    tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
    tabContents.forEach(c => c.classList.toggle("active", c.id === "tab-" + tabName));
    loadTabData(tabName);
  }

  function loadTabData(tabName) {
    if (tabName === "dashboard") loadDashboard();
    else if (tabName === "holdings") loadHoldings();
    else if (tabName === "watchlist") loadWatchlist();
    else if (tabName === "settings") loadSettings();
  }

  // Tab click handlers
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => switchToTab(btn.dataset.tab));
  });

  //--- State Variables ---
  let assetClasses = [];
  let assetTypes = [];
  let brokers = [];
  let displayCurrency = "";
  let baseCurrency = "";
  let altCurrency = "";
  let altRate = 1;
  let currencyConfigured = false;
  let dateFormat = "MM/DD/YYYY";
  let selectedIds = new Set();
  let renameOldName = "";
  let notesCurrentId = null;
  let cachedRateData = null; // Cached exchange rate for holdings tab

  const DASHBOARD_CACHE_KEY = "portfolio_dashboard_cache";
  const DASHBOARD_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  function invalidateDashboardCache() {
    localStorage.removeItem(DASHBOARD_CACHE_KEY);
  }

  let classPieChart = null, valueTrendChart = null, monthlyChart = null, vintageChart = null;

  const CATEGORY_COLORS = {
  "India": "#3b82f6",
  "US": "#10b981",
  "Gold": "#f59e0b",
  "Crypto": "#8b5cf6"
};

const FALLBACK_COLORS = [
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#14b8a6",
  "#a855f7",
  "#eab308"
];

function getCategoryColor(category, index = 0) {
  return CATEGORY_COLORS[category] ||
         FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

  //--- Locale & Formatting Helpers ---
  function getLocaleForCurrency(cur) {
    const map = {
      INR: "en-IN", USD: "en-US", EUR: "de-DE", GBP: "en-GB", JPY: "ja-JP",
      CNY: "zh-CN", SGD: "en-SG", AED: "ar-AE", AUD: "en-AU", CAD: "en-CA",
      CHF: "de-CH", HKD: "en-HK", KRW: "ko-KR", MYR: "ms-MY", NZD: "en-NZ",
      SAR: "ar-SA", SEK: "sv-SE", THB: "th-TH", TWD: "zh-TW", ZAR: "en-ZA"
    };
    return map[cur] || "en-US";
  }

  function getActiveLocale() {
    if (currencyConfigured && displayCurrency) return getLocaleForCurrency(displayCurrency);
    if (baseCurrency) return getLocaleForCurrency(baseCurrency);
    return "en-IN";
  }

  function fmt(n, currency) {
    if (n == null || isNaN(n)) return "-";
    const locale = currency ? getLocaleForCurrency(currency) : getActiveLocale();
    const sym = getCurrencySymbol(currency || displayCurrency || baseCurrency || "INR");
    return sym + Number(n).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtCompact(n) {
    if (n == null || isNaN(n)) return "-";
    return Number(n).toLocaleString(getActiveLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtWhole(n) {
    if (n == null || isNaN(n)) return "-";
    return Math.round(Number(n)).toLocaleString(getActiveLocale());
  }

  function fmtQty(n) {
    if (n == null) return "";
    return Number(n).toFixed(8).replace(/\.?0+$/, "");
  }

  function fmtUnits(n) {
    if (n == null || isNaN(n)) return "-";
    if (n >= 1000) return Number(n).toLocaleString(getActiveLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return Number(n).toFixed(6).replace(/\.?0+$/, "");
  }

  function fmtPct(n) {
    if (n == null || isNaN(n)) return "-";
    return n.toFixed(2) + "%";
  }

  function getCurrencySymbol(cur) {
    const symbols = { INR: "₹", USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", SGD: "S$", AED: "د.إ" };
    return symbols[cur] || cur + " ";
  }

  function formatDate(iso) {
    if (!iso) return "-";
    const [y, m, d] = iso.split("-");
    if (dateFormat === "DD/MM/YYYY") return `${d}/${m}/${y}`;
    if (dateFormat === "YYYY-MM-DD") return iso;
    return `${m}/${d}/${y}`;
  }

  function showMsg(el, msg, type) {
    el.textContent = msg;
    el.className = "form-msg " + type;
    setTimeout(() => { el.textContent = ""; }, 3000);
  }

  //--- Toast notifications ---
  function toast(msg, type) {
    const container = document.getElementById("toast-container");
    const div = document.createElement("div");
    div.className = "toast toast-" + (type || "info");
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(() => { div.remove(); }, 3000);
  }

  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function btnLoading(btn, loading) {
    if (loading) {
      btn.classList.add("btn-loading");
      btn.disabled = true;
    } else {
      btn.classList.remove("btn-loading");
      btn.disabled = false;
    }
  }

  //--- Safe fetch wrapper (fix #5.1) ---
  async function apiFetch(url, options) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return res.json();
    } catch (e) {
      if (e.message && !e.message.startsWith("HTTP")) {
        // Network error vs API error
        throw e;
      }
      throw e;
    }
  }

  function updateCurrencyToggleBtn() {
    const btn = document.getElementById("currency-toggle");
    if (!currencyConfigured) {
      btn.style.display = "none";
      return;
    }
    btn.style.display = "";
    const sym = getCurrencySymbol(displayCurrency);
    btn.textContent = `${sym} ${displayCurrency}`;
    btn.title = `Viewing in ${displayCurrency}. Click to switch.`;
  }

  function toDisplayCurrency(valueInBase) {
    if (!currencyConfigured) return valueInBase;
    if (displayCurrency === baseCurrency) return valueInBase;
    // Guard against zero/null rate (fix #1.10)
    if (!altRate || altRate <= 0) return valueInBase;
    return valueInBase / altRate;
  }

  async function loadDropdowns() {
    try {
      [assetClasses, assetTypes, brokers] = await Promise.all([
        apiFetch("/api/settings/asset-classes"),
        apiFetch("/api/settings/asset-types"),
        apiFetch("/api/settings/brokers")
      ]);
    } catch (e) {
      console.error("Failed to load dropdowns:", e);
      return;
    }
    populateSelect("add-asset-class", assetClasses, true);
    populateSelect("add-asset-type", assetTypes, true);
    populateSelect("add-broker", brokers, true);
    populateSelect("edit-asset-class", assetClasses, true);
    populateSelect("edit-asset-type", assetTypes, true);
    populateSelect("edit-broker", brokers, true);
    populateSelect("filter-class", assetClasses, true, "All");
    populateSelect("filter-broker", brokers, true, "All");
  }

  function populateSelect(id, items, addEmpty, emptyLabel) {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = "";
    if (addEmpty) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = emptyLabel || "- None -";
      sel.appendChild(opt);
    }
    for (const item of items) {
      const opt = document.createElement("option");
      opt.value = item.name;
      opt.textContent = item.name;
      sel.appendChild(opt);
    }
  }

  function populateYearFilter() {
  const sel = document.getElementById("filter-year");
  if (!sel) return;

  const currentYear = new Date().getFullYear();

  sel.innerHTML = '<option value="">All</option>';

  for (let y = 2032; y >= 2020; y--) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  }
}

  //--- Autocomplete Setup ---
  function setupAutocomplete(inputId, listId) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    if (!input || !list) return;

    input.addEventListener("input", debounce(async () => {
      const q = input.value.trim();
      if (q.length < 1) { list.innerHTML = ""; list.style.display = "none"; return; }
      try {
        const suggestions = await apiFetch("/api/autocomplete/assets?q=" + encodeURIComponent(q));
        if (suggestions.length === 0) { list.innerHTML = ""; list.style.display = "none"; return; }
        list.innerHTML = suggestions.map(s => `<li class="autocomplete-item">${s}</li>`).join("");
        list.style.display = "block";
        // Position the dropdown: flip above if near bottom (fix #3.9)
        positionAutocomplete(input, list);
      } catch(e) {
        list.innerHTML = ""; list.style.display = "none";
      }
    }, 200));

    list.addEventListener("click", async (e) => {
      if (e.target.classList.contains("autocomplete-item")) {
        input.value = e.target.textContent;
        list.innerHTML = "";
        list.style.display = "none";
        try {
          const tickerData = await apiFetch("/api/ticker-for-asset?name=" + encodeURIComponent(input.value));
          if (tickerData.ticker) {
            document.getElementById("add-ticker").value = tickerData.ticker;
          }
        } catch(e) {}
      }
    });

    document.addEventListener("click", (e) => {
      if (!input.contains(e.target) && !list.contains(e.target)) {
        list.style.display = "none";
      }
    });
  }

  // Flip autocomplete above input if near viewport bottom (fix #3.9)
  function positionAutocomplete(input, list) {
    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      list.style.top = "auto";
      list.style.bottom = "100%";
      list.style.marginBottom = "4px";
      list.style.marginTop = "0";
    } else {
      list.style.top = "100%";
      list.style.bottom = "auto";
      list.style.marginTop = "4px";
      list.style.marginBottom = "0";
    }
  }

  function setupTxnTypeToggle() {
    const txnSelect = document.getElementById("add-txn-type");
    const tickerLabel = document.getElementById("ticker-label");
    txnSelect.addEventListener("change", () => {
      tickerLabel.style.display = txnSelect.value === "sell" ? "none" : "";
    });
  }

  function setupCurrencyToggleForInvestedBase() {
    const addCurrencySelect = document.getElementById("add-currency");
    const addInvestedBaseLabel = document.getElementById("add-invested-base-label");
    const addInvestedBaseCurrency = document.getElementById("add-invested-base-currency");

    function updateAddInvestedBase() {
      if (!currencyConfigured) { addInvestedBaseLabel.style.display = "none"; return; }
      const selectedCurrency = addCurrencySelect.value;
      const defaultCur = baseCurrency;
      if (selectedCurrency && selectedCurrency !== defaultCur) {
        addInvestedBaseCurrency.textContent = defaultCur;
        addInvestedBaseLabel.style.display = "";
      } else {
        addInvestedBaseLabel.style.display = "none";
      }
    }
    addCurrencySelect.addEventListener("change", updateAddInvestedBase);
    setTimeout(updateAddInvestedBase, 500);

    const editCurrencySelect = document.getElementById("edit-currency");
    const editInvestedBaseLabel = document.getElementById("edit-invested-base-label");
    const editInvestedBaseCurrency = document.getElementById("edit-invested-base-currency");

    editCurrencySelect.addEventListener("change", () => {
      if (!currencyConfigured) { editInvestedBaseLabel.style.display = "none"; return; }
      const selectedCurrency = editCurrencySelect.value;
      const defaultCur = baseCurrency;
      if (selectedCurrency && selectedCurrency !== defaultCur) {
        editInvestedBaseCurrency.textContent = defaultCur;
        editInvestedBaseLabel.style.display = "";
      } else {
        editInvestedBaseLabel.style.display = "none";
      }
    });
  }

  //--- Dashboard Data Loader ---

  function getDashboardCache() {
    try {
      const raw = localStorage.getItem(DASHBOARD_CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (Date.now() - cached.timestamp < DASHBOARD_CACHE_TTL) return cached.data;
    } catch(e) {}
    return null;
  }

  function setDashboardCache(summary, breakdown) {
    try {
      localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({ data: { summary, breakdown }, timestamp: Date.now() }));
    } catch(e) {}
  }

  function renderDashboard(summary, breakdown) {
    const grid = document.getElementById("summary-grid");
    grid.innerHTML = "";

    altCurrency = summary.display_rate_currency;
    altRate = summary.display_rate;
    if (summary.default_currency) {
      baseCurrency = summary.default_currency;
      currencyConfigured = true;
    } else {
      baseCurrency = "";
      currencyConfigured = false;
    }

    if (currencyConfigured) {
      if (displayCurrency !== baseCurrency && displayCurrency !== altCurrency) {
        displayCurrency = baseCurrency;
      }
    } else {
      displayCurrency = "";
    }
    updateCurrencyToggleBtn();

    const curSym = currencyConfigured ? getCurrencySymbol(displayCurrency) : "";
    const totalItems = [
      { label: "Total Invested", value: toDisplayCurrency(summary.total.invested) },
      { label: "Current Value", value: toDisplayCurrency(summary.total.current_value) },
      { label: "Total P&L", value: toDisplayCurrency(summary.total.gain_loss), isChange: true, rawInvested: toDisplayCurrency(summary.total.invested) }
    ];

    // Day change card (only show if data is available)
    if (summary.total.day_change != null && summary.total.day_change !== 0) {
      totalItems.push({ label: "Day Change", value: toDisplayCurrency(summary.total.day_change), isDayChange: true, dayPct: summary.total.day_change_pct });
    }

    // Top gainer today card
    if (summary.top_gainer) {
      totalItems.push({ label: "Top Gainer Today", isTopGainer: true, assetName: summary.top_gainer.name, pct: summary.top_gainer.pct });
    }

    if (currencyConfigured && altRate && altCurrency && altCurrency !== baseCurrency) {
      totalItems.push({ label: `${altCurrency}/${baseCurrency}`, value: altRate, isRate: true });
    }

    for (const item of totalItems) {
      const div = document.createElement("div");
      div.className = "summary-item";
      if (item.isChange) {
        const cls = item.value >= 0 ? "positive" : "negative";
        const arrow = item.value >= 0 ? "▲" : "▼";
        const pct = item.rawInvested ? ((item.value / item.rawInvested) * 100).toFixed(2) + "%" : "";
        div.innerHTML = `<div class="label">${item.label}</div>
                         <div class="value ${cls}">${curSym}${fmtWhole(Math.abs(item.value))}</div>
                         <div class="change ${cls}">${arrow} ${pct}</div>`;
      } else if (item.isDayChange) {
        const cls = item.value >= 0 ? "positive" : "negative";
        const arrow = item.value >= 0 ? "▲" : "▼";
        const pct = item.dayPct != null ? Math.abs(item.dayPct).toFixed(2) + "%" : "";
        div.innerHTML = `<div class="label">${item.label}</div>
                         <div class="value ${cls}">${arrow} ${curSym}${fmtWhole(Math.abs(item.value))}</div>
                         <div class="change ${cls}">${pct}</div>`;
      } else if (item.isTopGainer) {
        const cls = item.pct >= 0 ? "positive" : "negative";
        const arrow = item.pct >= 0 ? "▲" : "▼";
        div.innerHTML = `<div class="label">${item.label}</div>
                         <div class="value summary-truncate">${item.assetName}</div>
                         <div class="change ${cls}">${arrow} ${Math.abs(item.pct).toFixed(2)}%</div>`;
      } else if (item.isRate) {
        div.innerHTML = `<div class="label">${item.label}</div>
                         <div class="value">${currencyConfigured ? getCurrencySymbol(baseCurrency) : ""}${Number(item.value).toFixed(2)}</div>`;
      } else {
        div.innerHTML = `<div class="label">${item.label}</div>
                         <div class="value">${curSym}${fmtWhole(item.value)}</div>`;
      }
      grid.appendChild(div);
    }

    // --- Render Category Doughnut ---
    const classLabels = Object.keys(summary.by_class);
    const classValues = classLabels.map(k => summary.by_class[k].current_value);
    const classColors = classLabels.map((label, index) =>
  getCategoryColor(label, index)
);
    const totalVal = classValues.reduce((s, v) => s + v, 0);

    if (classPieChart) classPieChart.destroy();
    const classPieCanvas = document.getElementById("class-pie");
    const classInvested = classLabels.map(k => toDisplayCurrency(summary.by_class[k].invested));
    classPieChart = new Chart(classPieCanvas, {
      type: "bar",
      data: {
        labels: classLabels,
        datasets: [
          { label: "Current Value", data: classValues.map(v => toDisplayCurrency(v)), backgroundColor: classColors.slice(0, classLabels.length), borderRadius: 4, order: 2 },
          { label: "Invested", data: classInvested, type: "line", borderColor: "rgba(150,150,150,0.7)", backgroundColor: "rgba(150,150,150,0.3)", pointBackgroundColor: "rgba(150,150,150,0.9)", pointRadius: 4, borderWidth: 2, fill: false, indexAxis: "y", order: 1 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: "y",
        plugins: {
          legend: { display: true, position: "bottom", labels: { boxWidth: 12, font: { size: 10 } } },
          tooltip: { callbacks: { label: (ctx) => {
            if (ctx.datasetIndex === 0) return " Value: " + curSym + fmtCompact(ctx.raw) + ` (${totalVal ? (classValues[ctx.dataIndex] / totalVal * 100).toFixed(1) : 0}%)`;
            return " Invested: " + curSym + fmtCompact(ctx.raw);
          } } }
        },
        scales: {
          x: { display: false },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } }
        }
      }
    });

    // --- Load value trend + monthly chart + vintage ---
    loadValueTrend(currentTrendMonths);
    loadMonthlyChart(currentBarMonths);
    loadVintageChart(currentVintageMonths);
    renderPivotTable(breakdown);
  }

  async function loadDashboard() {
    const grid = document.getElementById("summary-grid");

    // Try instant render from cache
    const cached = getDashboardCache();
    if (cached) {
      renderDashboard(cached.summary, cached.breakdown);
      // Background refresh
      Promise.all([apiFetch("/api/summary"), apiFetch("/api/breakdown")])
        .then(([summary, breakdown]) => {
          setDashboardCache(summary, breakdown);
          renderDashboard(summary, breakdown);
        }).catch(() => {});
      return;
    }

    // No cache — show skeleton, fetch, render
    grid.innerHTML = `
      <div class="summary-item skeleton-item"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
      <div class="summary-item skeleton-item"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
      <div class="summary-item skeleton-item"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
      <div class="summary-item skeleton-item"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
    `;

    let summary, breakdown;
    try {
      [summary, breakdown] = await Promise.all([
        apiFetch("/api/summary"),
        apiFetch("/api/breakdown")
      ]);
    } catch (e) {
      grid.innerHTML = '<div class="summary-item"><div class="label">Error</div><div class="value">Failed to load dashboard</div></div>';
      return;
    }

    setDashboardCache(summary, breakdown);
    renderDashboard(summary, breakdown);
  }

  //--- Value Trend Chart ---
  async function loadValueTrend(months) {
    let data;
    try {
      data = await apiFetch("/api/monthly-investments?months=" + months);
    } catch(e) { return; }
    const curSym = currencyConfigured ? getCurrencySymbol(displayCurrency) : "";

    const labels = data.months.map(m => {
      const [y, mo] = m.month.split("-");
      return new Date(y, mo - 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
    });

    const cumulative = data.months.map(m => toDisplayCurrency(m.cumulative_invested));
    const portfolioValue = toDisplayCurrency(data.total_current_value || 0);
    const lastCum = cumulative[cumulative.length - 1] || 0;
    const valueTrend = cumulative.map(cum => lastCum === 0 ? 0 : (cum / lastCum) * portfolioValue);

    if (valueTrendChart) valueTrendChart.destroy();
    const trendCanvas = document.getElementById("value-trend-chart");
    valueTrendChart = new Chart(trendCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Invested", data: cumulative, borderColor: "#6366f1", backgroundColor: "rgba(99, 102, 241, 0.05)", borderWidth: 2, borderDash: [5, 3], pointRadius: 1, pointHoverRadius: 3, tension: 0.3, fill: true },
          { label: "Portfolio Value", data: valueTrend, borderColor: "#10b981", backgroundColor: "rgba(16, 185, 129, 0.08)", borderWidth: 2.5, pointRadius: 1, pointHoverRadius: 3, fill: true, tension: 0.3 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 10 }, padding: 6, boxWidth: 10 } },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + curSym + fmtCompact(ctx.raw) } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => curSym + fmtCompact(v), font: { size: 9 } }, grid: { color: "rgba(0,0,0,0.05)" } },
          x: { grid: { display: false }, ticks: { font: { size: 8 }, maxRotation: 45, maxTicksLimit: 8 } }
        }
      }
    });
  }

  //--- Monthly Investments Bar Chart ---
  async function loadMonthlyChart(months) {
    let data;
    try {
      data = await apiFetch("/api/monthly-investments?months=" + months);
    } catch(e) { return; }
    const curSym = currencyConfigured ? getCurrencySymbol(displayCurrency) : "";

    const labels = data.months.map(m => {
      const [y, mo] = m.month.split("-");
      return new Date(y, mo - 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
    });

  
    const barDatasets = (data.classes || []).map((cls, i) => ({
      label: cls,
      data: data.months.map(m => toDisplayCurrency(m.by_class[cls] || 0)),
      backgroundColor: getCategoryColor(cls, i),
      borderRadius: i === (data.classes.length - 1) ? 4 : 0,
      stack: "invested"
    }));

    if (monthlyChart) monthlyChart.destroy();
    const monthlyCanvas = document.getElementById("monthly-chart");
    monthlyChart = new Chart(monthlyCanvas, {
      type: "bar",
      data: { labels, datasets: barDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 9 }, boxWidth: 10, padding: 5 } },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + curSym + fmtCompact(ctx.raw) } }
        },
        scales: {
          y: { beginAtZero: true, stacked: true, ticks: { callback: (v) => curSym + fmtCompact(v), font: { size: 9 } }, grid: { color: "rgba(0,0,0,0.05)" } },
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 8 }, maxRotation: 45, maxTicksLimit: 8 } }
        }
      }
    });
  }

  //--- Vintage / Cohort Return Chart ---
  let vintageData = null;
  let currentVintageCategory = ""; // empty = All

  async function loadVintageChart(months) {
    try {
      vintageData = await apiFetch("/api/vintage-returns");
    } catch(e) { return; }

    if (!vintageData.months || vintageData.months.length === 0) return;

    // Render category filter buttons
    renderVintageFilters(vintageData.categories);
    renderVintageChartData(months);
  }

  function renderVintageFilters(categories) {
    const row = document.getElementById("vintage-filter-row");
    row.innerHTML = "";

    const allBtn = document.createElement("button");
    allBtn.className = "vintage-filter-btn" + (currentVintageCategory === "" ? " active" : "");
    allBtn.textContent = "All";
    allBtn.addEventListener("click", () => {
      currentVintageCategory = "";
      row.querySelectorAll(".vintage-filter-btn").forEach(b => b.classList.remove("active"));
      allBtn.classList.add("active");
      renderVintageChartData(currentVintageMonths);
    });
    row.appendChild(allBtn);

    for (const cls of categories) {
      const btn = document.createElement("button");
      btn.className = "vintage-filter-btn" + (currentVintageCategory === cls ? " active" : "");
      btn.textContent = cls;
      btn.addEventListener("click", () => {
        currentVintageCategory = cls;
        row.querySelectorAll(".vintage-filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderVintageChartData(currentVintageMonths);
      });
      row.appendChild(btn);
    }
  }

  function renderVintageChartData(months) {
    if (!vintageData || !vintageData.months) return;

    const allMonths = vintageData.months;
    let filtered;

    if (currentVintageCategory) {
      // Only include months that have data for this category
      filtered = allMonths
        .filter(m => m.by_class[currentVintageCategory] && m.by_class[currentVintageCategory].invested > 0)
        .map(m => ({
          month: m.month,
          invested: m.by_class[currentVintageCategory].invested,
          current_value: m.by_class[currentVintageCategory].current_value,
          pnl_pct: Math.round(m.by_class[currentVintageCategory].pnl_pct * 100) / 100
        }));
    } else {
      filtered = allMonths;
    }

    // Slice to requested range
    const sliced = (months && months > 0) ? filtered.slice(-months) : filtered;

    if (sliced.length === 0) {
      if (vintageChart) vintageChart.destroy();
      vintageChart = null;
      return;
    }

    const labels = sliced.map(m => {
      const [y, mo] = m.month.split("-");
      return new Date(y, mo - 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
    });
    const pnlValues = sliced.map(m => m.pnl_pct);

    const pointColors = pnlValues.map(v => v >= 0 ? "rgba(16, 185, 129, 0.8)" : "rgba(239, 68, 68, 0.8)");

    // Pick line color based on category
    const categoryIdx = currentVintageCategory ? vintageData.categories.indexOf(currentVintageCategory) : -1;
    const lineColor = currentVintageCategory ? getCategoryColor(currentVintageCategory, categoryIdx) : "#8b5cf6";

    if (vintageChart) vintageChart.destroy();
    const canvas = document.getElementById("vintage-chart");
    vintageChart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: currentVintageCategory || "All",
          data: pnlValues,
          borderColor: lineColor,
          backgroundColor: function(context) {
            const chart = context.chart;
            const { ctx, chartArea } = chart;
            if (!chartArea) return "rgba(139, 92, 246, 0.1)";
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, lineColor + "4D"); // 30% opacity
            gradient.addColorStop(1, lineColor + "05"); // ~2% opacity
            return gradient;
          },
          borderWidth: 2.5,
          pointRadius: 2,
          pointHoverRadius: 5,
          pointBackgroundColor: pointColors,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => items[0].label,
              label: (ctx) => {
                const m = sliced[ctx.dataIndex];
                const curSym = currencyConfigured ? getCurrencySymbol(displayCurrency) : "";
                return [
                  `P&L: ${ctx.raw >= 0 ? "+" : ""}${ctx.raw.toFixed(2)}%`,
                  `Invested: ${curSym}${fmtCompact(toDisplayCurrency(m.invested))}`,
                  `Value: ${curSym}${fmtCompact(toDisplayCurrency(m.current_value))}`
                ];
              }
            }
          }
        },
        scales: {
          y: {
            ticks: { callback: (v) => v.toFixed(0) + "%", font: { size: 9 } },
            grid: { color: "rgba(0,0,0,0.05)" }
          },
          x: {
            grid: { display: false },
            ticks: { font: { size: 8 }, maxRotation: 45, maxTicksLimit: 10 }
          }
        }
      }
    });
  }

  //--- Range Buttons Setup ---
  let currentBarMonths = 12;
  let currentTrendMonths = 12;
  let currentVintageMonths = 0; // default All

  document.querySelectorAll(".range-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".range-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentBarMonths = Number(btn.dataset.months);
      loadMonthlyChart(currentBarMonths);
    });
  });

  document.querySelectorAll(".range-btn-trend").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".range-btn-trend").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentTrendMonths = Number(btn.dataset.months);
      loadValueTrend(currentTrendMonths);
    });
  });

  document.querySelectorAll(".range-btn-vintage").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".range-btn-vintage").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentVintageMonths = Number(btn.dataset.months);
      loadVintageChart(currentVintageMonths);
    });
  });


  //--- Pivot Table Breakdown ---
  function renderPivotTable(breakdown) {
    const pivotBody = document.getElementById("pivot-rows");
    const pivotFooter = document.getElementById("pivot-footer");
    pivotBody.innerHTML = ""; pivotFooter.innerHTML = "";

    let grandInvested = 0, grandValue = 0;
    const curSym = currencyConfigured ? getCurrencySymbol(displayCurrency) : "";
    const defaultCur = baseCurrency || "";

    let hasForeignCurrency = false;
    for (const cls of breakdown.classes) {
      for (const asset of cls.assets) {
        if (asset.currency && asset.currency !== defaultCur) { hasForeignCurrency = true; break; }
      }
    }

    const tooltipWrap = document.getElementById("pivot-fx-tooltip-wrap");
    if (tooltipWrap) {
      if (hasForeignCurrency && defaultCur) {
        document.getElementById("pivot-fx-tooltip-text").innerHTML = `Foreign currency investments are shown converted to ${defaultCur}. The invested amount reflects what you actually spent in ${defaultCur}. <br>To view original currency amounts, see the Holdings tab.`;
        tooltipWrap.style.display = "inline-block";
      } else {
        tooltipWrap.style.display = "none";
      }
    }

    for (const cls of breakdown.classes) {
      grandInvested += cls.invested;
      grandValue += cls.current_value;

      const dInvested = toDisplayCurrency(cls.invested);
      const dValue = toDisplayCurrency(cls.current_value);
      const dGain = toDisplayCurrency(cls.gain_loss);
      const plPct = cls.invested > 0 ? ((cls.gain_loss / cls.invested) * 100).toFixed(2) : "0.00";
      const plClass = cls.gain_loss >= 0 ? "positive" : "negative";

      const parentTr = document.createElement("tr");
      parentTr.className = "pivot-parent";
      parentTr.dataset.class = cls.asset_class;
      parentTr.innerHTML = `
        <td class="pivot-parent-cell">
          ${cls.asset_class}
        </td>
        <td class="col-amount">-</td>
        <td class="col-amount">${curSym}${fmtCompact(dInvested)}</td>
        <td class="col-amount">-</td>
        <td class="col-amount">${curSym}${fmtCompact(dValue)}</td>
        <td class="col-amount">-</td>
        <td class="col-amount ${plClass}">${curSym}${fmtCompact(dGain)}</td>
        <td class="col-amount ${plClass}">${plPct}%</td>
      `;
      pivotBody.appendChild(parentTr);

      for (const asset of cls.assets) {
        const adInvested = toDisplayCurrency(asset.invested);
        const adValue = toDisplayCurrency(asset.current_value);
        const adGain = toDisplayCurrency(asset.gain_loss);
        const adPrice = asset.current_price ? toDisplayCurrency(asset.current_price) : null;
        const aPlPct = asset.invested > 0 ? ((asset.gain_loss / asset.invested) * 100).toFixed(2) : "0.00";
        const aPlClass = asset.gain_loss >= 0 ? "positive" : "negative";
        const curPriceStr = adPrice ? curSym + fmtCompact(adPrice) : "-";

        // Day change %
        let dayChgStr = "-";
        if (asset.day_change_pct != null) {
          const dayPct = Number(asset.day_change_pct).toFixed(2);
          const dayClass = asset.day_change_pct >= 0 ? "positive" : "negative";
          const dayArrow = asset.day_change_pct >= 0 ? "▲" : "▼";
          dayChgStr = `<span class="${dayClass}">${dayArrow} ${Math.abs(dayPct)}%</span>`;
        }

        const childTr = document.createElement("tr");
        childTr.className = "pivot-child";
        childTr.dataset.parentClass = cls.asset_class;
        childTr.innerHTML = `
          <td class="pivot-child-cell">${asset.name} <span class="pivot-asset-type">${asset.asset_type || ""}</span></td>
          <td class="col-amount">${fmtUnits(asset.units)}</td>
          <td class="col-amount">${curSym}${fmtCompact(adInvested)}</td>
          <td class="col-amount">${curPriceStr}</td>
          <td class="col-amount">${curSym}${fmtCompact(adValue)}</td>
          <td class="col-amount">${dayChgStr}</td>
          <td class="col-amount ${aPlClass}">${curSym}${fmtCompact(adGain)}</td>
          <td class="col-amount ${aPlClass}">${aPlPct}%</td>
        `;
        pivotBody.appendChild(childTr);
      }

    }

    const grandPl = grandValue - grandInvested;
    const grandPct = grandInvested > 0 ? ((grandPl / grandInvested) * 100).toFixed(2) : "0.00";
    const grandPlClass = grandPl >= 0 ? "positive" : "negative";

    pivotFooter.innerHTML = `
      <tr>
        <td><strong>TOTAL</strong></td>
        <td class="col-amount">-</td>
        <td class="col-amount"><strong>${curSym}${fmtCompact(toDisplayCurrency(grandInvested))}</strong></td>
        <td class="col-amount">-</td>
        <td class="col-amount"><strong>${curSym}${fmtCompact(toDisplayCurrency(grandValue))}</strong></td>
        <td class="col-amount">-</td>
        <td class="col-amount ${grandPlClass}"><strong>${curSym}${fmtCompact(toDisplayCurrency(grandPl))}</strong></td>
        <td class="col-amount ${grandPlClass}"><strong>${grandPct}%</strong></td>
      </tr>
    `;
  }

  //--- Holdings Data Management ---
  function updateBatchBar() {
    const bar = document.getElementById("batch-bar");
    const count = document.getElementById("batch-count");
    if (selectedIds.size > 0) {
      bar.classList.remove("batch-bar-hidden");
      count.textContent = selectedIds.size + " selected";
    } else {
      bar.classList.add("batch-bar-hidden");
    }
  }

  function updateSelectAll() {
    const all = document.querySelectorAll(".row-check");
    const checked = document.querySelectorAll(".row-check:checked");
    const selectAll = document.getElementById("select-all");
    if(selectAll) {
      selectAll.checked = all.length > 0 && checked.length === all.length;
      selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
    }
  }

  async function loadHoldings() {
    const search = document.getElementById("filter-search").value.trim();
    const year = document.getElementById("filter-year").value;
    const month = document.getElementById("filter-month").value;
    const assetClass = document.getElementById("filter-class").value;
    const broker = document.getElementById("filter-broker").value;
    const currency = document.getElementById("filter-currency").value;

    const params = new URLSearchParams();

    if (search) params.set("name", search);
    if (year) params.set("year", year);
    if (month) params.set("month", month);
    if (assetClass) params.set("asset_class", assetClass);
    if (broker) params.set("broker", broker);
    if (currency) params.set("currency", currency);

    let rows, rateData;
    try {
      // Fetch holdings and exchange rate in parallel, cache rate (fix #1.9)
      [rows, rateData] = await Promise.all([
        apiFetch("/api/holdings?" + params),
        cachedRateData || apiFetch("/api/exchange-rate")
      ]);
      cachedRateData = rateData;
    } catch(e) {
      toast("Failed to load holdings", "error");
      return;
    }

    const tbody = document.getElementById("holdings-rows");
    tbody.innerHTML = "";

    let totalInvested = 0, totalValue = 0;

    for (const r of rows) {
      const fx = r.currency === rateData.default_currency ? 1 : (rateData.rates[r.currency] || 1);
      totalInvested += (r.invested_base != null) ? r.invested_base : (r.invested_amount || 0) * fx;
      totalValue += (r.current_value || 0) * fx;

      const plClass = (r.gain_loss != null && r.gain_loss >= 0) ? "positive" : "negative";
      const checked = selectedIds.has(r.id) ? "checked" : "";
      const txnBadge = r.txn_type === "sell" ? '<span class="badge badge-sell">SELL</span>' : '<span class="badge badge-buy">BUY</span>';

      const tr = document.createElement("tr");
      tr.className = r.txn_type === "sell" ? "row-sell" : "";
      tr.innerHTML = `
        <td class="col-check"><input type="checkbox" class="row-check" data-id="${r.id}" ${checked} /></td>
        <td>${formatDate(r.date)}</td>
        <td>${txnBadge}</td>
        <td>${r.name}</td>
        <td><span class="badge badge-${r.asset_class.toLowerCase().replace(/\s+/g, '-')}">${r.asset_class}</span></td>
        <td>${r.broker || "-"}</td>
        <td>${r.currency}</td>
        <td class="col-amount">${fmt(r.buy_price, r.currency)}</td>
        <td class="col-amount">${fmtQty(Math.abs(r.quantity))}</td>
        <td class="col-amount">${fmt(r.invested_amount, r.currency)}</td>
        <td class="col-amount">${r.current_price ? fmt(r.current_price, r.currency) : "-"}</td>
        <td class="col-amount">${r.current_value != null ? fmt(r.current_value, r.currency) : "-"}</td>
        <td class="col-amount ${plClass}">${r.gain_loss != null ? fmt(r.gain_loss, r.currency) : "-"}</td>
        <td class="col-amount ${plClass}">${fmtPct(r.gain_loss_pct)}</td>
        <td class="col-actions">
          ${r.notes ? `<button class="action-btn notes-btn" data-id="${r.id}" title="View notes">📝</button>` : `<button class="action-btn notes-empty notes-btn" data-id="${r.id}" title="Add note">🗒️</button>`}
          <button class="action-btn copy-btn" data-id="${r.id}" title="Copy transaction">📋</button>
          <button class="action-btn edit-btn" data-id="${r.id}" title="Edit">✏️</button>
          <button class="action-btn delete delete-btn" data-id="${r.id}" title="Delete">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    // Delegated event listeners (fix #1.7 — no more inline onclick)
    tbody.querySelectorAll(".row-check").forEach(cb => {
      cb.addEventListener("change", () => {
        const id = Number(cb.dataset.id);
        if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
        updateBatchBar();
        updateSelectAll();
      });
    });

    updateSelectAll();
    const pl = totalValue - totalInvested;
    const footerSym = currencyConfigured ? getCurrencySymbol(displayCurrency) : "";
    document.getElementById("holdings-footer").textContent = `${rows.length} entries | Invested: ${footerSym}${fmtCompact(toDisplayCurrency(totalInvested))} | Value: ${footerSym}${fmtCompact(toDisplayCurrency(totalValue))} | P&L: ${footerSym}${fmtCompact(toDisplayCurrency(pl))}`;
  }

  //--- Delegated click handlers for holdings table (fix #1.7) ---
  document.getElementById("holdings-rows").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.classList.contains("edit-btn")) editHolding(id);
    else if (btn.classList.contains("delete-btn")) deleteHolding(id);
    else if (btn.classList.contains("copy-btn")) copyHolding(id);
    else if (btn.classList.contains("notes-btn")) viewNotes(id);
  });

  //--- Action Elements Setup ---
  document.getElementById("select-all").addEventListener("change", function() {
    const checked = this.checked;
    document.querySelectorAll(".row-check").forEach(cb => {
      cb.checked = checked;
      const id = Number(cb.dataset.id);
      if (checked) selectedIds.add(id); else selectedIds.delete(id);
    });
    updateBatchBar();
  });

  document.getElementById("batch-action").addEventListener("change", function() {
    const action = this.value;
    const valueSelect = document.getElementById("batch-value");
    if (action === "asset_class") {
      valueSelect.innerHTML = '<option value="">- Select Class -</option>';
      assetClasses.forEach(c => { valueSelect.innerHTML += `<option value="${c.name}">${c.name}</option>`; });
      valueSelect.classList.remove("batch-value-hidden");
    } else if (action === "asset_type") {
      valueSelect.innerHTML = '<option value="">- Select Type -</option>';
      assetTypes.forEach(t => { valueSelect.innerHTML += `<option value="${t.name}">${t.name}</option>`; });
      valueSelect.classList.remove("batch-value-hidden");
    } else if (action === "broker") {
      valueSelect.innerHTML = '<option value="">- Select Broker -</option>';
      brokers.forEach(b => { valueSelect.innerHTML += `<option value="${b.name}">${b.name}</option>`; });
      valueSelect.classList.remove("batch-value-hidden");
    } else {
      valueSelect.classList.add("batch-value-hidden");
    }
  });

  document.getElementById("batch-apply-btn").addEventListener("click", async function() {
    const btn = this;
    const action = document.getElementById("batch-action").value;
    const value = document.getElementById("batch-value").value;
    const ids = Array.from(selectedIds);

    if (ids.length === 0) { toast("No items selected", "error"); return; }
    if (!action) { toast("Select an action", "error"); return; }
    btnLoading(btn, true);

    if (action === "delete") {
      if (!await showConfirm(`Delete ${ids.length} selected holdings?`, "This cannot be undone.")) { btnLoading(btn, false); return; }
      try {
        const data = await apiFetch("/api/holdings/batch-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
        toast(`Deleted ${data.deleted} holdings`, "success"); selectedIds.clear(); updateBatchBar(); loadHoldings();
      } catch(e) { toast(e.message || "Error", "error"); }
    } else if (action === "rename_asset") {
      try {
        const allRows = await apiFetch("/api/holdings");
        const selectedRows = allRows.filter(r => ids.includes(r.id));
        const uniqueNames = [...new Set(selectedRows.map(r => r.name))];
        if (uniqueNames.length > 1) { toast("Select entries of a single asset to rename.", "error"); btnLoading(btn, false); return; }
        btnLoading(btn, false);
        openRenameModal(uniqueNames[0]);
      } catch(e) { toast("Error loading data", "error"); }
      btnLoading(btn, false);
      return;
    } else {
      if (!value) { toast("Select a value", "error"); btnLoading(btn, false); return; }
      const updates = { [action]: value };
      try {
        const data = await apiFetch("/api/holdings/batch-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, updates }) });
        toast(`Updated ${data.updated} holdings`, "success"); selectedIds.clear(); updateBatchBar(); loadHoldings();
      } catch(e) { toast(e.message || "Error", "error"); }
    }
    btnLoading(btn, false);
    document.getElementById("batch-action").value = "";
    document.getElementById("batch-value").classList.add("batch-value-hidden");
  });

  document.getElementById("batch-clear-btn").addEventListener("click", () => {
    selectedIds.clear();
    document.querySelectorAll(".row-check").forEach(cb => cb.checked = false);
    document.getElementById("select-all").checked = false;
    document.getElementById("select-all").indeterminate = false;
    updateBatchBar();
  });

  //--- Custom Confirm Modal (fix #5.5 — replaces native confirm/prompt) ---
  function showConfirm(title, message) {
    return new Promise((resolve) => {
      const overlay = document.getElementById("confirm-modal");
      document.getElementById("confirm-modal-title").textContent = title;
      document.getElementById("confirm-modal-message").textContent = message || "";
      overlay.classList.add("open");
      const yesBtn = document.getElementById("confirm-modal-yes");
      const noBtn = document.getElementById("confirm-modal-no");
      function cleanup() { overlay.classList.remove("open"); yesBtn.removeEventListener("click", onYes); noBtn.removeEventListener("click", onNo); }
      function onYes() { cleanup(); resolve(true); }
      function onNo() { cleanup(); resolve(false); }
      yesBtn.addEventListener("click", onYes);
      noBtn.addEventListener("click", onNo);
    });
  }

  //--- Transaction Submission Form ---
  document.getElementById("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const txnType = document.getElementById("add-txn-type").value;
    const ticker = document.getElementById("add-ticker").value.trim();
    const name = document.getElementById("add-name").value.trim();
    const selectedCurrency = currencyConfigured ? document.getElementById("add-currency").value : "";

    const body = {
      date: document.getElementById("add-date").value,
      txn_type: txnType, name: name,
      asset_class: document.getElementById("add-asset-class").value,
      asset_type: document.getElementById("add-asset-type").value,
      broker: document.getElementById("add-broker").value,
      buy_price: document.getElementById("add-buy-price").value,
      quantity: document.getElementById("add-quantity").value,
      invested_amount: document.getElementById("add-invested").value,
      currency: selectedCurrency || baseCurrency, ticker: ticker,
      notes: document.getElementById("add-notes").value
    };

    if (currencyConfigured && selectedCurrency && selectedCurrency !== baseCurrency) {
      const investedBaseVal = document.getElementById("add-invested-base").value;
      if (investedBaseVal) body.invested_base = investedBaseVal;
    }

    try {
      await apiFetch("/api/holdings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      showMsg(document.getElementById("add-msg"), "Transaction added", "success");
      if (txnType === "buy" && !ticker) { toast("Tip: Add a ticker in Settings → Ticker Mapping for live price updates", "info"); }
      document.getElementById("add-form").reset();
      document.getElementById("add-date").value = new Date().toISOString().slice(0, 10);
      if (currencyConfigured) document.getElementById("add-currency").value = baseCurrency;
      document.getElementById("add-invested-base-label").style.display = "none";
      cachedRateData = null; // Invalidate cached rate
      invalidateDashboardCache();
      loadHoldings();
    } catch(e) {
      showMsg(document.getElementById("add-msg"), e.message || "Error", "error");
    }
  });

  document.getElementById("add-form-clear").addEventListener("click", () => {
    document.getElementById("add-form").reset();
    document.getElementById("add-date").value = new Date().toISOString().slice(0, 10);
    if (currencyConfigured) document.getElementById("add-currency").value = baseCurrency;
    document.getElementById("add-invested-base-label").style.display = "none";
    document.getElementById("add-msg").textContent = "";
  });

  //--- Filters Event Handling ---
  document.getElementById("filter-search").addEventListener("input", debounce(loadHoldings, 300));
  document.getElementById("filter-year").addEventListener("change", loadHoldings);
  document.getElementById("filter-month").addEventListener("change", loadHoldings);
  document.getElementById("filter-class").addEventListener("change", loadHoldings);
  document.getElementById("filter-broker").addEventListener("change", loadHoldings);
  document.getElementById("filter-currency").addEventListener("change", loadHoldings);
  document.getElementById("filter-reset-btn").addEventListener("click", () => {
    document.getElementById("filter-search").value = "";
    document.getElementById("filter-year").value = "";
    document.getElementById("filter-month").value = "";
    document.getElementById("filter-class").value = "";
    document.getElementById("filter-broker").value = "";
    document.getElementById("filter-currency").value = "";
    loadHoldings();
  });

  // Download CSV
  document.getElementById("download-csv-btn").addEventListener("click", async () => {
    let rows;
    try { rows = await apiFetch("/api/holdings"); } catch(e) { toast("Failed to fetch data", "error"); return; }
    if (!rows.length) { toast("No holdings to download.", "info"); return; }

    const headers = ["Date","Buy/Sell","Name","Category","Type","Broker","Currency","Price","Quantity","Invested","Invested (Base)","Current Price","Current Value","P&L","P&L %","Ticker","Notes"];
    const csvRows = [headers.join(",")];

    for (const r of rows) {
      const values = [
        r.date, r.txn_type || "buy",
        `"${(r.name || "").replace(/"/g, '""')}"`,
        `"${(r.asset_class || "").replace(/"/g, '""')}"`,
        `"${(r.asset_type || "").replace(/"/g, '""')}"`,
        `"${(r.broker || "").replace(/"/g, '""')}"`,
        r.currency || "", r.buy_price ?? "", r.quantity ?? "",
        r.invested_amount ?? "", r.invested_base ?? "",
        r.current_price ?? "", r.current_value ?? "",
        r.gain_loss != null ? r.gain_loss.toFixed(2) : "",
        r.gain_loss_pct != null ? r.gain_loss_pct.toFixed(2) : "",
        `"${(r.ticker || "").replace(/"/g, '""')}"`,
        `"${(r.notes || "").replace(/"/g, '""')}"`
      ];
      csvRows.push(values.join(","));
    }

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio-holdings-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  document.getElementById("new-txn-toggle").addEventListener("click", function() {
    const content = document.getElementById("new-txn-content");
    const isopen = content.style.display !== "none";
    content.style.display = isopen ? "none" : "block";
    this.classList.toggle("open", !isopen);
    this.textContent = isopen ? "+ New Transaction" : "✕ Close";
  });

  //--- Edit Modal Actions ---
  const editModal = document.getElementById("edit-modal");
  document.getElementById("edit-cancel").addEventListener("click", () => editModal.classList.remove("open"));

  async function editHolding(id) {
    let row;
    try {
      row = await apiFetch(`/api/holdings/${id}`);
    } catch(e) { toast("Failed to load holding", "error"); return; }

    document.getElementById("edit-id").value = id;
    document.getElementById("edit-date").value = row.date;
    document.getElementById("edit-txn-type").value = row.txn_type || "buy";
    document.getElementById("edit-name").value = row.name;
    document.getElementById("edit-asset-class").value = row.asset_class;
    document.getElementById("edit-asset-type").value = row.asset_type || "";
    document.getElementById("edit-broker").value = row.broker || "";
    document.getElementById("edit-buy-price").value = row.buy_price;
    document.getElementById("edit-quantity").value = Math.abs(row.quantity);
    document.getElementById("edit-invested").value = Math.abs(row.invested_amount);
    document.getElementById("edit-currency").value = row.currency;
    document.getElementById("edit-ticker").value = row.ticker || "";
    document.getElementById("edit-notes").value = row.notes || "";

    const editInvestedBaseLabel = document.getElementById("edit-invested-base-label");
    const editInvestedBaseCurrency = document.getElementById("edit-invested-base-currency");
    if (currencyConfigured && row.currency && row.currency !== baseCurrency) {
      editInvestedBaseCurrency.textContent = baseCurrency;
      editInvestedBaseLabel.style.display = "";
      document.getElementById("edit-invested-base").value = row.invested_base != null ? Math.abs(row.invested_base) : "";
    } else {
      editInvestedBaseLabel.style.display = "none";
      document.getElementById("edit-invested-base").value = "";
    }

    const editCurrencyLabel = document.getElementById("edit-currency").closest("label");
    if (editCurrencyLabel) editCurrencyLabel.style.display = currencyConfigured ? "" : "none";
    editModal.classList.add("open");
  }

  document.getElementById("edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("edit-id").value;
    const selectedCurrency = currencyConfigured ? document.getElementById("edit-currency").value : "";

    const body = {
      date: document.getElementById("edit-date").value,
      txn_type: document.getElementById("edit-txn-type").value,
      name: document.getElementById("edit-name").value,
      asset_class: document.getElementById("edit-asset-class").value,
      asset_type: document.getElementById("edit-asset-type").value,
      broker: document.getElementById("edit-broker").value,
      buy_price: document.getElementById("edit-buy-price").value,
      quantity: document.getElementById("edit-quantity").value,
      invested_amount: document.getElementById("edit-invested").value,
      currency: selectedCurrency || baseCurrency,
      ticker: document.getElementById("edit-ticker").value,
      notes: document.getElementById("edit-notes").value
    };

    if (currencyConfigured && selectedCurrency && selectedCurrency !== baseCurrency) {
      const investedBaseVal = document.getElementById("edit-invested-base").value;
      if (investedBaseVal) body.invested_base = investedBaseVal;
    }

    try {
      await apiFetch(`/api/holdings/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      editModal.classList.remove("open");
      cachedRateData = null;
      invalidateDashboardCache();
      loadHoldings();
    } catch(e) { toast(e.message || "Error saving", "error"); }
  });

  async function deleteHolding(id) {
    if (!await showConfirm("Delete this holding?", "This action cannot be undone.")) return;
    try {
      await apiFetch(`/api/holdings/${id}`, { method: "DELETE" });
      loadHoldings();
    } catch(e) { toast("Error deleting", "error"); }
  }

  async function copyHolding(id) {
    try {
      await apiFetch(`/api/holdings/${id}/copy`, { method: "POST", headers: { "Content-Type": "application/json" } });
      toast("Transaction copied", "success");
      invalidateDashboardCache();
      loadHoldings();
    } catch(e) { toast(e.message || "Error copying transaction", "error"); }
  }

  //--- Currency Header Toggle Actions ---
  document.getElementById("currency-toggle").addEventListener("click", () => {
    if (displayCurrency === baseCurrency && altCurrency && altCurrency !== baseCurrency) {
      displayCurrency = altCurrency;
    } else {
      displayCurrency = baseCurrency;
    }
    updateCurrencyToggleBtn();
    loadDashboard();
    cachedRateData = null;
    invalidateDashboardCache();
    loadHoldings();
  });

  document.getElementById("refresh-prices-btn").addEventListener("click", async function() {
    const btn = this;
    btn.disabled = true; btn.textContent = "🔄 Fetching...";
    try {
      const data = await apiFetch("/api/refresh-prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) });
      btn.textContent = `✅ ${data.updated} updated`;
      setTimeout(() => { btn.textContent = "🔄 Prices"; btn.disabled = false; }, 3000);
      cachedRateData = null;
      invalidateDashboardCache();
      localStorage.removeItem(WATCHLIST_CACHE_KEY);
      loadHoldings(); loadDashboard();
      if (currentTab === "watchlist") loadWatchlist();
    } catch (e) {
      btn.textContent = "❌ Error";
      setTimeout(() => { btn.textContent = "🔄 Prices"; btn.disabled = false; }, 3000);
    }
  });


  //--- Settings Loader & Renders ---
  async function loadSettings() {
    try {
      const [classes, types, brokersData, tickers] = await Promise.all([
        apiFetch("/api/settings/asset-classes"),
        apiFetch("/api/settings/asset-types"),
        apiFetch("/api/settings/brokers"),
        apiFetch("/api/settings/tickers")
      ]);
      renderSettingsList("settings-classes-list", classes, "asset-classes");
      renderSettingsList("settings-types-list", types, "asset-types");
      renderSettingsList("settings-brokers-list", brokersData, "brokers");
      renderTickersList(tickers);
      loadLockSettings();
    } catch(e) { toast("Failed to load settings", "error"); }
  }

  function renderSettingsList(listId, items, endpoint) {
    const ul = document.getElementById(listId);
    ul.innerHTML = "";
    for (const item of items) {
      const li = document.createElement("li");
      li.className = "settings-item";
      li.innerHTML = `
        <input type="text" class="settings-item-input" value="${item.name}" data-id="${item.id}" data-original="${item.name}" />
        <button class="action-btn settings-rename-btn" title="Rename">💾</button>
        <button class="action-btn delete settings-delete-btn" title="Delete">🗑️</button>
      `;
      ul.appendChild(li);

      li.querySelector(".settings-rename-btn").addEventListener("click", async function() {
        const btn = this; const input = li.querySelector(".settings-item-input");
        const newName = input.value.trim();
        if (!newName || newName === input.dataset.original) return;
        btnLoading(btn, true);
        try {
          await apiFetch(`/api/settings/${endpoint}/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) });
          input.dataset.original = newName; toast("Renamed successfully", "success"); loadDropdowns();
        } catch(e) { toast(e.message || "Error", "error"); }
        btnLoading(btn, false);
      });

      li.querySelector(".settings-delete-btn").addEventListener("click", async function() {
        if (!await showConfirm(`Delete "${item.name}"?`, "This cannot be undone.")) return;
        const btn = this; btnLoading(btn, true);
        try {
          await apiFetch(`/api/settings/${endpoint}/${item.id}`, { method: "DELETE" });
          toast("Deleted: " + item.name, "success"); loadSettings(); loadDropdowns();
        } catch(e) { toast(e.message || "Cannot delete", "error"); }
        btnLoading(btn, false);
      });
    }
  }

  function renderTickersList(tickers) {
    const tbody = document.getElementById("settings-tickers-list");
    tbody.innerHTML = "";
    for (const t of tickers) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${t.asset_name}</td>
        <td><input type="text" class="ticker-edit-input" value="${t.ticker}" data-asset="${t.asset_name}" data-original="${t.ticker}" /></td>
        <td class="col-actions">
          <button class="action-btn ticker-save-btn" title="Save">💾</button>
          <button class="action-btn delete ticker-delete-btn" title="Delete">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);

      tr.querySelector(".ticker-save-btn").addEventListener("click", async function() {
        const btn = this; const input = tr.querySelector(".ticker-edit-input");
        const newTicker = input.value.trim();
        if (!newTicker || newTicker === input.dataset.original) return;
        btnLoading(btn, true);
        try {
          await apiFetch("/api/settings/tickers", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asset_name: input.dataset.asset, ticker: newTicker }) });
          input.dataset.original = newTicker; toast("Ticker updated: " + input.dataset.asset, "success");
        } catch(e) { toast(e.message || "Error saving ticker", "error"); }
        btnLoading(btn, false);
      });

      tr.querySelector(".ticker-delete-btn").addEventListener("click", async function() {
        if (!await showConfirm(`Remove ticker mapping for "${t.asset_name}"?`)) return;
        const btn = this; btnLoading(btn, true);
        try {
          await apiFetch(`/api/settings/tickers/${encodeURIComponent(t.asset_name)}`, { method: "DELETE" });
          toast("Ticker removed: " + t.asset_name, "success"); loadSettings();
        } catch(e) { toast(e.message || "Cannot delete ticker", "error"); }
        btnLoading(btn, false);
      });
    }
  }

  // Settings mapping add click hooks
  document.getElementById("settings-class-add-btn").addEventListener("click", async function() {
    const btn = this; const input = document.getElementById("settings-class-input");
    const name = input.value.trim(); if (!name) return; btnLoading(btn, true);
    try {
      await apiFetch("/api/settings/asset-classes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      input.value = ""; toast("Added: " + name, "success"); loadSettings(); loadDropdowns();
    } catch(e) { toast(e.message || "Error", "error"); }
    btnLoading(btn, false);
  });

  document.getElementById("settings-type-add-btn").addEventListener("click", async function() {
    const btn = this; const input = document.getElementById("settings-type-input");
    const name = input.value.trim(); if (!name) return; btnLoading(btn, true);
    try {
      await apiFetch("/api/settings/asset-types", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      input.value = ""; toast("Added: " + name, "success"); loadSettings(); loadDropdowns();
    } catch(e) { toast(e.message || "Error", "error"); }
    btnLoading(btn, false);
  });

  document.getElementById("settings-broker-add-btn").addEventListener("click", async function() {
    const btn = this; const input = document.getElementById("settings-broker-input");
    const name = input.value.trim(); if (!name) return; btnLoading(btn, true);
    try {
      await apiFetch("/api/settings/brokers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      input.value = ""; toast("Added: " + name, "success"); loadSettings(); loadDropdowns();
    } catch(e) { toast(e.message || "Error", "error"); }
    btnLoading(btn, false);
  });

  document.getElementById("settings-ticker-add-btn").addEventListener("click", async function() {
    const btn = this; const assetInput = document.getElementById("settings-ticker-asset");
    const symbolInput = document.getElementById("settings-ticker-symbol");
    const asset_name = assetInput.value.trim(); const ticker = symbolInput.value.trim();
    if (!asset_name || !ticker) return; btnLoading(btn, true);
    try {
      await apiFetch("/api/settings/tickers", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asset_name, ticker }) });
      assetInput.value = ""; symbolInput.value = ""; toast("Mapped: " + asset_name + " → " + ticker, "success"); loadSettings();
    } catch(e) { toast(e.message || "Error", "error"); }
    btnLoading(btn, false);
  });

  document.getElementById("settings-currency-save-btn").addEventListener("click", async function() {
    const btn = this;
    const currency = document.getElementById("settings-default-currency").value;
    const rateDisplay = document.getElementById("settings-rate-display").value;

    if (currency && currencyConfigured && currency !== baseCurrency) {
      try {
        const checkRes = await apiFetch("/api/settings/currency");
        if (checkRes.invested_base_count > 0) {
          const confirmed = await showConfirm("Change base currency?", `You have ${checkRes.invested_base_count} holding(s) with invested amount in ${baseCurrency}. Changing to ${currency} will misinterpret those values.`);
          if (!confirmed) { document.getElementById("settings-default-currency").value = baseCurrency; return; }
        }
      } catch(e) {}
    }

    if (!currency && currencyConfigured) {
      try {
        const checkRes = await apiFetch("/api/settings/currency");
        if (checkRes.holding_currencies && checkRes.holding_currencies.length > 1) {
          const currencies = checkRes.holding_currencies.join(", ");
          const confirmed = await showConfirm("Disable currency?", `You have holdings in multiple currencies (${currencies}). Disabling will stop conversions and break visuals.`);
          if (!confirmed) { document.getElementById("settings-default-currency").value = baseCurrency; return; }
        }
      } catch(e) {}
    }

    btnLoading(btn, true);
    const selectedDateFormat = document.getElementById("settings-date-format").value;
    const body = { currency, rate_display: rateDisplay, date_format: selectedDateFormat };
    if (!currency && currencyConfigured) body.save_previous = true;

    try {
      await apiFetch("/api/settings/currency", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      toast("Currency settings saved", "success"); await loadDefaultCurrency(); cachedRateData = null; invalidateDashboardCache(); loadDashboard(); loadHoldings();
    } catch(e) { toast("Error saving currency", "error"); }
    btnLoading(btn, false);
  });

  document.getElementById("currency-restore-btn").addEventListener("click", async function() {
    const btn = this; btnLoading(btn, true);
    try {
      await apiFetch("/api/settings/currency/restore", { method: "POST" });
      toast("Currency configuration restored", "success"); await loadDefaultCurrency(); cachedRateData = null; invalidateDashboardCache(); loadDashboard(); loadHoldings();
    } catch(e) { toast(e.message || "Error restoring", "error"); }
    btnLoading(btn, false);
  });

  document.getElementById("settings-default-currency").addEventListener("change", function() {
    const selected = this.value;
    const rateDisplayLabel = document.getElementById("rate-display-label");
    const configInfo = document.getElementById("currency-config-info");
    if (selected) {
      if (rateDisplayLabel) rateDisplayLabel.style.display = "";
      if (configInfo) configInfo.style.display = "block";
    } else {
      if (rateDisplayLabel) rateDisplayLabel.style.display = "none";
      if (configInfo) configInfo.style.display = "none";
    }
  });

  async function loadDefaultCurrency() {
    try {
      const data = await apiFetch("/api/settings/currency");
      const cur = data.default_currency || "";
      currencyConfigured = !!cur; baseCurrency = cur; displayCurrency = cur;
      document.getElementById("settings-default-currency").value = cur;

      const addCurrencyLabel = document.getElementById("add-currency").closest("label");
      const editCurrencyLabel = document.getElementById("edit-currency").closest("label");
      const rateDisplayLabel = document.getElementById("rate-display-label");
      const configInfo = document.getElementById("currency-config-info");
      const restoreSection = document.getElementById("currency-restore-section");

      if (currencyConfigured) {
        if (addCurrencyLabel) addCurrencyLabel.style.display = "";
        if (editCurrencyLabel) editCurrencyLabel.style.display = "";
        if (rateDisplayLabel) rateDisplayLabel.style.display = "";
        if (configInfo) configInfo.style.display = "block";
        if (restoreSection) restoreSection.style.display = "none";
        document.getElementById("add-currency").value = cur;
      } else {
        if (addCurrencyLabel) addCurrencyLabel.style.display = "none";
        if (editCurrencyLabel) editCurrencyLabel.style.display = "none";
        if (rateDisplayLabel) rateDisplayLabel.style.display = "none";
        if (configInfo) configInfo.style.display = "none";
        if (restoreSection) {
          const hasMultiCurrency = data.holding_currencies && data.holding_currencies.length > 1;
          if (data.previous_default_currency && hasMultiCurrency) {
            restoreSection.style.display = "block";
            document.getElementById("currency-restore-label").textContent = `Restore previous configuration (${data.previous_default_currency})`;
          } else { restoreSection.style.display = "none"; }
        }
      }
      if (data.rate_display) { document.getElementById("settings-rate-display").value = data.rate_display; altCurrency = data.rate_display; }
      if (data.date_format) { dateFormat = data.date_format; document.getElementById("settings-date-format").value = data.date_format; }
      updateCurrencyToggleBtn();
    } catch(e) {}
  }

  //--- Notes Logic (fix #1.3 — uses GET by ID, preserves invested_base & txn_type) ---
  const notesModal = document.getElementById("notes-modal");
  async function viewNotes(id) {
    let row;
    try { row = await apiFetch(`/api/holdings/${id}`); } catch(e) { toast("Error loading", "error"); return; }
    notesCurrentId = id;
    document.getElementById("notes-modal-asset").textContent = row.name;
    document.getElementById("notes-modal-text").value = row.notes || "";
    notesModal.classList.add("open");
  }

  document.getElementById("notes-cancel-btn").addEventListener("click", () => { notesModal.classList.remove("open"); notesCurrentId = null; });
  document.getElementById("notes-save-btn").addEventListener("click", async function() {
    if (!notesCurrentId) return;
    const btn = this; const notes = document.getElementById("notes-modal-text").value;
    btnLoading(btn, true);
    try {
      const row = await apiFetch(`/api/holdings/${notesCurrentId}`);
      const body = {
        date: row.date, name: row.name, asset_class: row.asset_class,
        asset_type: row.asset_type, broker: row.broker,
        txn_type: row.txn_type, // fix #1.3: preserve txn_type
        buy_price: row.buy_price, quantity: Math.abs(row.quantity),
        invested_amount: Math.abs(row.invested_amount),
        currency: row.currency, ticker: row.ticker, notes: notes,
        invested_base: row.invested_base != null ? Math.abs(row.invested_base) : null // fix #1.3: preserve invested_base
      };
      await apiFetch(`/api/holdings/${notesCurrentId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      toast("Note saved", "success"); notesModal.classList.remove("open"); notesCurrentId = null; loadHoldings();
    } catch(e) { toast("Error saving note", "error"); }
    btnLoading(btn, false);
  });

  //--- Watchlist Management ---
  const WATCHLIST_CACHE_KEY = "portfolio_watchlist_cache";
  const WATCHLIST_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  function getWatchlistCache() {
    try {
      const raw = localStorage.getItem(WATCHLIST_CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (Date.now() - cached.timestamp < WATCHLIST_CACHE_TTL) {
        return cached.items;
      }
    } catch(e) {}
    return null;
  }

  function setWatchlistCache(items) {
    try {
      localStorage.setItem(WATCHLIST_CACHE_KEY, JSON.stringify({ items, timestamp: Date.now() }));
    } catch(e) {}
  }

  function renderWatchlistRows(items) {
    const tbody = document.getElementById("watchlist-rows");
    const emptyMsg = document.getElementById("watchlist-empty");
    tbody.innerHTML = "";
    if (items.length === 0) { emptyMsg.style.display = "block"; return; }
    emptyMsg.style.display = "none";

    for (const item of items) {
      const tr = document.createElement("tr");
      const priceStr = item.current_price != null ? getCurrencySymbol(item.currency) + Number(item.current_price).toLocaleString(getLocaleForCurrency(item.currency), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";

      const sourceBadge = item.is_portfolio ? '<span class="watchlist-badge watchlist-badge-portfolio">Portfolio</span>' : '<span class="watchlist-badge watchlist-badge-manual">Manual</span>';
      const editBtn = item.is_portfolio ? '<button class="action-btn watchlist-action-disabled" title="Part of your portfolio" disabled>⚙️</button>' : `<button class="action-btn watchlist-edit-btn" data-id="${item.id}" data-name="${item.name.replace(/"/g, '&quot;')}" data-ticker="${item.ticker}" title="Edit">✏️</button>`;
      const deleteBtn = item.is_portfolio ? '<button class="action-btn watchlist-action-disabled" title="Part of your portfolio" disabled>🗑️</button>' : `<button class="action-btn delete watchlist-remove-btn" data-id="${item.id}" title="Remove">🗑️</button>`;

      tr.innerHTML = `<td>${item.name}</td><td class="watchlist-ticker-cell">${item.ticker}</td><td class="col-amount watchlist-price">${priceStr}</td><td>${sourceBadge}</td><td class="col-actions">${editBtn} ${deleteBtn}</td>`;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll(".watchlist-remove-btn").forEach(btn => {
      btn.addEventListener("click", async function() {
        const id = this.dataset.id;
        if (!await showConfirm("Remove from watchlist?", "This ticker will be removed.")) return;
        btnLoading(this, true);
        try {
          await apiFetch(`/api/watchlist/${id}`, { method: "DELETE" });
          localStorage.removeItem(WATCHLIST_CACHE_KEY);
          toast("Removed from watchlist", "success"); loadWatchlist();
        } catch(e) { toast(e.message || "Error", "error"); btnLoading(this, false); }
      });
    });

    // Watchlist edit using custom modal instead of prompt() (fix #5.5)
    tbody.querySelectorAll(".watchlist-edit-btn").forEach(btn => {
      btn.addEventListener("click", function() {
        const id = this.dataset.id; const name = this.dataset.name; const ticker = this.dataset.ticker;
        openWatchlistEditModal(id, name, ticker);
      });
    });
  }

  async function loadWatchlist() {
    const tbody = document.getElementById("watchlist-rows");
    const emptyMsg = document.getElementById("watchlist-empty");
    const loadingMsg = document.getElementById("watchlist-loading");
    tbody.innerHTML = ""; emptyMsg.style.display = "none";

    // Instant render from cache if available
    const cached = getWatchlistCache();
    if (cached) {
      loadingMsg.style.display = "none";
      renderWatchlistRows(cached);
      // Fetch fresh data in background, update silently
      apiFetch("/api/watchlist").then(items => {
        setWatchlistCache(items);
        renderWatchlistRows(items);
      }).catch(() => {});
    } else {
      loadingMsg.style.display = "block";
      try {
        const items = await apiFetch("/api/watchlist");
        loadingMsg.style.display = "none";
        setWatchlistCache(items);
        renderWatchlistRows(items);
      } catch(e) { loadingMsg.style.display = "none"; emptyMsg.style.display = "block"; console.error("Failed to load watchlist:", e); }
    }
  }

  // Watchlist edit modal (fix #5.5)
  function openWatchlistEditModal(id, name, ticker) {
    document.getElementById("watchlist-edit-id").value = id;
    document.getElementById("watchlist-edit-name").value = name;
    document.getElementById("watchlist-edit-ticker").value = ticker;
    document.getElementById("watchlist-edit-modal").classList.add("open");
  }

  document.getElementById("watchlist-edit-cancel").addEventListener("click", () => {
    document.getElementById("watchlist-edit-modal").classList.remove("open");
  });

  document.getElementById("watchlist-edit-save").addEventListener("click", async function() {
    const btn = this;
    const id = document.getElementById("watchlist-edit-id").value;
    const name = document.getElementById("watchlist-edit-name").value.trim();
    const ticker = document.getElementById("watchlist-edit-ticker").value.trim();
    if (!ticker) { toast("Ticker cannot be empty", "error"); return; }
    btnLoading(btn, true);
    try {
      await apiFetch(`/api/watchlist/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name || ticker, ticker }) });
      toast("Watchlist item updated", "success");
      document.getElementById("watchlist-edit-modal").classList.remove("open");
      localStorage.removeItem(WATCHLIST_CACHE_KEY);
      loadWatchlist();
    } catch(e) { toast(e.message || "Error updating", "error"); }
    btnLoading(btn, false);
  });

  document.getElementById("watchlist-add-btn").addEventListener("click", async function() {
    const btn = this;
    const tickerInput = document.getElementById("watchlist-ticker-input");
    const nameInput = document.getElementById("watchlist-name-input");
    const ticker = tickerInput.value.trim(); const name = nameInput.value.trim();
    if (!ticker) { toast("Enter a ticker symbol", "error"); return; }
    btnLoading(btn, true);
    try {
      const data = await apiFetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker, name }) });
      tickerInput.value = ""; nameInput.value = ""; localStorage.removeItem(WATCHLIST_CACHE_KEY); toast(`Added ${data.name || data.ticker} to watchlist`, "success"); loadWatchlist();
    } catch(e) { toast(e.message || "Error adding ticker", "error"); }
    btnLoading(btn, false);
  });

  document.getElementById("watchlist-ticker-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("watchlist-add-btn").click(); } });

  //--- Asset Rename Modal ---
  const renameModal = document.getElementById("rename-modal");
  function openRenameModal(oldName) {
    renameOldName = oldName;
    document.getElementById("rename-modal-info").textContent = `Renaming "${oldName}" across all holdings.`;
    document.getElementById("rename-modal-input").value = oldName;
    document.getElementById("rename-modal-msg").textContent = "";
    renameModal.classList.add("open");
    setTimeout(() => { const input = document.getElementById("rename-modal-input"); input.focus(); input.select(); }, 100);
  }

  document.getElementById("rename-modal-cancel").addEventListener("click", () => renameModal.classList.remove("open"));
  document.getElementById("rename-modal-save").addEventListener("click", async function() {
    const btn = this; const newName = document.getElementById("rename-modal-input").value.trim();
    const msg = document.getElementById("rename-modal-msg");
    if (!newName) { msg.textContent = "Name cannot be empty."; msg.className = "form-msg error"; return; }
    if (newName === renameOldName) { msg.textContent = "Name is unchanged."; msg.className = "form-msg error"; return; }
    btnLoading(btn, true);

    try {
      const data = await apiFetch("/api/holdings/rename-asset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ old_name: renameOldName, new_name: newName }) });
      toast(`Renamed "${renameOldName}" to "${newName}" across ${data.renamed} entries`, "success"); renameModal.classList.remove("open"); selectedIds.clear(); updateBatchBar(); loadHoldings(); loadDashboard();
    } catch(e) { msg.textContent = e.message || "Error renaming."; msg.className = "form-msg error"; }
    btnLoading(btn, false);
  });
  document.getElementById("rename-modal-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("rename-modal-save").click(); } });

  //--- Security Pin Lock Utilities ---
  async function loadLockSettings() {
    try {
      const { locked } = await apiFetch("/api/lock/config");
      document.getElementById("lock-setup-section").style.display = locked ? "none" : "block";
      document.getElementById("lock-disable-section").style.display = locked ? "block" : "none";
      document.getElementById("lock-recovery-alert-section").style.display = "none";
      document.getElementById("settings-pin").value = "";
      document.getElementById("settings-pin-confirm").value = "";
      document.getElementById("settings-lock-message").textContent = "";
      document.getElementById("settings-lock-message").className = "form-msg";
    } catch(e) {}
  }

  document.getElementById("settings-lock-enable").addEventListener("click", async () => {
    const pin = document.getElementById("settings-pin").value; const confirmPin = document.getElementById("settings-pin-confirm").value;
    const msg = document.getElementById("settings-lock-message");
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) { msg.textContent = "PIN must be exactly 6 digits."; msg.className = "form-msg error"; return; }
    if (pin !== confirmPin) { msg.textContent = "PINs do not match."; msg.className = "form-msg error"; return; }

    try {
      const data = await apiFetch("/api/lock/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      document.getElementById("lock-setup-section").style.display = "none";
      const alertSection = document.getElementById("lock-recovery-alert-section");
      alertSection.innerHTML = `<div class="recovery-alert"><div class="recovery-alert-header">✓ Lock enabled successfully</div><div class="recovery-alert-body"><p>Your recovery code:</p><code class="recovery-code">${data.recoveryCode}</code><p class="recovery-warning">⚠ Save this code now. This is the only time it will be shown. If you forget your PIN and don't have this code, you will permanently lose access to the app.</p><p class="recovery-tips">Tips: Save it in your notes app, email it to yourself, or store it in your password manager.</p></div></div>`;
      alertSection.style.display = "block"; document.getElementById("lock-disable-section").style.display = "block";
      document.getElementById("settings-disable-pin").value = "";
      document.getElementById("settings-disable-message").textContent = "";
      document.getElementById("settings-disable-message").className = "form-msg";
    } catch(e) { msg.textContent = e.message || "Failed"; msg.className = "form-msg error"; }
  });

  document.getElementById("settings-lock-disable").addEventListener("click", async () => {
    const pin = document.getElementById("settings-disable-pin").value; const msg = document.getElementById("settings-disable-message");
    try {
      await apiFetch("/api/lock/disable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      msg.textContent = "Lock disabled."; msg.className = "form-msg success"; document.getElementById("settings-disable-pin").value = ""; loadLockSettings();
    } catch(e) { msg.textContent = e.message || "Incorrect PIN"; msg.className = "form-msg error"; }
  });

  document.querySelectorAll('#settings-pin, #settings-pin-confirm, #settings-disable-pin').forEach(input => { input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, ""); }); });
  document.getElementById("settings-pin-confirm").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("settings-lock-enable").click(); } });
  document.getElementById("settings-disable-pin").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("settings-lock-disable").click(); } });



  //--- App Initialization Routines ---
  async function initApp() {
    // Load dropdowns and currency config (DB reads - fast) in parallel
    const [, ] = await Promise.all([
      loadDropdowns(),
      loadDefaultCurrency()
    ]);
    populateYearFilter();

    // Render dashboard immediately (uses cached prices from DB)
    loadDashboard();

    // Background price refresh — don't block UI rendering
    apiFetch("/api/refresh-prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
      .then(() => {
        // Silently re-render dashboard with updated prices
        cachedRateData = null;
        invalidateDashboardCache();
        loadDashboard();
        if (currentTab === "holdings") loadHoldings();
      })
      .catch(() => {});

    setupAutocomplete("add-name", "add-name-suggestions");
    setupTxnTypeToggle();
    setupCurrencyToggleForInvestedBase();

    const fxIcon = document.querySelector(".pivot-fx-icon");
    if (fxIcon) {
      fxIcon.addEventListener("click", function(e) { e.stopPropagation(); const tooltip = this.nextElementSibling; if (tooltip) tooltip.classList.toggle("pivot-fx-tooltip-visible"); });
    }
    document.addEventListener("click", () => { const tooltip = document.querySelector(".pivot-fx-tooltip-visible"); if (tooltip) tooltip.classList.remove("pivot-fx-tooltip-visible"); });
    document.getElementById("add-date").value = new Date().toISOString().slice(0, 10); // fix #2.5: use .value not .valueAsDate
  }

  initApp();
  loadLockSettings();


  
  // --- Chart tooltip dismiss on tap outside (mobile fix) ---
  let lastTapChartKey = null;
  document.addEventListener("click", (e) => {
    const canvas = e.target.closest("canvas");
    if (!canvas) {
      [classPieChart, valueTrendChart, monthlyChart].forEach(chart => {
        if (chart && chart.tooltip) {
          chart.setActiveElements([]);
          chart.tooltip.setActiveElements([], {x: 0, y: 0 });
          chart.update("none");
        }
      });
      lastTapChartKey = null;
      return;
    }
    const chartInstance = [classPieChart, valueTrendChart, monthlyChart].find(c => c && c.canvas === canvas);
    if (!chartInstance || !chartInstance.tooltip) return;
    const activeEls = chartInstance.getActiveElements();
    if (activeEls.length === 0) {
      chartInstance.tooltip.setActiveElements([], {x: 0, y: 0 });
      chartInstance.update("none");
      lastTapChartKey = null;
    } else {
      const currentKey = canvas.id + "-" + activeEls[0].datasetIndex + "-" + activeEls[0].index;
      if (lastTapChartKey === currentKey) {
        chartInstance.setActiveElements([]);
        chartInstance.tooltip.setActiveElements([], {x: 0, y: 0 });
        chartInstance.update("none");
        lastTapChartKey = null;
      } else {
        lastTapChartKey = currentKey;
      }
    }
  });

  // --- Register Service Worker ---
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
})();
