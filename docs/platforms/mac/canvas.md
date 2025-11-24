---
summary: "Agent-controlled Canvas panel embedded via WKWebView + custom URL scheme"
read_when:
  - Implementing the macOS Canvas panel
  - Adding agent controls for visual workspace
  - Debugging WKWebView canvas loads
title: "Canvas"
---

# Canvas (macOS app)

The macOS app embeds an agent‑controlled **Canvas panel** using `WKWebView`. It
is a lightweight visual workspace for HTML/CSS/JS, and small interactive
UI surfaces.

## Where Canvas lives

Canvas state is stored under Application Support:

- `~/Library/Application Support/GenosOS/canvas/<session>/...`

The Canvas panel serves those files via a **custom URL scheme**:

- `genosos-canvas://<session>/<path>`

Examples:

- `genosos-canvas://main/` → `<canvasRoot>/main/index.html`
- `genosos-canvas://main/assets/app.css` → `<canvasRoot>/main/assets/app.css`
- `genosos-canvas://main/widgets/todo/` → `<canvasRoot>/main/widgets/todo/index.html`

If no `index.html` exists at the root, the app shows a **built‑in scaffold page**.

## Panel behavior

- Borderless, resizable panel anchored near the menu bar (or mouse cursor).
- Remembers size/position per session.
- Auto‑reloads when local canvas files change.
- Only one Canvas panel is visible at a time (session is switched as needed).

Canvas can be disabled from Settings → **Allow Canvas**. When disabled, canvas
node commands return `CANVAS_DISABLED`.

## Agent API surface

Canvas is exposed via the **Gateway WebSocket**, so the agent can:

- show/hide the panel
- navigate to a path or URL
- evaluate JavaScript
- capture a snapshot image

CLI examples:

```bash
genosos nodes canvas present --node <id>
genosos nodes canvas navigate --node <id> --url "/"
genosos nodes canvas eval --node <id> --js "document.title"
genosos nodes canvas snapshot --node <id>
```

Notes:

- `canvas.navigate` accepts **local canvas paths**, `http(s)` URLs, and `file://` URLs.
- If you pass `"/"`, the Canvas shows the local scaffold or `index.html`.

## Triggering agent runs from Canvas

Canvas can trigger new agent runs via deep links:

- `genosos://agent?...`

Example (in JS):

```js
window.location.href = "genosos://agent?message=Review%20this%20design";
```

The app prompts for confirmation unless a valid key is provided.

## Security notes

- Canvas scheme blocks directory traversal; files must live under the session root.
- Local Canvas content uses a custom scheme (no loopback server required).
- External `http(s)` URLs are allowed only when explicitly navigated.
