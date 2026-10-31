# Auto Connect — a connection that opens itself on load

## The defect this starts from

A connection card said **"Never connected"** for a radio that was connected five minutes
ago, and for one that was connected *right then*.

That is not a display bug. `lastConnectedAt` is written in exactly one place —
`useConnections.ts::updateStatus`, and only on the `disconnected` branch:

```ts
...(status === "disconnected" ? { lastConnectedAt: Date.now() } : {}),
```

Two things follow, and both are wrong:

1. **It records a disconnect and calls it a connect.** The name of the field, and the
   string the card renders (`lastConnectedAt: "Last connected: {{date}}"`), both promise
   the moment the connection came *up*.
2. **On HTTP it is never written at all.** The only caller that reaches that branch is
   the BLE `gattserverdisconnected` listener. The user-facing `disconnect()` writes the
   status itself —
   `updateSavedConnection(id, { status: "disconnected", error: undefined })` — bypassing
   `updateStatus` entirely. And `onRehydrateStorage` demotes a persisted
   `connecting`/`configuring` to `disconnected` by assigning the field directly. So an
   HTTP connection can be opened, used for an hour and reloaded, and the card has still
   never seen a timestamp.

**The fix is to stamp it when the connection reaches `configured`**, which is the one
moment that is evidence a radio actually answered. `markConfigured` already calls
`updateStatus(id, "configured")`, so the stamp costs one line and no new call site.

## What is being added

A per-connection **Auto Connect** flag. When set, the app opens that connection by itself
on load, instead of waiting to be clicked.

### Why it is worth having

The gateway holds two radios. Reconnecting both by hand after every page reload costs two
clicks and a full handshake each, and the handshake is the expensive part — the node DB
and the message history come down with it. Nothing in the app reconnects on its own today:
`isDefault` sounds as though it might, but it does not. It is read in exactly two places —
`useDefaultConnection()` and `Sidebar.tsx`'s `useActiveConnection() || useDefaultConnection()
|| useFirstSavedConnection()` chain — and it only decides **which saved connection the
sidebar shows** when none is live. It has never opened anything.

So `isDefault` and `autoConnect` are different questions and both are worth keeping:

| flag | question it answers |
|---|---|
| `isDefault` | which connection does the UI point at when none is connected |
| `autoConnect` | which connections should be opened without being asked |

### HTTP only, and why

The menu and the badge appear on HTTP connections only — the same restriction
`isDefault` already carries.

Web Bluetooth and Web Serial hand out a device or port **only in response to a user
gesture**. The fork caches the live handle in `cachedTransports`, a module-level `Map`,
which does not survive a reload. So an automatic BLE reconnect on load would either throw
or raise a chooser nobody asked for. HTTP has no such gate: an address is enough.

## How it persists

**For free, and this is worth stating because it looks as though it should need work.**

`savedConnections` is persisted whole:

```ts
// deviceStore/index.ts
partialize: (s): DevicePersisted => ({ devices: …, savedConnections: s.savedConnections })
```

through zustand's `persist` middleware into IndexedDB under
`meshtastic-device-store`. There is no per-field allow-list anywhere in the path, so a new
optional field on `Connection` is written and read back with no other change — which is
exactly how `isDefault` persists.

`CURRENT_STORE_VERSION` stays at `0`: `autoConnect?: boolean` is optional, an existing
record simply lacks it, and `undefined` already means "off". A migration would have
nothing to do.

## The control is the badge

Upstream puts "Set as default" / "Unset default" in the card's overflow menu, and renders
a **Default** badge beside the title only when the flag is on. That is two places for one
bit, and the badge is dead pixels.

Here both flags are **click-to-toggle badges**, always present, side by side:

```
┌ OMNI  [★ Default] [⚡ Auto] ──────────────┐     both on  — filled
│ HTTP  radio-a.example.net                 │
└───────────────────────────────────────────┘

┌ YAGI  [☆ Default] [⚡ Auto] ──────────────┐     default off — outlined, muted
```

An always-present badge is what makes the toggle work in both directions: a badge that
appears only when the flag is set has no "off" state to click, which is why upstream
needed the menu items. With the badges doing the work, the two `setDefault`/`unsetDefault`
menu items are removed — they were the only thing in that menu besides Delete.

## Files

| file | change |
|---|---|
| `apps/web/src/core/stores/deviceStore/types.ts` | `autoConnect?: boolean` on `Connection` |
| `apps/web/src/core/stores/deviceStore/selectors.ts` | `useAutoConnectConnections()` |
| `apps/web/src/pages/Connections/useConnections.ts` | stamp `lastConnectedAt` on `configured`; `setAutoConnect`; the load-time connect effect |
| `apps/web/src/pages/Connections/index.tsx` | the two toggle badges; the menu items go |
| `apps/web/public/i18n/locales/en/connections.json` | `autoConnect`, `button.*` strings |

## The load-time connect

One effect, in `useConnections`, guarded by a module-level `Set` of ids already attempted:

- it runs **once per connection per page load**, not once per render, and not on a timer;
- it skips anything already `connected`, `configured`, `connecting` or `configuring`,
  because `connect()` is not free — it opens a transport and runs a handshake;
- it does **not** retry a failure. The card already shows the error and a Retry button,
  and a flag that quietly reconnects a radio that is refusing is how a browser ends up
  hammering a gateway that is down.

`connect(id)` is called **without** `allowPrompt`, so nothing can raise a chooser.
