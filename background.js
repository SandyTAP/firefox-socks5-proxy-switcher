const PROXY_URL = "https://raw.githubusercontent.com/databay-labs/free-proxy-list/refs/heads/master/socks5.txt";
const TEST_BASE = "https://httpbin.org/anything/";
const TIMEOUT_MS = 3000;
const BATCH_SIZE = 8;
const AUTO_INTERVAL_MS = 2 * 60 * 1000;

let proxyResults = [];
let proxyResultsDone = false;
let isChecking = false;
let currentProxies = [];
let progressMap = new Map();
let currentTestProxy = null;
let userProxy = null;
let onRequestListener = null;
let testMap = new Map();
let testCounter = 0;
let autoTimer = null;
let autoEnabled = false;
let usedProxies = [];

async function fetchProxyList() {
  const response = await fetch(PROXY_URL);
  const text = await response.text();
  const proxies = [];
  const seen = new Set();
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (l && /^\d+\.\d+\.\d+\.\d+:\d+$/.test(l) && !seen.has(l)) {
      seen.add(l);
      proxies.push(l);
    }
  }
  return proxies;
}

function makeProxyInfo(proxy) {
  if (!proxy) return { type: "direct" };
  const [host, port] = proxy.split(":");
  return { type: "socks", host, port: parseInt(port), failoverTimeout: 3000 };
}

function startProxyListener() {
  if (onRequestListener) return;
  onRequestListener = (requestInfo) => {
    if (requestInfo.url.startsWith(TEST_BASE)) {
      const id = parseInt(requestInfo.url.slice(TEST_BASE.length).split(/[?&]/)[0], 10);
      const p = testMap.get(id);
      if (p) return makeProxyInfo(p);
      return makeProxyInfo(userProxy);
    }
    return makeProxyInfo(userProxy);
  };
  browser.proxy.onRequest.addListener(onRequestListener, { urls: ["<all_urls>"] });
}

function stopProxyListener() {
  if (onRequestListener) {
    browser.proxy.onRequest.removeListener(onRequestListener);
    onRequestListener = null;
  }
  currentTestProxy = null;
  testMap.clear();
}

function testProxy(proxy, id) {
  testMap.set(id, proxy);
  const url = TEST_BASE + id;
  const startTime = Date.now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { cache: "no-store", signal: controller.signal })
    .then(() => {
      clearTimeout(t);
      return { proxy, latency: Date.now() - startTime, success: true };
    })
    .catch(() => {
      clearTimeout(t);
      return { proxy, latency: Infinity, success: false };
    });
}

function checkAllProxies(sendResponse) {
  if (isChecking) return sendResponse({ status: "already_checking" });
  isChecking = true;
  proxyResults = [];
  proxyResultsDone = false;

  fetchProxyList().then(async proxies => {
    if (proxies.length === 0) {
      isChecking = false;
      return sendResponse({ status: "no_proxies" });
    }

    currentProxies = proxies;
    progressMap.clear();
    startProxyListener();
    sendResponse({ status: "started", proxies });

    for (let i = 0; i < proxies.length; i += BATCH_SIZE) {
      const chunk = proxies.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(chunk.map(p => testProxy(p, testCounter++)));
      proxyResults.push(...results);
      results.forEach(r => progressMap.set(r.proxy, r));
      browser.runtime.sendMessage({ action: "progress", results });
    }

    stopProxyListener();
    proxyResults = proxyResults.filter(r => r.success).sort((a, b) => a.latency - b.latency);
    proxyResultsDone = true;
    isChecking = false;
    browser.runtime.sendMessage({ action: "done", results: proxyResults });
  }).catch(() => {
    stopProxyListener();
    isChecking = false;
    proxyResultsDone = true;
    browser.runtime.sendMessage({ action: "done", results: [] });
  });
}

function setProxy(proxy) {
  userProxy = proxy;
  if (!proxy) {
    if (!isChecking) {
      browser.proxy.settings.clear({});
    }
    browser.storage.local.set({ activeProxy: null });
    return;
  }
  if (!isChecking) {
    const [host, port] = proxy.split(":");
    browser.proxy.settings.set({
      value: { proxyType: "socks", socks: { host, port: parseInt(port), version: 5 } }
    });
  }
  browser.storage.local.set({ activeProxy: proxy });
}

function getNextAutoProxy() {
  if (!proxyResults.length) return null;
  const unused = proxyResults.filter(r => !usedProxies.includes(r.proxy));
  const pool = unused.length ? unused : (() => { usedProxies = []; return proxyResults; })();
  const next = pool[0];
  usedProxies.push(next.proxy);
  return next.proxy;
}

function startAuto() {
  if (autoTimer) return;
  usedProxies = [];
  autoTimer = setInterval(() => {
    const next = getNextAutoProxy();
    if (next) {
      setProxy(next);
      browser.runtime.sendMessage({ action: "autoChanged", proxy: next });
    }
  }, AUTO_INTERVAL_MS);
}

function stopAuto() {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
  usedProxies = [];
}

function setAutoEnabled(enabled) {
  autoEnabled = enabled;
  browser.storage.local.set({ autoEnabled: enabled });
  if (enabled) {
    if (!isChecking && proxyResults.length) {
      const next = getNextAutoProxy();
      if (next) setProxy(next);
    }
    startAuto();
  } else {
    stopAuto();
  }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "check") {
    checkAllProxies(sendResponse);
    return true;
  }
  if (message.action === "set") {
    setProxy(message.proxy);
    sendResponse({ status: "ok" });
  }
  if (message.action === "getActive") {
    browser.storage.local.get("activeProxy").then(sendResponse);
    return true;
  }
  if (message.action === "getResults") {
    sendResponse({ results: proxyResults });
  }
  if (message.action === "getState") {
    sendResponse({
      checking: isChecking,
      hasResults: proxyResultsDone,
      results: proxyResults,
      proxies: currentProxies,
      progress: Object.fromEntries(progressMap)
    });
  }
  if (message.action === "clear") {
    setProxy(null);
    sendResponse({ status: "ok" });
  }
  if (message.action === "auto") {
    setAutoEnabled(message.enabled);
    sendResponse({ status: "ok" });
  }
  if (message.action === "getAuto") {
    browser.storage.local.get("autoEnabled").then(sendResponse);
    return true;
  }
});