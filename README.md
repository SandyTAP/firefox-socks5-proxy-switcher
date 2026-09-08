# SOCKS5 Proxy Switcher

Firefox extension that automatically tests SOCKS5 proxies from a free proxy list, displays live latency, selects the fastest one, and can auto-rotate proxies every 2 minutes.

## Features

- **Loads a free SOCKS5 proxy list** from `databay-labs/free-proxy-list`
- **Live testing** — all proxies appear in the list instantly, ping is measured in real time (8 parallel checks via `proxy.onRequest`)
- **Auto-selects the fastest proxy** by lowest latency
- **Auto-rotation** — switch to the next fastest unused proxy every 2 minutes (cycles when all are used)
- **Sort by ping** — toggle ascending/descending
- **Manual override** — click any proxy in the list to use it immediately
- **Testing is isolated** — your browsing traffic is not routed through proxies while they are being checked

## Installation (temporary)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from this folder

## Installation (permanent)

Unsigned extensions cannot be permanently installed in release Firefox. Options:

1. **Via AMO** — submit to <https://addons.mozilla.org> to get a signed `.xpi`
2. **Developer Edition** — set `xpinstall.signatures.required = false` in `about:config`, package the folder into a `.zip`, rename to `.xpi`, and install via `about:addons` (or drag into the window)

## Building an .xpi

```bash
zip -r socks5-proxy-switcher.xpi manifest.json background.js popup.html popup.css popup.js icon.svg
```

## Usage

1. Click the toolbar icon
2. The proxy list loads and testing starts automatically
3. The fastest working proxy is set for the whole browser
4. Optionally enable **"Менять прокси каждые 2 минуты"** to auto-rotate

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (MV2) |
| `background.js` | Proxy list fetching, parallel latency tests, proxy routing |
| `popup.html/js/css` | Popup UI |

## Permissions

- `proxy` — set the browser SOCKS proxy and route test requests
- `storage` — remember the active proxy and auto-rotation state
- `<all_urls>` — needed to reach proxy test endpoints

## Disclaimer

Free proxies are unreliable and may be slow, dead, or insecure. Only use this tool with proxies you trust. The author is not responsible for what you do while using it.

## License

MIT