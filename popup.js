const checkBtn = document.getElementById("checkBtn");
const clearBtn = document.getElementById("clearBtn");
const sortBtn = document.getElementById("sortBtn");
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
  if (!item || item.classList.contains("disabled")) return;
  const proxy = item.dataset.proxy;
  setStatus(`Применяю ${proxy}...`);
  browser.runtime.sendMessage({ action: "set", proxy }, (response) => {
    if (response && response.status === "ok") {
      setStatus("Прокси применен");
      loadActiveProxy();
    } else {
      setStatus(response && response.reason ? response.reason : "Не удалось применить прокси", true);
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
  proxyList.textContent = "";
  for (const r of sorted) {
    const item = document.createElement("div");
    item.className = "proxy-item" + (r.success ? "" : " disabled");
    item.dataset.proxy = r.proxy;

    const ip = document.createElement("span");
    ip.className = "ip";
    ip.textContent = r.proxy;

    const lat = document.createElement("span");
    lat.className = "latency";
    if (r.success) {
      lat.classList.add(getLatencyClass(r.latency));
      lat.textContent = `${r.latency}ms`;
    } else if (r.done) {
      lat.classList.add("dead");
      lat.textContent = "✕";
    } else {
      lat.classList.add("pending");
      lat.textContent = "...";
    }

    item.appendChild(ip);
    item.appendChild(lat);
    proxyList.appendChild(item);
  }
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

browser.runtime.onMessage.addListener((message) => {
  if (message.action === "progress") {
    message.results.forEach(updateProxyResult);
    renderView();
  }
  if (message.action === "done") {
    checkBtn.disabled = false;
    setStatus(`Найдено ${message.results.length} рабочих прокси`);
    renderResults(message.results);
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
  browser.runtime.sendMessage({ action: "clear" }, (response) => {
    activeProxyEl.style.display = "none";
    if (response && response.status === "ok") {
      setStatus("Прокси отключен");
    } else {
      setStatus("Не удалось отключить прокси", true);
    }
  });
});

loadActiveProxy();
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