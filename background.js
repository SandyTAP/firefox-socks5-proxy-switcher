const PROXY_URL = "https://raw.githubusercontent.com/databay-labs/free-proxy-list/refs/heads/master/socks5.txt";
const TEST_BASE = "https://httpbin.org/anything/";
const TIMEOUT_MS = 3000;
const BATCH_SIZE = 8;

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
    if (userProxy) {
      setProxy(userProxy);
    }
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
  const save = () => browser.storage.local.set({ activeProxy: proxy });
  const clearStorage = () => browser.storage.local.set({ activeProxy: null });
  if (!proxy) {
    if (!onRequestListener) {
      return browser.proxy.settings.clear({}).then(clearStorage);
    }
    return Promise.resolve(clearStorage());
  }
  if (!onRequestListener) {
    const [host, port] = proxy.split(":");
    return browser.proxy.settings.set({
      value: { proxyType: "socks", socks: { host, port: parseInt(port), version: 5 } }
    }).then(save);
  }
  return Promise.resolve(save());
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "check") {
    checkAllProxies(sendResponse);
    return true;
  }
  if (message.action === "set") {
    setProxy(message.proxy).then(
      () => sendResponse({ status: "ok" }),
      () => sendResponse({ status: "error" })
    );
    return true;
  }
  if (message.action === "clear") {
    setProxy(null).then(
      () => sendResponse({ status: "ok" }),
      () => sendResponse({ status: "error" })
    );
    return true;
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
});