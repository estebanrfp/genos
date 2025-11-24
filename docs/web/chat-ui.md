# Chat UI

The GenosOS control UI chat panel provides a minimalist, keyboard-first interface for interacting with the gateway agent directly from the browser.

## Session Tabs

Sessions are displayed as a horizontal tab bar at the top of the chat panel.

| Action                  | How                                                |
| ----------------------- | -------------------------------------------------- |
| Switch session          | Click a tab                                        |
| Rename session          | Double-click a tab                                 |
| Close session           | Hover the tab → click `×` (non-main sessions only) |
| New session             | Click `+` in the right controls                    |
| Scroll through sessions | Trackpad swipe or mouse wheel over the tab bar     |

The **main session** (configured as `defaultSessionKey` in the gateway) is always the leftmost tab and cannot be closed. All other sessions appear in the order the gateway reports them. When there are many sessions the bar scrolls horizontally — no overflow dropdown.

Switching tabs preserves the current session. The agent continues running in background sessions; messages queue and stream independently per session.

## Right Controls

The controls to the right of the tab bar, from left to right:

| Control             | Description                                                                           |
| ------------------- | ------------------------------------------------------------------------------------- |
| `+`                 | Create a new session (UUID-based, prefixed with the current agent ID)                 |
| Model selector      | Pick the active LLM for the current session; persists per session in `localStorage`   |
| Compact (⊞)         | Trigger `/compact` on the active session; turns amber when context exceeds 80k tokens |
| Refresh (↺)         | Reload chat history for the active session                                            |
| `—` separator       | Visual divider                                                                        |
| Thinking toggle (☁) | Show/hide assistant reasoning blocks                                                  |
| Focus toggle (⤢)    | Enter focus mode — collapses the sidebar and header for a distraction-free view       |

### Default Model

New sessions default to **Claude Sonnet 4.6** (`claude-sonnet-4-6`). The preference is written to `localStorage` immediately on session creation so the gateway's welcome-message response (which reports the configured default model) does not override it.

The fallback chain for model resolution:

1. `localStorage` key `genosos.chat.modelOverride.<sessionKey>` — explicit user or default selection
2. Session data returned by the gateway (`modelProvider` + `model` fields)
3. `claude-sonnet-4-6` if available in the model catalog
4. First model in the catalog

## Composing Messages

```
↵              Send message
Shift+↵        Insert line break
Paste image    Attach image (PNG, JPEG, WebP, GIF)
```

There are no Send/Stop/Queue buttons — the textarea is the only compose element. Queued messages (sent while the agent is busy) appear in the queue panel above the textarea and can be removed individually with `×`.

## Queue Panel

When a message is sent while the agent is processing a previous request, it enters the queue. The queue panel shows all pending messages with individual remove buttons. There is no global "interrupt all" — manage items one by one.

## Focus Mode

Click the focus toggle (⤢) or press the keyboard shortcut to collapse the navigation sidebar and hide the content header. The chat thread and compose area fill the full viewport. Click `✕` in the top-right corner of the chat card to exit focus mode.

## Layout Architecture

```
.shell (grid: nav | content)
└── .content.content--chat (flex column, padding: 0)
    ├── .content-header (tabs row, padding: 1rem, border-bottom)
    │   └── .page-meta → .chat-controls
    │       ├── .session-tabs (flex: 1 1 0, overflow-x: auto)
    │       │   └── .session-tabs__list (flex-wrap: nowrap)
    │       └── .chat-controls__right (flex-shrink: 0)
    └── .card.chat (flex: 1, overflow: hidden)
        ├── .chat-thread (scrollable message log)
        ├── .chat-queue (conditional)
        └── .chat-compose (textarea only)
```
