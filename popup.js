const checkBtn = document.getElementById("checkBtn");
const clearBtn = document.getElementById("clearBtn");
const sortBtn = document.getElementById("sortBtn");
const autoBtn = document.getElementById("autoBtn");
const autoStatusEl = document.getElementById("autoStatus");
const statusEl = document.getElementById("status");
const activeProxyEl = document.getElementById("activeProxy");
const activeProxyText = document.getElementById("activeProxyText");
const resultsEl = document.getElementById("results");
const countEl = document.getElementById("count");
const proxyList = document.getElementById("proxyList");

let viewList = [];
let sortAsc = true;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.className = "status" + (isError ? " error" : "");
}

function getLatencyClass(latency) {
  if (latency < 500) return "fast";
  if (latency < 1500) return "medium";
  return "slow";
}

proxyList.addEventListener("click", (e) => {
  const item = e.target.closest(".proxy-item");
  if (!item) return;
  const proxy = item.dataset.proxy;
  setStatus(`Применяю ${proxy}...`);
  browser.runtime.sendMessage({ action: "set", proxy, manual: true }, (response) => {
    if (response && response.status === "ok") {
      setStatus("Прокси применен");
      loadActiveProxy();
    } else {
      setStatus("Не удалось применить прокси", true);
    }
  });
});

function renderView() {
  if (!viewList.length) {
    resultsEl.style.display = "none";
    return;
  }
  const sorted = [...viewList];
  sorted.sort((a, b) => {
    const rank = e => e.success ? 0 : (e.done ? 2 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.success && b.success) return sortAsc ? a.latency - b.latency : b.latency - a.latency;
    return 0;
  });
  countEl.textContent = sorted.length;
  resultsEl.style.display = "block";
  sortBtn.textContent = sortAsc ? "↑ пинг" : "↓ пинг";
  proxyList.innerHTML = sorted.map(r => {
    let latHtml;
    if (r.success) {
      latHtml = `<span class="latency ${getLatencyClass(r.latency)}">${r.latency}ms</span>`;
    } else if (r.done) {
      latHtml = `<span class="latency dead">✕</span>`;
    } else {
      latHtml = `<span class="latency pending">...</span>`;
    }
    return `
      <div class="proxy-item" data-proxy="${r.proxy}">
        <span class="ip">${r.proxy}</span>
        ${latHtml}
      </div>
    `;
  }).join("");
  loadActiveProxy();
}

function renderAllList(proxies) {
  viewList = proxies.map(p => ({ proxy: p, success: false, done: false, latency: Infinity }));
  renderView();
}

function updateProxyResult(result) {
  const entry = viewList.find(e => e.proxy === result.proxy);
  if (entry) {
    entry.success = result.success;
    entry.done = true;
    entry.latency = result.latency;
  } else {
    viewList.push({ proxy: result.proxy, success: result.success, done: true, latency: result.latency });
  }
}

function renderResults(results) {
  viewList = (results || []).map(r => ({ proxy: r.proxy, success: true, done: true, latency: r.latency }));
  renderView();
}

function loadActiveProxy() {
  browser.runtime.sendMessage({ action: "getActive" }, (response) => {
    if (response && response.activeProxy) {
      activeProxyEl.style.display = "flex";
      activeProxyText.textContent = response.activeProxy;
      document.querySelectorAll(".proxy-item").forEach(item => {
        item.classList.toggle("active", item.dataset.proxy === response.activeProxy);
      });
    } else {
      activeProxyEl.style.display = "none";
    }
  });
}

function loadAutoState() {
  browser.runtime.sendMessage({ action: "getAuto" }, (response) => {
    if (response && response.autoEnabled) {
      autoBtn.checked = true;
      autoStatusEl.textContent = "вкл";
      autoStatusEl.classList.add("on");
    }
  });
}

browser.runtime.onMessage.addListener((message) => {
  if (message.action === "progress") {
    message.results.forEach(updateProxyResult);
    renderView();
  }
  if (message.action === "done") {
    checkBtn.disabled = false;
    setStatus(`Найдено ${message.results.length} рабочих прокси`);
    if (autoBtn.checked) {
      browser.runtime.sendMessage({ action: "auto", enabled: true });
    }
    renderResults(message.results);
    loadActiveProxy();
  }
  if (message.action === "autoChanged") {
    loadActiveProxy();
  }
});

checkBtn.addEventListener("click", () => {
  checkBtn.disabled = true;
  setStatus("Загрузка списка прокси...");

  browser.runtime.sendMessage({ action: "check" }, (response) => {
    if (!response) {
      checkBtn.disabled = false;
      setStatus("Ошибка соединения", true);
      return;
    }
    if (response.status === "no_proxies") {
      checkBtn.disabled = false;
      setStatus("Прокси не найдены", true);
      return;
    }
    if (response.status === "started") {
      renderAllList(response.proxies);
      setStatus(`Проверяю ${response.proxies.length} прокси...`);
    }
  });
});

sortBtn.addEventListener("click", () => {
  sortAsc = !sortAsc;
  renderView();
});

clearBtn.addEventListener("click", () => {
  browser.runtime.sendMessage({ action: "clear" }, () => {
    activeProxyEl.style.display = "none";
    setStatus("Прокси отключен");
  });
});

autoBtn.addEventListener("change", () => {
  const enabled = autoBtn.checked;
  autoStatusEl.textContent = enabled ? "вкл" : "выкл";
  autoStatusEl.classList.toggle("on", enabled);
  browser.runtime.sendMessage({ action: "auto", enabled });
});

loadActiveProxy();
loadAutoState();
browser.runtime.sendMessage({ action: "getState" }, (response) => {
  if (!response) return;
  if (response.checking) {
    checkBtn.disabled = true;
    if (response.proxies && response.proxies.length) {
      renderAllList(response.proxies);
      Object.values(response.progress).forEach(updateProxyResult);
      setStatus("Проверка прокси...");
    } else {
      setStatus("Проверка уже идет...");
    }
  } else if (response.hasResults) {
    renderResults(response.results);
    setStatus(`Найдено ${response.results.length} рабочих прокси`);
  } else {
    checkBtn.click();
  }
});