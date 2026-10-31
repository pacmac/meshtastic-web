# Absorbing the gateway dashboard: BLE scan, pair and firmware

Peter, 2026-10-31:

> most likely the mesh-gw dashboard will be deprecated with certain things such as the
> ability to scan for BLE devices and pair them and update firmware added to this new
> dashboard using the same style and ui framework as the original.

and, after the bootstrap problem below was put to him, the same day:

> maybe that part has to stay on mesh-gw but be tidied up.

This note is the design surface for that. It is a **spec, not a plan of work** — nothing in
it has been built. Every number and route in it was read off the running gateway or its
source on 2026-10-31; where something is unverified it says so.

> ## THE LEADING OPTION IS NOW: MANAGEMENT STAYS ON mesh-gw
>
> **Not decided — Peter said "maybe" — but it is the leading option and it has one
> argument that the other does not survive.** See THE BOOTSTRAP PROBLEM below; in short,
> **you cannot sanely flash a radio from a UI whose transport runs through that radio.**
>
> Under this option the split is by SCOPE, not by convenience:
>
> | scope | lives | why |
> |---|---|---|
> | the gateway and its adapter — BLE scan, pair, adopt/drop, firmware files, flashing | **mesh-gw** | none of it has a radio to connect through, and flashing destroys its own transport |
> | a radio and the mesh — nodes, messages, map, traceroute, config, position | **this app** | it is already the Meshtastic client for exactly these |
>
> And the feed defect changes shape with it: **most of the 1.35 MB is the pages that
> leave.** See WHAT THE TIDY-UP DOES TO THE BYTES.
>
> The rest of this note — the routes, the traps, the decisions — is written for the
> absorb-into-this-app option. **Read it as the alternative, and as the inventory of what
> the gateway surface actually is**, which is needed either way.

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

## IT IS ALREADY IN CORE — which is why this is a UI decision and not an architecture one

Peter: *"but that is already part of core isn't it?"* **Yes, with one exception.** Checked
in `mesh-gw` on 2026-10-31:

| capability | where the logic lives | route is thin? |
|---|---|---|
| OTA / flashing | `core/ota_session.py`; `POST /ota` calls `flash_preflight(dev, fw_name, ota_cfg=…)` and `probe_ble_visibility(…)` | **yes** |
| pairing | `core/ble_agent.py` (`_PairingAgent`, `stored_pin`, `pin_is_verified`, `setup_pairing_agent`); the route goes through `dm.get_by_ble(…)` | **yes** |
| the BLE session | `core/ble_device.py`, `core/ble_health.py` | **yes** |
| devices | `module/device_manager.py` (`dm`) | **yes** |
| **BLE scan** | **`module/server.py::_ble_scan` at :2024 — calls `BleakScanner.discover` directly, and filters and logs inline** | **no — it IS the logic** |

So the dashboard really is presentation over a core that already decides everything, which
is the standing rule working as intended: *"the UI is a presentation layer only. it does not
make decisions."* **Moving or tidying the UI moves no capability.** That is what makes
"stays on mesh-gw but tidied up" cheap, and it is also what would have made the other option
cheap — the choice is genuinely about where a human looks, not about where logic lives.

**The exception is the one to fix either way.** `_ble_scan` is a decision sitting in a route
file: a ten-second seizure of the shared adapter, a 503 contention rule, and the discard of
non-Meshtastic devices that makes "no radios advertising" and "your Bluetooth is dead" look
identical. Any second viewer of that capability must either duplicate the filter or go
through HTTP to reach it. Lifting it into `core/` — input: a timeout; output: discovered
count, Meshtastic count, the list — makes it testable without an HTTP server and movable by
copying one file and its check, which is the `build it modular` rule.

---

## THE BOOTSTRAP PROBLEM — the reason the leading option is what it is

Management is **gateway-scoped**. This app models **radios**. Four consequences, each
verified in the source:

1. **This app is gated on already having a radio.** `apps/web/src/App.tsx:62` renders the
   entire application only when `getDevice(selectedDeviceId)` is truthy; otherwise it
   renders `<Connections />` and nothing else. Management inside that gate means **you can
   never add your first radio and never recover your last one**.
2. **Flashing destroys its own transport.** Flash OMNI through `uk-omni.peter-c.net` and the
   radio reboots — the `/api/v1` queue goes with it, and from the UI that is
   indistinguishable from a failure. This matters more than usual given the standing rule
   never to interrupt a live OTA: a progress bar that goes red mid-flash *invites* a retry.
   **This is the argument the absorb option does not survive.**
3. **Two BLE scanners that see different radios.** This app already has one —
   `core/connections/transports.ts:100`, `navigator.bluetooth.requestDevice`, user gesture,
   native chooser, sees what is near the *browser*. The gateway has another — `POST
   /ble/scan`, the Pi's adapter, sees what is near the *mast*. The radios are on a 3 m roof
   mast. One button called "scan for BLE devices" would be a lie about which of the two it
   means.
4. **The hostnames assume a radio.** `uk-omni` / `uk-yagi` exist because `TransportHTTP`
   takes an address with no path, so mesh-gw picks the radio from `Host`. A gateway verb has
   no radio and would need its own name.

Keeping management on mesh-gw dissolves all four: its dashboard never had a radio
prerequisite, never runs its transport through the radio it is flashing, has exactly one
adapter, and already lives at the gateway's own address.

---

## WHAT THE TIDY-UP DOES TO THE BYTES

If the split is by scope, **most of the 1.35 MB is in the pages that leave.** Against the
measured frame:

| page | bytes | share | under the split |
|---|---|---|---|
| `messages` | 474,326 | 35% | **goes** — this app is the messaging client |
| `radios:<addr>` ×2 | 645,046 | 48% | **mostly goes.** 265,669 B of one is a chart series (1,349 points thinned from 5,394 samples); history is node-dash's, config is this app's |
| `traceroute` | 135,601 | 10% | **goes** — this app has traceroute |
| config schema | 80,900 | 6% | **goes** — this app has the settings pages |
| BLE, firmware | the remainder | — | **stays** |

So the honest close for the register entry
`the-dashboard-pushes-the-entire-ui-to-every-browser-every-two-seconds` may be **"the
payload left"** rather than a per-subscriber mechanism — the defect was ~74% historical
data, and history is exactly what moves out. **That has to be re-measured after the split,
not assumed**: the entry closes on a number or it does not close.

Keep `on_request` regardless. It is already landed, it costs nothing, and a two-page
dashboard that answers "which page are you on" is still better than one that does not.

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
   equivalent in this client at all. **Under the stays-on-mesh-gw option this becomes the
   main question**, because it is the split line: everything that is not gateway-scoped has
   to land somewhere, and `aim`, `pki`, `packets` and `storeward` have no home in a
   Meshtastic client.

6. **Does `_ble_scan` get lifted into core?** Independent of where the UI lives. It is the
   one piece of this capability that is not in core, and it is the one with a contention
   rule and a silent-discard behaviour worth testing without an HTTP server.

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
