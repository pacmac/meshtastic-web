# Absorbing the gateway dashboard: BLE scan, pair and firmware

Peter, 2026-10-31:

> most likely the mesh-gw dashboard will be deprecated with certain things such as the
> ability to scan for BLE devices and pair them and update firmware added to this new
> dashboard using the same style and ui framework as the original.

This note is the design surface for that. It is a **spec, not a plan of work** — nothing in
it has been built. Every number and route in it was read off the running gateway or its
source on 2026-10-31; where something is unverified it says so.

---

## The question that prompted it

> *"do you still recall what the problem was with the ws feeds and the fact that every page
> receives all the data instead of being on demand?"*

Yes, and it matters here because **the thing being deprecated has a defect that this app
must not inherit.**

### The defect, measured

`mesh-gw/plugins/dashboard/__init__.py::_push_loop` publishes a snapshot of **every page**
every 2.0 s to **every** connected browser, whether anything changed or not. Its docstring
justified that with two claims and both were false:

> *"The host's feed is SEND-ONLY — it never reads from the client — so a browser cannot ask
> for a page, and sending all of them costs a few kB."*

- **It was never send-only.** `module/server.py::_feed_wait` has always awaited
  `websocket.receive()` — it must, to notice a disconnect — then discarded the message with
  the comment *"Chatter on a one-way feed"*. The request channel was open, awaited, and
  ignored.
- **It is not a few kB.** One live frame is **1,351,064 B** — about **340×** the claim.

| page | bytes | share | what it is |
|---|---|---|---|
| `messages` | 474,326 | 35% | commands 207 kB, conversations 172 kB, candidates 92 kB |
| `radios:<addr>` | 322,896 | 24% | **265,669 B is one chart series** — 1,349 points thinned from 5,394 samples |
| `radios:<addr>` | 322,150 | 24% | the second radio |
| `traceroute` | 135,601 | 10% | |
| config schema | 80,900 | **6%** | 754 field descriptors |

**About 74% of it is historical data nobody is looking at.** An earlier pass measured
1,239,252 B on the wire and 3,823,420 B parsed in memory, ≈590 kB/s per viewer; same defect,
measured twice.

**The config schema that everyone blamed is 6%.** A previous session told Peter it dominated,
which was wrong — it came from reading across from an *allocation-sites* count to *bytes*.
Peter's objection, that the dashboard is simple, was the correct one. Recording that here
because the wrong number is the one that gets repeated.

### The real name of the defect

It is **not** "broadcast is bad". mesh-gw has two WebSocket surfaces and only one is at
fault:

| surface | what it carries | verdict |
|---|---|---|
| `/events` (`module/server.py:2256`) | `hello`, `device_snapshot` on connect, then `device_state` / `device_data` per device as things change, plus `ota_download_start\|progress\|complete\|error` | **fine.** Event-shaped, change-driven, small. This is what node-dash's backend already consumes |
| `/plugins/{name}/{feed}` (`:2868`), e.g. `/plugins/dashboard/live` | 13 whole pages re-serialised on a 2 s timer | **the defect** |

So the fault is *re-serialising all historical state on a timer*, not fan-out. A broadcast of
small change events is a different thing from a broadcast of every page's full history.

### What has been fixed, and what has not

**Fixed (mesh-gw `701e939`) — the mechanism only.** `plugins/dashboard::on_request` answers
`{"want":"<page id>"}` with the shell plus that one page body, sent **straight down that one
socket**, not through `ctx.publish()` which fans out and cannot address a single subscriber.
`{"want":"all_ids"}` asks for the whole set. Measured in a real browser: **24,049 B for one
page against a 310,864 B broadcast — 8%.**

**Not fixed, deliberately.** `_push_loop` still sends every page, so an already-open browser
does not go blank on deploy. **No bytes are saved yet.** Narrowing it needs per-subscriber
state — which page each queue's owner is watching — because `publish()` is broadcast-only.
The register entry
`the-dashboard-pushes-the-entire-ui-to-every-browser-every-two-seconds` is GUILTY 1 of 1 and
still open.

**If the dashboard is being retired, that entry may be closed by deletion rather than by a
fix.** That is a decision, not an assumption — see DECISIONS below.

---

## What this app would have to grow

The good news: **the gateway surface already exists.** This is UI work, not gateway work.
Read off `mesh-gw/module/server.py` on 2026-10-31:

| capability | route | notes |
|---|---|---|
| scan for radios | `POST /ble/scan` (preferred), `GET /ble/scan` (kept for existing callers) | **seizes the shared adapter for ~10 s** and can return **503** when the hardware is busy. That contention is why POST is the right verb — a GET that mutates who holds the radio was mis-verbed from the start |
| pair | `POST /ble/{address}/pair` | |
| list what the gateway holds | `GET /devices` | returns `{"devices": [...]}`, **not** a bare list. Each entry carries `node_id`, `install.alias`, `addr`, `state` |
| adopt / drop a radio | `POST /devices`, `POST /devices/{addr}/connect`, `DELETE /devices/{addr}` | |
| firmware on disk | `GET /ota/firmware?node_id=…` | keyed by the device's `hw_model`; returns `{"files": [], "hw_model": null, "error": "hw_model not available yet"}` while a device is still syncing |
| upstream releases | `GET /ota/releases` | proxies the last 15 GitHub releases, cached |
| get firmware onto the gateway | `POST /ota/firmware/upload` (multipart), `POST /ota/firmware/download` (`node_id`, `url`, `filename`) | |
| delete firmware | `DELETE /ota/firmware` | |
| flash | `POST /ota` (`ble_addr` or `ble_address`, `firmware`, optional `node_id`) | |
| progress | **no route.** Events on `/events`: `ota_download_start`, `ota_download_progress` (`{pct, done, total}`), `ota_download_complete`, `ota_download_error` | the flash itself reports through the device event stream too |

**A scan's own failure mode is worth designing for.** `_ble_scan` discards every
non-Meshtastic device, so `found` can hold twenty radios, phones and watches while the
result comes back empty — and from outside, "your radios are not advertising the Meshtastic
service" and "your Bluetooth is not working" look identical. The gateway now logs both
counts. **The UI should show both**, or it recreates the ambiguity that had Peter reporting
*"I see no evidence that BLE scan works, nothing in the logs"*.

---

## Three things that will bite, in order

### 1. The vhost proxies only `/api/v1/` — everything above would return the SPA with a 200

`nginx/mesh.conf` has exactly two upstream locations: `/api/v1/` and
`= /hotspot-detect.html`, both to `:8001`. **`location /` goes to the static server on
`:8089`**, and that server does an `index.html` fallback for any unknown path, because `dist`
is path-routed.

So a fetch to `/ble/scan` or `/ota` through `uk-omni.peter-c.net` returns **the client's own
HTML with HTTP 200**. Not a 404 — a 200 with the wrong body, which `response.json()` turns
into a parse error that names nothing.

**This exact shape has already cost a peer real work.** node-dash has an open item against
mesh-gw: *"GET /device-config/{mac} now returns your SPA HTML with a 200, and our BLE pairing
PIN came from it"*. Do not rediscover it.

The fix is a vhost change — and `nginx/mesh.conf` is **gitignored** and lives only on this
disk and on `nginx.ellis`, so it is also the least discoverable file in the system. See
`HANDOVER.md`.

**Open question, for Peter:** should the gateway's management routes be reachable from the
radio hostnames at all? `uk-omni` / `uk-yagi` currently mean "this radio", and `Host` is what
mesh-gw uses to pick one. Scan, pair and firmware are gateway-level, not radio-level, so a
third name (`mesh-gw.peter-c.net`, say) may be the honest mapping rather than bolting
gateway verbs onto a radio's name.

### 2. The no-GET-polling rule and this app's transport are in direct conflict

Peter's rule for the gateway dashboard, quoted in `mesh-gw/module/server.py` and enforced by
`mesh-gw/tests/test_tremor.py`, which requires every non-nav fetch to be a POST:

> *"the ONLY thing allowed to GET is the raw HTML and the nav menus, all content must be SSE
> or WS and there must be no GET polling for any data whatsoever"*

**This app's entire transport is a GET poll.** `TransportHTTP` works by repeatedly calling
`GET /api/v1/fromradio`, and that is the Meshtastic device HTTP API as specified — not a
choice this fork made, and not something it can opt out of while remaining the Meshtastic web
client.

So the rule cannot simply carry across, and pretending otherwise would either break the
client or produce a test nobody can satisfy. **This needs Peter's ruling, not a guess.** The
distinction that probably matters: his rule was aimed at *a dashboard re-fetching content it
could have been pushed*, and `/api/v1/fromradio` is a **destructive queue drain**, not a
poll for a value — each GET removes what it returns, so it is closer to a read of a stream
than to polling. Whether that satisfies the spirit of the rule is his call.

### 3. Do not build a new page feed

If OTA progress or scan results arrive over a new WebSocket, the temptation is a feed that
publishes everything to everyone — which is precisely how the 1.35 MB frame happened, from a
docstring that was confidently wrong in both halves.

**Consume `/events`.** It already carries `device_state`, `device_data` and the four
`ota_download_*` events, it is change-driven rather than timed, and node-dash's backend has
been reading it for months. Nothing new needs inventing on the gateway for progress.

**If a feed is ever added for this app, it must be per-subscriber from the first commit.**
`publish()` is broadcast-only; the ability to answer one socket exists in
`module/server.py::_feed_reply` and is reached by a plugin exposing `on_request`.

---

## Style and framework

Peter's words: *"the same style and ui framework as the original"* — meaning **this app's**
idiom, not the gateway dashboard's. The gateway dashboard is its own JSX app (`App.jsx`,
`useLive.js`) served by the plugin host; none of it transfers.

So the new pages are ordinary pages of this client: its routes, its `Table`, its `Badge`,
its dialogs, Tailwind with the existing tokens, and `data-theme` light/dark — **both themes
verified in a real browser, which is the project rule.**

**A caution carried over from a peer, because it is the same mistake twice.** node-dash's
left-nav panel collapses `OFFLINE`, `SYNCING`, `CONNECTING`, `NEED_PAIR` and *deliberately
switched off* into one amber. mesh-gw refused to copy that, on the grounds that *"a panel
that paints 'needs a ladder' and 'I turned it off' the same amber"* is a lie about four
states. **This app's own `ConnectedDevices.tsx::statusDot()` does the same thing today** —
green for `connected|configured`, yellow for `configuring|connecting`, red for everything
else. A BLE management page that shows `NEED_PAIR` as "red, broken" rather than "needs your
action" repeats it for a third time.

---

## DECISIONS — Peter's, before anything is built

1. **Does the no-GET-polling rule bind this app?** It cannot bind `/api/v1/fromradio`. Does
   it bind the *new* management calls — i.e. must a scan result arrive over `/events` rather
   than as the `POST /ble/scan` response body, even though that response is the natural place
   for it?
2. **Which hostname serves gateway-level verbs?** A third name, or extra locations on the
   radio vhosts?
3. **Do the management pages ship upstream or stay fork-only?** They are mesh-gw-specific, so
   almost certainly fork-only — which makes them the second branch after
   `framed-batch-fetch` with an ongoing rebase cost, and the first one that is large.
4. **Is the dashboard's broadcast narrowed, or retired with the dashboard?** The register
   entry is open and GUILTY. If the dashboard goes, the honest close is "withdrawn, the code
   is gone" rather than a fix nobody will run — but that is a withdrawal, which needs stating
   out loud, not a silent deletion.
5. **What happens to the eleven other dashboard pages?** This note covers the three Peter
   named. `messages`, `traceroute`, `config`, `nodes`, `position`, `pki`, `aim`, `packets`,
   `storeward` and the per-radio pages are not accounted for anywhere, and some have no
   equivalent in this client at all.

---

## What is NOT in scope here, and must not be quietly absorbed

mesh-gw decides things. This app displays them. The standing rule is *"the UI is a
presentation layer only. it does not make decisions"*, and the related one, *"a decision in
core is the feature"*.

So: which radio would transmit, whether a channel is public or private, whether a write was
verified, which rotator steers — all of that stays in the gateway and is read from it. A
management page that computes its own answer becomes a second source of truth, and the
gateway already carries scars from exactly that (`"you hold a third copy"` of the rotator
logic, raised against node-dash and still open).

Likewise: **a defect found in mesh-gw while building this is raised on the xsession channel,
not worked around here.** A workaround makes the gateway's defect permanent and invisible.
