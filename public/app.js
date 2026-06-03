(function () {
  "use strict";

  // --- Theme ---
  const themeToggle = document.getElementById("theme-toggle");
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
  }
  applyTheme(localStorage.getItem("theme") || "light");
  themeToggle.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    applyTheme(next);
  });

  // --- Tabs ---
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      tabContents.forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "dashboard") loadDashboard();
      if (btn.dataset.tab === "holdings") loadHoldings();
      if (btn.dataset.tab === "settings") loadSettings();
    });
  });

  // --- Helpers ---
  function fmt(n, currency) {
    if (n == null || isNaN(n)) return "—";
    const sym = currency === "USD" ? "$" : "₹";
    return sym + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtCompact(n) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtWhole(n) {
    if (n == null || isNaN(n)) return "—";
    return Math.round(Number(n)).toLocaleString("en-IN");
  }
  function fmtQty(n) {
    if (n == null) return "—";
    return Number(n).toFixed(8).replace(/\.?0+$/, "");
  }
  function fmtUnits(n) {
    if (n == null || isNaN(n)) return "—";
    if (n >= 1000) return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return Number(n).toFixed(6).replace(/\.?0+$/, "");
  }
  function fmtPct(n) {
    if (n == null || isNaN(n)) return "—";
    return n.toFixed(2) + "%";
  }
  function getCurrencySymbol(cur) {
    const symbols = { INR: "₹", USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", SGD: "S$", AED: "د.إ" };
    return symbols[cur] || cur + " ";
  }
  function formatDate(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }
  function showMsg(el, msg, type) {
    el.textContent = msg;
    el.className = "form-msg " + type;
    setTimeout(() => { el.textContent = ""; }, 3000);
  }
  function debounce(fn, ms) {
    let timer;
    return function (...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
  }

  // --- Toast notifications ---
  function toast(msg, type) {
    const container = document.getElementById("toast-container");
    const div = document.createElement("div");
    div.className = "toast toast-" + (type || "info");
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(() => { div.remove(); }, 3000);
  }

  // --- Button loading state (prevents double-click) ---
  function btnLoading(btn, loading) {
    if (loading) {
      btn.classList.add("btn-loading");
      btn.disabled = true;
    } else {
      btn.classList.remove("btn-loading");
      btn.disabled = false;
    }
  }

  // --- Configurable dropdowns cache ---
  let assetClasses = [];
  let assetTypes = [];
  let brokers = [];

  // --- Display currency state ---
  let displayCurrency = ""; // what we're currently showing values in (empty = no currency)
  let baseCurrency = ""; // configured default (empty = currency-agnostic mode)
  let altCurrency = ""; // configured exchange rate pair
  let altRate = 1; // rate from alt → base (e.g., 1 USD = 95.25 INR)
  let currencyConfigured = false; // whether currency is set up

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

  // Convert a value from base currency to display currency
  function toDisplayCurrency(valueInBase) {
    if (!currencyConfigured) return valueInBase;
    if (displayCurrency === baseCurrency) return valueInBase;
    // valueInBase is in baseCurrency (e.g., INR). Convert to altCurrency.
    // altRate = how many baseCurrency per 1 altCurrency (e.g., 95.25 INR per 1 USD)
    if (altRate && altRate > 0) return valueInBase / altRate;
    return valueInBase;
  }

  function fmtDisplay(n) {
    if (n == null || isNaN(n)) return "—";
    if (!currencyConfigured) return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sym = getCurrencySymbol(displayCurrency);
    return sym + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async function loadDropdowns() {
    [assetClasses, assetTypes, brokers] = await Promise.all([
      fetch("/api/settings/asset-classes").then(r => r.json()),
      fetch("/api/settings/asset-types").then(r => r.json()),
      fetch("/api/settings/brokers").then(r => r.json())
    ]);
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
      opt.textContent = emptyLabel || "— None —";
      sel.appendChild(opt);
    }
    for (const item of items) {
      const opt = document.createElement("option");
      opt.value = item.name;
      opt.textContent = item.name;
      sel.appendChild(opt);
    }
  }

  // --- Autocomplete for asset name ---
  function setupAutocomplete(inputId, listId) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    if (!input || !list) return;

    input.addEventListener("input", debounce(async () => {
      const q = input.value.trim();
      if (q.length < 1) { list.innerHTML = ""; list.style.display = "none"; return; }
      const suggestions = await fetch("/api/autocomplete/assets?q=" + encodeURIComponent(q)).then(r => r.json());
      if (suggestions.length === 0) { list.innerHTML = ""; list.style.display = "none"; return; }
      list.innerHTML = suggestions.map(s => `<li class="autocomplete-item">${s}</li>`).join("");
      list.style.display = "block";
    }, 200));

    list.addEventListener("click", async (e) => {
      if (e.target.classList.contains("autocomplete-item")) {
        input.value = e.target.textContent;
        list.innerHTML = "";
        list.style.display = "none";
        // Auto-populate ticker from ticker_map
        const tickerData = await fetch("/api/ticker-for-asset?name=" + encodeURIComponent(input.value)).then(r => r.json());
        if (tickerData.ticker) {
          document.getElementById("add-ticker").value = tickerData.ticker;
        }
      }
    });

    document.addEventListener("click", (e) => {
      if (!input.contains(e.target) && !list.contains(e.target)) {
        list.style.display = "none";
      }
    });
  }

  // --- Toggle ticker field visibility based on Buy/Sell ---
  function setupTxnTypeToggle() {
    const txnSelect = document.getElementById("add-txn-type");
    const tickerLabel = document.getElementById("ticker-label");
    txnSelect.addEventListener("change", () => {
      tickerLabel.style.display = txnSelect.value === "sell" ? "none" : "";
    });
  }

  // --- Toggle invested_base field visibility based on currency vs base currency ---
  function setupCurrencyToggleForInvestedBase() {
    const addCurrencySelect = document.getElementById("add-currency");
    const addInvestedBaseLabel = document.getElementById("add-invested-base-label");
    const addInvestedBaseCurrency = document.getElementById("add-invested-base-currency");

    function updateAddInvestedBase() {
      if (!currencyConfigured) {
        addInvestedBaseLabel.style.display = "none";
        return;
      }
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
    // Also run on init after base currency loads
    setTimeout(updateAddInvestedBase, 500);

    // Edit form
    const editCurrencySelect = document.getElementById("edit-currency");
    const editInvestedBaseLabel = document.getElementById("edit-invested-base-label");
    const editInvestedBaseCurrency = document.getElementById("edit-invested-base-currency");

    editCurrencySelect.addEventListener("change", () => {
      if (!currencyConfigured) {
        editInvestedBaseLabel.style.display = "none";
        return;
      }
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

  // --- Dashboard ---
  let classBarChart, classPieChart, typeBarChart, monthlyChart;

  async function loadDashboard() {
    const [summary, breakdown] = await Promise.all([
      fetch("/api/summary").then(r => r.json()),
      fetch("/api/breakdown").then(r => r.json())
    ]);

    // --- Summary cards (2x2) ---
    const grid = document.getElementById("summary-grid");
    grid.innerHTML = "";

    // Show the single configured exchange rate
    if (summary.display_rate && summary.display_rate_currency) {
      // Update global currency state
      altCurrency = summary.display_rate_currency;
      altRate = summary.display_rate;
    }
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
      { label: "Total P&L", value: toDisplayCurrency(summary.total.gain_loss), isChange: true, rawInvested: toDisplayCurrency(summary.total.invested) },
    ];

    // Show exchange rate
    if (currencyConfigured && altRate && altCurrency && altCurrency !== baseCurrency) {
      totalItems.push({ label: `${altCurrency}/${baseCurrency}`, value: altRate, isRate: true });
    }

    for (const item of totalItems) {
      const div = document.createElement("div");
      div.className = "summary-item";
      if (item.isChange) {
        const cls = item.value >= 0 ? "positive" : "negative";
        const arrow = item.value >= 0 ? "↑" : "↓";
        const pct = item.rawInvested ? ((item.value / item.rawInvested) * 100).toFixed(2) + "%" : "";
        div.innerHTML = `
          <div class="label">${item.label}</div>
          <div class="value ${cls}">${curSym}${fmtWhole(Math.abs(item.value))}</div>
          <div class="change ${cls}">${arrow} ${pct}</div>
        `;
      } else if (item.isRate) {
        div.innerHTML = `<div class="label">${item.label}</div><div class="value">${currencyConfigured ? getCurrencySymbol(baseCurrency) : ""}${Number(item.value).toFixed(2)}</div>`;
      } else {
        div.innerHTML = `<div class="label">${item.label}</div><div class="value">${curSym}${fmtWhole(item.value)}</div>`;
      }
      grid.appendChild(div);
    }

    // --- Allocation charts ---
    const classLabels = Object.keys(summary.by_class);
    const classValues = classLabels.map(k => summary.by_class[k].current_value);
    const classColors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];
    const totalVal = classValues.reduce((s, v) => s + v, 0);

    // Category pie chart
    if (classPieChart) classPieChart.destroy();
    const pieLabels = classLabels.map((l, i) => {
      const pct = totalVal ? (classValues[i] / totalVal * 100).toFixed(1) : 0;
      return `${l} (${pct}%)`;
    });
    const dClassValues = classValues.map(v => toDisplayCurrency(v));
    classPieChart = new Chart(document.getElementById("class-pie"), {
      type: "doughnut",
      data: {
        labels: pieLabels,
        datasets: [{ data: dClassValues, backgroundColor: classColors.slice(0, classLabels.length) }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 10 }, padding: 6, boxWidth: 10 } },
          tooltip: { callbacks: { label: (ctx) => curSym + fmtCompact(ctx.raw) } }
        }
      }
    });

    // Type pie chart
    const typeLabels = Object.keys(summary.by_type || {});
    const typeValues = typeLabels.map(k => summary.by_type[k].current_value);
    const typeColors = ["#6366f1", "#ec4899", "#14b8a6", "#f97316", "#84cc16", "#a855f7"];
    const typeTotalVal = typeValues.reduce((s, v) => s + v, 0);

    if (typeBarChart) typeBarChart.destroy();
    const typePieLabels = typeLabels.map((l, i) => {
      const pct = typeTotalVal ? (typeValues[i] / typeTotalVal * 100).toFixed(1) : 0;
      return `${l} (${pct}%)`;
    });
    const dTypeValues = typeValues.map(v => toDisplayCurrency(v));
    typeBarChart = new Chart(document.getElementById("type-pie"), {
      type: "doughnut",
      data: {
        labels: typePieLabels,
        datasets: [{ data: dTypeValues, backgroundColor: typeColors.slice(0, typeLabels.length) }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 10 }, padding: 6, boxWidth: 10 } },
          tooltip: { callbacks: { label: (ctx) => curSym + fmtCompact(ctx.raw) } }
        }
      }
    });

    // --- Monthly investments chart ---
    loadMonthlyChart(12);

    // Range selector
    document.querySelectorAll(".range-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".range-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        loadMonthlyChart(Number(btn.dataset.months));
      });
    });

    // --- Pivot table ---
    renderPivotTable(breakdown);
  }

  async function loadMonthlyChart(months) {
    const data = await fetch("/api/monthly-investments?months=" + months).then(r => r.json());
    const curSym = currencyConfigured ? getCurrencySymbol(displayCurrency) : "";

    const labels = data.months.map(m => {
      const [y, mo] = m.month.split("-");
      const date = new Date(y, mo - 1);
      return date.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
    });

    const cumulative = data.months.map(m => toDisplayCurrency(m.cumulative_invested));
    const classColorMap = { "India": "#3b82f6", "US": "#10b981", "Gold": "#f59e0b", "Crypto": "#8b5cf6" };
    const defaultColors = ["#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#f97316"];

    // Build stacked bar datasets per category
    const barDatasets = (data.classes || []).map((cls, i) => ({
      type: "bar",
      label: cls,
      data: data.months.map(m => toDisplayCurrency(m.by_class[cls] || 0)),
      backgroundColor: classColorMap[cls] || defaultColors[i % defaultColors.length],
      borderRadius: i === (data.classes.length - 1) ? 4 : 0,
      stack: "invested",
      order: 3,
      yAxisID: "y"
    }));

    // Portfolio value trend line
    const portfolioValue = toDisplayCurrency(data.total_current_value || 0);
    const lastCum = cumulative[cumulative.length - 1] || 1;
    const valueTrend = cumulative.map(cum => {
      if (lastCum === 0) return 0;
      return (cum / lastCum) * portfolioValue;
    });

    const lineDatasets = [
      {
        type: "line",
        label: "Invested Value",
        data: cumulative,
        borderColor: "#6366f1",
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [5, 3],
        pointRadius: 2,
        pointHoverRadius: 4,
        tension: 0.3,
        order: 1,
        yAxisID: "y1"
      },
      {
        type: "line",
        label: "Portfolio Value",
        data: valueTrend,
        borderColor: "#10b981",
        backgroundColor: "rgba(16, 185, 129, 0.08)",
        borderWidth: 2.5,
        pointRadius: 2,
        pointHoverRadius: 4,
        fill: true,
        tension: 0.3,
        order: 2,
        yAxisID: "y1"
      }
    ];

    if (monthlyChart) monthlyChart.destroy();
    monthlyChart = new Chart(document.getElementById("monthly-chart"), {
      type: "bar",
      data: {
        labels,
        datasets: [...barDatasets, ...lineDatasets]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", labels: { font: { size: 10 }, boxWidth: 12, padding: 8 } },
          tooltip: {
            callbacks: {
              label: (ctx) => ctx.dataset.label + ": " + curSym + fmtCompact(ctx.raw)
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            position: "left",
            stacked: true,
            title: { display: true, text: "Monthly (" + curSym + ")", font: { size: 10 } },
            ticks: { callback: (v) => curSym + fmtCompact(v), font: { size: 9 } },
            grid: { color: "rgba(0,0,0,0.05)" }
          },
          y1: {
            beginAtZero: true,
            position: "right",
            title: { display: true, text: "Cumulative (" + curSym + ")", font: { size: 10 } },
            ticks: { callback: (v) => curSym + fmtCompact(v), font: { size: 9 } },
            grid: { drawOnChartArea: false }
          },
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 45 } }
        }
      }
    });
  }

  function renderPivotTable(breakdown) {
    const pivotBody = document.getElementById("pivot-rows");
    const pivotFooter = document.getElementById("pivot-footer");
    pivotBody.innerHTML = "";
    pivotFooter.innerHTML = "";

    let grandInvested = 0, grandValue = 0;
    const curSym = currencyConfigured ? getCurrencySymbol(displayCurrency) : "";
    const defaultCur = baseCurrency || "";

    // Check if any assets are in foreign currency
    let hasForeignCurrency = false;
    for (const cls of breakdown.classes) {
      for (const asset of cls.assets) {
        if (asset.currency && asset.currency !== defaultCur) {
          hasForeignCurrency = true;
          break;
        }
      }
      if (hasForeignCurrency) break;
    }

    // Show/hide tooltip icon for foreign currency info
    const tooltipWrap = document.getElementById("pivot-fx-tooltip-wrap");
    if (tooltipWrap) {
      if (hasForeignCurrency && defaultCur) {
        const tooltipText = document.getElementById("pivot-fx-tooltip-text");
        tooltipText.innerHTML = `• Foreign currency investments are shown converted to ${defaultCur}. The invested amount reflects what you actually spent in ${defaultCur}.<br>• To view original currency amounts, see the Holdings tab.`;
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
          <button class="pivot-toggle" aria-expanded="false" aria-label="Expand ${cls.asset_class}">▶</button>
          <span class="badge badge-${cls.asset_class.toLowerCase().replace(/\s+/g, '-')}">${cls.asset_class}</span>
        </td>
        <td class="col-amount">—</td>
        <td class="col-amount">${curSym}${fmtCompact(dInvested)}</td>
        <td class="col-amount">—</td>
        <td class="col-amount">${curSym}${fmtCompact(dValue)}</td>
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
        const curPriceStr = adPrice ? curSym + fmtCompact(adPrice) : "—";

        const childTr = document.createElement("tr");
        childTr.className = "pivot-child pivot-child-hidden";
        childTr.dataset.parentClass = cls.asset_class;
        childTr.innerHTML = `
          <td class="pivot-child-cell">${asset.name} <span class="pivot-asset-type">${asset.asset_type || ""}</span></td>
          <td class="col-amount">${fmtUnits(asset.units)}</td>
          <td class="col-amount">${curSym}${fmtCompact(adInvested)}</td>
          <td class="col-amount">${curPriceStr}</td>
          <td class="col-amount">${curSym}${fmtCompact(adValue)}</td>
          <td class="col-amount ${aPlClass}">${curSym}${fmtCompact(adGain)}</td>
          <td class="col-amount ${aPlClass}">${aPlPct}%</td>
        `;
        pivotBody.appendChild(childTr);
      }

      parentTr.querySelector(".pivot-toggle").addEventListener("click", function() {
        const expanded = this.getAttribute("aria-expanded") === "true";
        this.setAttribute("aria-expanded", String(!expanded));
        this.textContent = expanded ? "▶" : "▼";
        const children = pivotBody.querySelectorAll(`tr[data-parent-class="${cls.asset_class}"]`);
        children.forEach(c => c.classList.toggle("pivot-child-hidden", expanded));
      });
    }

    const grandPl = grandValue - grandInvested;
    const grandPct = grandInvested > 0 ? ((grandPl / grandInvested) * 100).toFixed(2) : "0.00";
    const grandPlClass = grandPl >= 0 ? "positive" : "negative";
    const dGrandInv = toDisplayCurrency(grandInvested);
    const dGrandVal = toDisplayCurrency(grandValue);
    const dGrandPl = toDisplayCurrency(grandPl);
    pivotFooter.innerHTML = `
      <tr>
        <td><strong>TOTAL</strong></td>
        <td class="col-amount">—</td>
        <td class="col-amount"><strong>${curSym}${fmtCompact(dGrandInv)}</strong></td>
        <td class="col-amount">—</td>
        <td class="col-amount"><strong>${curSym}${fmtCompact(dGrandVal)}</strong></td>
        <td class="col-amount ${grandPlClass}"><strong>${curSym}${fmtCompact(dGrandPl)}</strong></td>
        <td class="col-amount ${grandPlClass}"><strong>${grandPct}%</strong></td>
      </tr>
    `;

    document.getElementById("expand-all-btn").onclick = () => {
      pivotBody.querySelectorAll(".pivot-toggle").forEach(btn => {
        btn.setAttribute("aria-expanded", "true");
        btn.textContent = "▼";
      });
      pivotBody.querySelectorAll(".pivot-child").forEach(c => c.classList.remove("pivot-child-hidden"));
    };
    document.getElementById("collapse-all-btn").onclick = () => {
      pivotBody.querySelectorAll(".pivot-toggle").forEach(btn => {
        btn.setAttribute("aria-expanded", "false");
        btn.textContent = "▶";
      });
      pivotBody.querySelectorAll(".pivot-child").forEach(c => c.classList.add("pivot-child-hidden"));
    };
  }

  function generateColors(count) {
    const base = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1"];
    const colors = [];
    for (let i = 0; i < count; i++) colors.push(base[i % base.length]);
    return colors;
  }

  // --- Holdings ---
  let selectedIds = new Set();

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

  async function loadHoldings() {
    const params = new URLSearchParams();
    const search = document.getElementById("filter-search").value.trim();
    const assetClass = document.getElementById("filter-class").value;
    const broker = document.getElementById("filter-broker").value;
    const currency = document.getElementById("filter-currency").value;

    if (search) params.set("name", search);
    if (assetClass) params.set("asset_class", assetClass);
    if (broker) params.set("broker", broker);
    if (currency) params.set("currency", currency);

    const rows = await fetch("/api/holdings?" + params).then(r => r.json());
    const tbody = document.getElementById("holdings-rows");
    tbody.innerHTML = "";

    let totalInvested = 0, totalValue = 0;
    // Fetch exchange rates for consistent default-currency totals
    let rateData = { default_currency: "INR", rates: {} };
    try {
      rateData = await fetch("/api/exchange-rate").then(r => r.json());
    } catch(e) {}

    for (const r of rows) {
      const fx = r.currency === rateData.default_currency ? 1 : (rateData.rates[r.currency] || 1);
      totalInvested += (r.invested_amount || 0) * fx;
      totalValue += (r.current_value || 0) * fx;
      const plClass = (r.gain_loss != null && r.gain_loss >= 0) ? "positive" : "negative";
      const checked = selectedIds.has(r.id) ? "checked" : "";
      const txnBadge = r.txn_type === "sell"
        ? '<span class="badge badge-sell">SELL</span>'
        : '<span class="badge badge-buy">BUY</span>';
      const tr = document.createElement("tr");
      tr.className = r.txn_type === "sell" ? "row-sell" : "";
      tr.innerHTML = `
        <td class="col-check"><input type="checkbox" class="row-check" data-id="${r.id}" ${checked} /></td>
        <td>${formatDate(r.date)}</td>
        <td>${txnBadge}</td>
        <td>${r.name}</td>
        <td><span class="badge badge-${r.asset_class.toLowerCase().replace(/\s+/g, '-')}">${r.asset_class}</span></td>
        <td>${r.broker || "—"}</td>
        <td>${r.currency}</td>
        <td class="col-amount">${fmt(r.buy_price, r.currency)}</td>
        <td class="col-amount">${fmtQty(Math.abs(r.quantity))}</td>
        <td class="col-amount">${fmt(r.invested_amount, r.currency)}</td>
        <td class="col-amount">${r.current_price ? fmt(r.current_price, r.currency) : "—"}</td>
        <td class="col-amount">${r.current_value != null ? fmt(r.current_value, r.currency) : "—"}</td>
        <td class="col-amount ${plClass}">${r.gain_loss != null ? fmt(r.gain_loss, r.currency) : "—"}</td>
        <td class="col-amount ${plClass}">${fmtPct(r.gain_loss_pct)}</td>
        <td class="col-actions">
          ${r.notes ? '<button class="action-btn" onclick="viewNotes(' + r.id + ')" title="View notes">📝</button>' : '<button class="action-btn notes-empty" onclick="viewNotes(' + r.id + ')" title="Add note">📄</button>'}
          <button class="action-btn" onclick="editHolding(${r.id})" title="Edit">✏️</button>
          <button class="action-btn delete" onclick="deleteHolding(${r.id})" title="Delete">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    // Checkbox event listeners
    tbody.querySelectorAll(".row-check").forEach(cb => {
      cb.addEventListener("change", () => {
        const id = Number(cb.dataset.id);
        if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
        updateBatchBar();
        updateSelectAll();
      });
    });

    // Update select-all state
    updateSelectAll();

    const pl = totalValue - totalInvested;
    const footerSym = currencyConfigured ? getCurrencySymbol(displayCurrency) : "";
    const dispInvested = toDisplayCurrency(totalInvested);
    const dispValue = toDisplayCurrency(totalValue);
    const dispPl = toDisplayCurrency(pl);
    document.getElementById("holdings-footer").textContent =
      `${rows.length} entries | Invested: ${footerSym}${fmtCompact(dispInvested)} | Value: ${footerSym}${fmtCompact(dispValue)} | P&L: ${footerSym}${fmtCompact(dispPl)}`;
  }

  function updateSelectAll() {
    const all = document.querySelectorAll(".row-check");
    const checked = document.querySelectorAll(".row-check:checked");
    const selectAll = document.getElementById("select-all");
    selectAll.checked = all.length > 0 && checked.length === all.length;
    selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
  }

  // Select all checkbox
  document.getElementById("select-all").addEventListener("change", function() {
    const checked = this.checked;
    document.querySelectorAll(".row-check").forEach(cb => {
      cb.checked = checked;
      const id = Number(cb.dataset.id);
      if (checked) selectedIds.add(id); else selectedIds.delete(id);
    });
    updateBatchBar();
  });

  // Batch action dropdown — show value selector when appropriate
  document.getElementById("batch-action").addEventListener("change", function() {
    const action = this.value;
    const valueSelect = document.getElementById("batch-value");

    if (action === "asset_class") {
      valueSelect.innerHTML = '<option value="">— Select Class —</option>';
      assetClasses.forEach(c => { valueSelect.innerHTML += `<option value="${c.name}">${c.name}</option>`; });
      valueSelect.classList.remove("batch-value-hidden");
    } else if (action === "asset_type") {
      valueSelect.innerHTML = '<option value="">— Select Type —</option>';
      assetTypes.forEach(t => { valueSelect.innerHTML += `<option value="${t.name}">${t.name}</option>`; });
      valueSelect.classList.remove("batch-value-hidden");
    } else if (action === "broker") {
      valueSelect.innerHTML = '<option value="">— Select Broker —</option>';
      brokers.forEach(b => { valueSelect.innerHTML += `<option value="${b.name}">${b.name}</option>`; });
      valueSelect.classList.remove("batch-value-hidden");
    } else {
      valueSelect.classList.add("batch-value-hidden");
    }
  });

  // Apply batch action
  document.getElementById("batch-apply-btn").addEventListener("click", async function() {
    const btn = this;
    const action = document.getElementById("batch-action").value;
    const value = document.getElementById("batch-value").value;
    const ids = Array.from(selectedIds);

    if (ids.length === 0) { toast("No items selected", "error"); return; }
    if (!action) { toast("Select an action", "error"); return; }

    btnLoading(btn, true);

    if (action === "delete") {
      if (!confirm(`Delete ${ids.length} selected holdings? This cannot be undone.`)) {
        btnLoading(btn, false);
        return;
      }
      const res = await fetch("/api/holdings/batch-delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids })
      });
      const data = await res.json();
      if (res.ok) {
        toast(`Deleted ${data.deleted} holdings`, "success");
        selectedIds.clear();
        updateBatchBar();
        loadHoldings();
      } else {
        toast(data.error || "Error", "error");
      }
    } else {
      if (!value) { toast("Select a value", "error"); btnLoading(btn, false); return; }
      const updates = { [action]: value };
      const res = await fetch("/api/holdings/batch-update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, updates })
      });
      const data = await res.json();
      if (res.ok) {
        toast(`Updated ${data.updated} holdings`, "success");
        selectedIds.clear();
        updateBatchBar();
        loadHoldings();
      } else {
        toast(data.error || "Error", "error");
      }
    }

    btnLoading(btn, false);
    document.getElementById("batch-action").value = "";
    document.getElementById("batch-value").classList.add("batch-value-hidden");
  });

  // Clear selection
  document.getElementById("batch-clear-btn").addEventListener("click", () => {
    selectedIds.clear();
    document.querySelectorAll(".row-check").forEach(cb => cb.checked = false);
    document.getElementById("select-all").checked = false;
    document.getElementById("select-all").indeterminate = false;
    updateBatchBar();
  });

  // --- Add Form ---
  document.getElementById("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const txnType = document.getElementById("add-txn-type").value;
    const ticker = document.getElementById("add-ticker").value.trim();
    const name = document.getElementById("add-name").value.trim();
    const selectedCurrency = currencyConfigured ? document.getElementById("add-currency").value : "";

    const body = {
      date: document.getElementById("add-date").value,
      txn_type: txnType,
      name: name,
      asset_class: document.getElementById("add-asset-class").value,
      asset_type: document.getElementById("add-asset-type").value,
      broker: document.getElementById("add-broker").value,
      buy_price: document.getElementById("add-buy-price").value,
      quantity: document.getElementById("add-quantity").value,
      invested_amount: document.getElementById("add-invested").value,
      currency: selectedCurrency || baseCurrency,
      ticker: ticker,
      notes: document.getElementById("add-notes").value,
    };

    // Include invested_base only for foreign currency holdings
    if (currencyConfigured && selectedCurrency && selectedCurrency !== baseCurrency) {
      const investedBaseVal = document.getElementById("add-invested-base").value;
      if (investedBaseVal) {
        body.invested_base = investedBaseVal;
      }
    }

    const res = await fetch("/api/holdings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (res.ok) {
      showMsg(document.getElementById("add-msg"), "Transaction added", "success");
      // If buy and no ticker, show a helpful reminder
      if (txnType === "buy" && !ticker) {
        toast("Tip: Add a ticker in Settings → Ticker Mapping for live price updates", "info");
      }
      document.getElementById("add-form").reset();
      document.getElementById("add-date").valueAsDate = new Date();
      if (currencyConfigured) document.getElementById("add-currency").value = baseCurrency;
      document.getElementById("add-invested-base-label").style.display = "none";
      loadHoldings();
    } else {
      showMsg(document.getElementById("add-msg"), data.error, "error");
    }
  });

  // Filters
  document.getElementById("filter-search").addEventListener("input", debounce(loadHoldings, 300));
  document.getElementById("filter-class").addEventListener("change", loadHoldings);
  document.getElementById("filter-broker").addEventListener("change", loadHoldings);
  document.getElementById("filter-currency").addEventListener("change", loadHoldings);

  // Filter reset
  document.getElementById("filter-reset-btn").addEventListener("click", () => {
    document.getElementById("filter-search").value = "";
    document.getElementById("filter-class").value = "";
    document.getElementById("filter-broker").value = "";
    document.getElementById("filter-currency").value = "";
    loadHoldings();
  });

  // New Transaction toggle
  document.getElementById("new-txn-toggle").addEventListener("click", function() {
    const content = document.getElementById("new-txn-content");
    const isOpen = content.style.display !== "none";
    content.style.display = isOpen ? "none" : "block";
    this.classList.toggle("open", !isOpen);
    this.textContent = isOpen ? "+ New Transaction" : "✕ Close";
  });

  // --- Edit Modal ---
  const editModal = document.getElementById("edit-modal");
  document.getElementById("edit-cancel").addEventListener("click", () => editModal.classList.remove("open"));

  window.editHolding = async function(id) {
    const rows = await fetch("/api/holdings").then(r => r.json());
    const row = rows.find(r => r.id === id);
    if (!row) return;

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

    // Show/hide invested_base field
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

    // Hide currency field if not configured
    const editCurrencyLabel = document.getElementById("edit-currency").closest("label");
    if (editCurrencyLabel) editCurrencyLabel.style.display = currencyConfigured ? "" : "none";

    editModal.classList.add("open");
  };

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
      notes: document.getElementById("edit-notes").value,
    };

    // Include invested_base only for foreign currency holdings
    if (currencyConfigured && selectedCurrency && selectedCurrency !== baseCurrency) {
      const investedBaseVal = document.getElementById("edit-invested-base").value;
      if (investedBaseVal) {
        body.invested_base = investedBaseVal;
      }
    }

    const res = await fetch(`/api/holdings/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) {
      editModal.classList.remove("open");
      loadHoldings();
    }
  });

  // --- Delete ---
  window.deleteHolding = async function(id) {
    if (!confirm("Delete this holding?")) return;
    const res = await fetch(`/api/holdings/${id}`, { method: "DELETE" });
    if (res.ok) loadHoldings();
  };

  // --- Currency Toggle ---
  document.getElementById("currency-toggle").addEventListener("click", () => {
    // Toggle between base and alt currency
    if (displayCurrency === baseCurrency && altCurrency && altCurrency !== baseCurrency) {
      displayCurrency = altCurrency;
    } else {
      displayCurrency = baseCurrency;
    }
    updateCurrencyToggleBtn();
    loadDashboard();
    loadHoldings();
  });

  // --- Refresh Prices ---
  document.getElementById("refresh-prices-btn").addEventListener("click", async () => {
    const btn = document.getElementById("refresh-prices-btn");
    btn.disabled = true;
    btn.textContent = "⏳ Fetching...";
    try {
      const res = await fetch("/api/refresh-prices", { method: "POST" });
      const data = await res.json();
      btn.textContent = `✅ ${data.updated} updated`;
      setTimeout(() => { btn.textContent = "🔄 Prices"; btn.disabled = false; }, 3000);
      loadHoldings();
      loadDashboard();
    } catch (e) {
      btn.textContent = "❌ Error";
      setTimeout(() => { btn.textContent = "🔄 Prices"; btn.disabled = false; }, 3000);
    }
  });

  // ===========================
  // SETTINGS
  // ===========================
  async function loadSettings() {
    const [classes, types, brokersData, tickers] = await Promise.all([
      fetch("/api/settings/asset-classes").then(r => r.json()),
      fetch("/api/settings/asset-types").then(r => r.json()),
      fetch("/api/settings/brokers").then(r => r.json()),
      fetch("/api/settings/tickers").then(r => r.json())
    ]);

    renderSettingsList("settings-classes-list", classes, "asset-classes");
    renderSettingsList("settings-types-list", types, "asset-types");
    renderSettingsList("settings-brokers-list", brokersData, "brokers");
    renderTickersList(tickers);
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
        const btn = this;
        const input = li.querySelector(".settings-item-input");
        const newName = input.value.trim();
        if (!newName || newName === input.dataset.original) return;
        btnLoading(btn, true);
        const res = await fetch(`/api/settings/${endpoint}/${item.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName })
        });
        if (res.ok) {
          input.dataset.original = newName;
          toast("Renamed successfully", "success");
          loadDropdowns();
        } else {
          const err = await res.json();
          toast(err.error || "Error", "error");
        }
        btnLoading(btn, false);
      });

      li.querySelector(".settings-delete-btn").addEventListener("click", async function() {
        if (!confirm(`Delete "${item.name}"?`)) return;
        const btn = this;
        btnLoading(btn, true);
        const res = await fetch(`/api/settings/${endpoint}/${item.id}`, { method: "DELETE" });
        const data = await res.json();
        if (res.ok) {
          toast("Deleted: " + item.name, "success");
          loadSettings();
          loadDropdowns();
        } else {
          toast(data.error || "Cannot delete", "error");
        }
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
        <td>
          <input type="text" class="ticker-edit-input" value="${t.ticker}" data-asset="${t.asset_name}" data-original="${t.ticker}" />
        </td>
        <td class="col-actions">
          <button class="action-btn ticker-save-btn" title="Save">💾</button>
          <button class="action-btn delete ticker-delete-btn" title="Delete">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);

      tr.querySelector(".ticker-save-btn").addEventListener("click", async function() {
        const btn = this;
        const input = tr.querySelector(".ticker-edit-input");
        const newTicker = input.value.trim();
        if (!newTicker || newTicker === input.dataset.original) return;
        btnLoading(btn, true);
        try {
          const res = await fetch("/api/settings/tickers", {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ asset_name: input.dataset.asset, ticker: newTicker })
          });
          if (res.ok) {
            input.dataset.original = newTicker;
            toast("Ticker updated: " + input.dataset.asset, "success");
          } else {
            const err = await res.json();
            toast(err.error || "Error saving ticker", "error");
          }
        } catch (e) {
          toast("Network error", "error");
        }
        btnLoading(btn, false);
      });

      tr.querySelector(".ticker-delete-btn").addEventListener("click", async function() {
        if (!confirm(`Remove ticker mapping for "${t.asset_name}"?`)) return;
        const btn = this;
        btnLoading(btn, true);
        const res = await fetch(`/api/settings/tickers/${encodeURIComponent(t.asset_name)}`, { method: "DELETE" });
        const data = await res.json();
        if (res.ok) {
          toast("Ticker removed: " + t.asset_name, "success");
          loadSettings();
        } else {
          toast(data.error || "Cannot delete ticker", "error");
        }
        btnLoading(btn, false);
      });
    }
  }

  // Settings add buttons
  document.getElementById("settings-class-add-btn").addEventListener("click", async function() {
    const btn = this;
    const input = document.getElementById("settings-class-input");
    const name = input.value.trim();
    if (!name) return;
    btnLoading(btn, true);
    const res = await fetch("/api/settings/asset-classes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (res.ok) { input.value = ""; toast("Added: " + name, "success"); loadSettings(); loadDropdowns(); }
    else { const err = await res.json(); toast(err.error, "error"); }
    btnLoading(btn, false);
  });

  document.getElementById("settings-type-add-btn").addEventListener("click", async function() {
    const btn = this;
    const input = document.getElementById("settings-type-input");
    const name = input.value.trim();
    if (!name) return;
    btnLoading(btn, true);
    const res = await fetch("/api/settings/asset-types", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (res.ok) { input.value = ""; toast("Added: " + name, "success"); loadSettings(); loadDropdowns(); }
    else { const err = await res.json(); toast(err.error, "error"); }
    btnLoading(btn, false);
  });

  document.getElementById("settings-broker-add-btn").addEventListener("click", async function() {
    const btn = this;
    const input = document.getElementById("settings-broker-input");
    const name = input.value.trim();
    if (!name) return;
    btnLoading(btn, true);
    const res = await fetch("/api/settings/brokers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (res.ok) { input.value = ""; toast("Added: " + name, "success"); loadSettings(); loadDropdowns(); }
    else { const err = await res.json(); toast(err.error, "error"); }
    btnLoading(btn, false);
  });

  document.getElementById("settings-ticker-add-btn").addEventListener("click", async function() {
    const btn = this;
    const assetInput = document.getElementById("settings-ticker-asset");
    const symbolInput = document.getElementById("settings-ticker-symbol");
    const asset_name = assetInput.value.trim();
    const ticker = symbolInput.value.trim();
    if (!asset_name || !ticker) return;
    btnLoading(btn, true);
    const res = await fetch("/api/settings/tickers", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asset_name, ticker }) });
    if (res.ok) { assetInput.value = ""; symbolInput.value = ""; toast("Mapped: " + asset_name + " → " + ticker, "success"); loadSettings(); }
    btnLoading(btn, false);
  });

  // Default currency save
  document.getElementById("settings-currency-save-btn").addEventListener("click", async function() {
    const btn = this;
    const currency = document.getElementById("settings-default-currency").value;
    const rateDisplay = document.getElementById("settings-rate-display").value;

    // If user is disabling currency and has multi-currency holdings, show warning
    if (!currency && currencyConfigured) {
      // Check if multiple currencies exist
      const checkRes = await fetch("/api/settings/currency").then(r => r.json());
      const multiCur = checkRes.holding_currencies && checkRes.holding_currencies.length > 1;
      if (multiCur) {
        const currencies = checkRes.holding_currencies.join(", ");
        const confirmed = confirm(
          `⚠️ WARNING: You have holdings in multiple currencies (${currencies}).\n\n` +
          `Disabling currency configuration will:\n` +
          `• Stop all currency conversions — invested amounts will show as raw numbers\n` +
          `• The "Invested in base currency" values will no longer be used in summaries\n` +
          `• Exchange rate display and currency toggle will be hidden\n` +
          `• All values in the breakdown will mix different currencies without distinction\n\n` +
          `Your previous configuration will be saved and can be restored at any time.\n\n` +
          `Are you sure you want to proceed?`
        );
        if (!confirmed) {
          // Revert the dropdown to current value
          document.getElementById("settings-default-currency").value = baseCurrency;
          return;
        }
      }
    }

    btnLoading(btn, true);
    const body = { currency, rate_display: rateDisplay };
    // If disabling currency (was configured, now empty), save previous state
    if (!currency && currencyConfigured) {
      body.save_previous = true;
    }

    const res = await fetch("/api/settings/currency", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      toast("Currency settings saved", "success");
      // Reload currency state to update all UI
      await loadDefaultCurrency();
      loadDashboard();
      loadHoldings();
    } else {
      toast("Error saving currency", "error");
    }
    btnLoading(btn, false);
  });

  // Restore previous currency configuration
  document.getElementById("currency-restore-btn").addEventListener("click", async function() {
    const btn = this;
    btnLoading(btn, true);
    const res = await fetch("/api/settings/currency/restore", { method: "POST" });
    if (res.ok) {
      toast("Currency configuration restored", "success");
      await loadDefaultCurrency();
      loadDashboard();
      loadHoldings();
    } else {
      const err = await res.json();
      toast(err.error || "Error restoring", "error");
    }
    btnLoading(btn, false);
  });

  // Show/hide rate display and info when user changes base currency in settings
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

  // Load default currency on init
  async function loadDefaultCurrency() {
    try {
      const data = await fetch("/api/settings/currency").then(r => r.json());
      const cur = data.default_currency || "";
      currencyConfigured = !!cur;
      baseCurrency = cur;
      displayCurrency = cur;

      document.getElementById("settings-default-currency").value = cur;

      // Toggle currency-dependent UI
      const addCurrencyLabel = document.getElementById("add-currency").closest("label");
      const editCurrencyLabel = document.getElementById("edit-currency").closest("label");
      const rateDisplayLabel = document.getElementById("rate-display-label");
      const configInfo = document.getElementById("currency-config-info");
      const restoreSection = document.getElementById("currency-restore-section");

      if (currencyConfigured) {
        // Currency is configured — show all currency features
        if (addCurrencyLabel) addCurrencyLabel.style.display = "";
        if (editCurrencyLabel) editCurrencyLabel.style.display = "";
        if (rateDisplayLabel) rateDisplayLabel.style.display = "";
        if (configInfo) configInfo.style.display = "block";
        if (restoreSection) restoreSection.style.display = "none";
        document.getElementById("add-currency").value = cur;
      } else {
        // Currency-agnostic mode — hide currency features
        if (addCurrencyLabel) addCurrencyLabel.style.display = "none";
        if (editCurrencyLabel) editCurrencyLabel.style.display = "none";
        if (rateDisplayLabel) rateDisplayLabel.style.display = "none";
        if (configInfo) configInfo.style.display = "none";

        // Show restore button if previous config exists and multi-currency holdings exist
        if (restoreSection) {
          const hasMultiCurrency = data.holding_currencies && data.holding_currencies.length > 1;
          const hasPrevious = !!data.previous_default_currency;
          if (hasPrevious && hasMultiCurrency) {
            restoreSection.style.display = "block";
            document.getElementById("currency-restore-label").textContent =
              `Restore previous configuration (${data.previous_default_currency})`;
          } else {
            restoreSection.style.display = "none";
          }
        }
      }

      if (data.rate_display) {
        document.getElementById("settings-rate-display").value = data.rate_display;
        altCurrency = data.rate_display;
      }

      updateCurrencyToggleBtn();
    } catch(e) {}
  }

  // --- Notes Modal ---
  const notesModal = document.getElementById("notes-modal");
  let notesCurrentId = null;

  window.viewNotes = async function(id) {
    const rows = await fetch("/api/holdings").then(r => r.json());
    const row = rows.find(r => r.id === id);
    if (!row) return;
    notesCurrentId = id;
    document.getElementById("notes-modal-asset").textContent = row.name;
    document.getElementById("notes-modal-text").value = row.notes || "";
    notesModal.classList.add("open");
  };

  document.getElementById("notes-cancel-btn").addEventListener("click", () => {
    notesModal.classList.remove("open");
    notesCurrentId = null;
  });

  document.getElementById("notes-save-btn").addEventListener("click", async function() {
    if (!notesCurrentId) return;
    const btn = this;
    const notes = document.getElementById("notes-modal-text").value;
    btnLoading(btn, true);
    // Get current holding data to preserve fields
    const rows = await fetch("/api/holdings").then(r => r.json());
    const row = rows.find(r => r.id === notesCurrentId);
    if (row) {
      const body = {
        date: row.date, name: row.name, asset_class: row.asset_class,
        asset_type: row.asset_type, broker: row.broker, buy_price: row.buy_price,
        quantity: row.quantity, invested_amount: row.invested_amount,
        currency: row.currency, ticker: row.ticker, notes: notes
      };
      const res = await fetch(`/api/holdings/${notesCurrentId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      if (res.ok) {
        toast("Note saved", "success");
        notesModal.classList.remove("open");
        notesCurrentId = null;
        loadHoldings();
      } else {
        toast("Error saving note", "error");
      }
    }
    btnLoading(btn, false);
  });

  // --- Lock Settings ---
  async function loadLockSettings() {
    const res = await fetch("/api/lock/status");
    const { locked } = await res.json();
    document.getElementById("lock-setup-section").style.display = locked ? "none" : "block";
    document.getElementById("lock-disable-section").style.display = locked ? "block" : "none";
    document.getElementById("lock-recovery-alert-section").style.display = "none";
  }

  document.getElementById("settings-lock-enable").addEventListener("click", async () => {
    const pin = document.getElementById("settings-pin").value;
    const confirmPin = document.getElementById("settings-pin-confirm").value;
    const msg = document.getElementById("settings-lock-message");
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) { msg.textContent = "PIN must be exactly 6 digits."; msg.className = "form-msg error"; return; }
    if (pin !== confirmPin) { msg.textContent = "PINs do not match."; msg.className = "form-msg error"; return; }

    const res = await fetch("/api/lock/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    const data = await res.json();
    if (data.success) {
      document.getElementById("lock-setup-section").style.display = "none";
      const alertSection = document.getElementById("lock-recovery-alert-section");
      alertSection.innerHTML = `<div class="recovery-alert"><div class="recovery-alert-header">✓ Lock enabled successfully</div><div class="recovery-alert-body"><p>Your recovery code:</p><code class="recovery-code">${data.recoveryCode}</code><p class="recovery-warning">⚠️ Save this code now. This is the only time it will be shown.</p><p class="recovery-tips">Tips: Save it in your notes app, email it to yourself, or store it in your password manager.</p></div></div>`;
      alertSection.style.display = "block";
      document.getElementById("lock-disable-section").style.display = "block";
    } else { msg.textContent = data.error || "Failed"; msg.className = "form-msg error"; }
  });

  document.getElementById("settings-lock-disable").addEventListener("click", async () => {
    const pin = document.getElementById("settings-disable-pin").value;
    const msg = document.getElementById("settings-disable-message");
    const res = await fetch("/api/lock/disable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    const data = await res.json();
    if (data.success) { localStorage.removeItem("lock-remembered"); msg.textContent = "Lock disabled."; msg.className = "form-msg success"; document.getElementById("settings-disable-pin").value = ""; loadLockSettings(); }
    else { msg.textContent = data.error || "Incorrect PIN"; msg.className = "form-msg error"; }
  });

  // PIN input: digits only
  document.querySelectorAll('#settings-pin, #settings-pin-confirm, #settings-disable-pin, #lock-pin-input').forEach(input => {
    input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, ""); });
  });

  // Enter key on PIN fields
  document.getElementById("settings-pin-confirm").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("settings-lock-enable").click(); } });
  document.getElementById("settings-disable-pin").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("settings-lock-disable").click(); } });

  // --- Lock Overlay ---
  const lockOverlay = document.getElementById("lock-overlay");

  document.getElementById("lock-unlock-btn").addEventListener("click", async () => {
    const pin = document.getElementById("lock-pin-input").value;
    const err = document.getElementById("lock-error");
    const remember = document.getElementById("lock-remember").checked;
    const res = await fetch("/api/lock/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    if (res.ok) {
      if (remember) localStorage.setItem("lock-remembered", new Date().toISOString().slice(0, 10));
      lockOverlay.style.display = "none";
      initApp();
    } else { err.textContent = "Incorrect PIN."; err.style.display = "block"; }
  });

  document.getElementById("lock-pin-input").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("lock-unlock-btn").click(); } });

  document.getElementById("show-recovery-btn").addEventListener("click", e => {
    e.preventDefault();
    document.getElementById("lock-recovery-section").style.display = "block";
  });

  document.getElementById("lock-recovery-submit").addEventListener("click", async () => {
    const code = document.getElementById("lock-recovery-input").value;
    const err = document.getElementById("lock-error");
    const res = await fetch("/api/lock/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    if (res.ok) { lockOverlay.style.display = "none"; initApp(); }
    else { err.textContent = "Invalid recovery code."; err.style.display = "block"; }
  });

  document.getElementById("lock-recovery-input").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("lock-recovery-submit").click(); } });

  // --- App Init ---
  async function initApp() {
    await loadDropdowns();
    loadDefaultCurrency();
    try { await fetch("/api/refresh-prices", { method: "POST" }); } catch(e) {}
    loadDashboard();
    setupAutocomplete("add-name", "add-name-suggestions");
    setupTxnTypeToggle();
    setupCurrencyToggleForInvestedBase();
    // Safari iOS: tap to toggle tooltip (hover doesn't work on touch)
    const fxIcon = document.querySelector(".pivot-fx-icon");
    if (fxIcon) {
      fxIcon.addEventListener("click", function(e) {
        e.stopPropagation();
        const tooltip = this.nextElementSibling;
        if (tooltip) tooltip.classList.toggle("pivot-fx-tooltip-visible");
      });
      document.addEventListener("click", () => {
        const tooltip = document.querySelector(".pivot-fx-tooltip-visible");
        if (tooltip) tooltip.classList.remove("pivot-fx-tooltip-visible");
      });
    }
    document.getElementById("add-date").valueAsDate = new Date();
    loadLockSettings();
  }

  async function checkLockAndInit() {
    try {
      const res = await fetch("/api/lock/status");
      const { locked } = await res.json();
      if (locked) {
        const remembered = localStorage.getItem("lock-remembered");
        const today = new Date().toISOString().slice(0, 10);
        if (remembered === today) {
          lockOverlay.style.display = "none";
          initApp();
        } else {
          if (remembered) localStorage.removeItem("lock-remembered");
          lockOverlay.style.display = "flex";
        }
      } else {
        lockOverlay.style.display = "none";
        initApp();
      }
    } catch {
      lockOverlay.style.display = "none";
      initApp();
    }
  }

  checkLockAndInit();

  // --- Mobile: Swipe sync tabs with scroll-snap panels ---
  if (window.matchMedia("(max-width: 640px)").matches) {
    const container = document.getElementById("main-container");
    const tabs = Array.from(document.querySelectorAll(".tab-btn"));
    const panels = Array.from(document.querySelectorAll(".tab-content"));

    // Sync tab highlight on scroll
    let scrollTimeout;
    container.addEventListener("scroll", () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const idx = Math.round(container.scrollLeft / container.offsetWidth);
        tabs.forEach((t, i) => t.classList.toggle("active", i === idx));
      }, 50);
    });

    // Tab click scrolls to panel
    tabs.forEach((btn, i) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        container.scrollTo({ left: i * container.offsetWidth, behavior: "smooth" });
      });
    });

    // Pull to refresh
    const pullIndicator = document.getElementById("pull-indicator");
    let startY = 0, pulling = false;

    container.addEventListener("touchstart", (e) => {
      const panel = panels[Math.round(container.scrollLeft / container.offsetWidth)];
      if (panel && panel.scrollTop === 0) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    });

    container.addEventListener("touchmove", (e) => {
      if (!pulling) return;
      const diff = e.touches[0].clientY - startY;
      if (diff > 60) {
        pullIndicator.classList.add("visible");
      }
    });

    container.addEventListener("touchend", () => {
      if (pullIndicator.classList.contains("visible")) {
        // Refresh current tab
        const idx = Math.round(container.scrollLeft / container.offsetWidth);
        const tabName = tabs[idx]?.dataset.tab;
        if (tabName === "dashboard") loadDashboard();
        else if (tabName === "holdings") loadHoldings();
        else if (tabName === "settings") loadSettings();
        setTimeout(() => pullIndicator.classList.remove("visible"), 1000);
      }
      pulling = false;
    });
  }

})();
