# This is a fork of `meshtastic/web`

`pacmac/meshtastic-web`. It exists to talk to **mesh-gw**, a BLE-to-Meshtastic gateway that
serves the device HTTP API on behalf of radios that have no WiFi of their own.

`FORK.md` is the only file here that upstream does not have, which is why it is safe: it
can never conflict on a rebase.

## Branches, and the one rule

```
main                        a MIRROR of upstream. NEVER COMMIT TO IT.
├── multi-connection-sidebar     one change
├── root-renders-connections     one change
├── framed-batch-fetch           one change
├── fork-notes                   this file
└── deploy                       the four merged — THIS IS WHAT IS SERVED
```

**The rule is `main`.** The moment anything is committed to `main`, it stops being a
mirror, rebasing stops being clean, and the fork becomes a permanently divergent tree that
has to be merged by hand forever. Everything goes on a branch cut from `origin/main`.

**No pull requests between these branches.** There is one committer, no reviewer and no CI
gate, so a PR here is a click that tells nobody anything. PRs are for sending a change
*upstream*, which is a separate decision per branch.

## What each branch is, and whether it can go upstream

| branch | what | upstream? |
|---|---|---|
| `multi-connection-sidebar` | every live connection listed in the sidebar, not just the active one. The app was already multi-connection everywhere except the component that displayed it | **yes** — addresses their open issue #724 |
| `root-renders-connections` | `/` renders the Connections page instead of redirecting past it, plus the five navigation sites that depended on that redirect | **yes** — the index route declared a component it could never reach |
| `framed-batch-fetch` | a whole handshake in one response instead of one round trip per frame | **no** — needs a `framed=1` parameter only mesh-gw serves |
| `fork-notes` | this file | no |

`framed-batch-fetch` is the only branch with an ongoing cost, and it is one file.

## Why `framed-batch-fetch` cannot go upstream as it stands

`GET /api/v1/fromradio` returns one `FromRadio` per request, so a handshake costs one
round trip per frame — measured against a live gateway, **139 frames and 142 round
trips**. On the same machine that is about six seconds; from a browser 200 ms away it is
minutes, on every page reload, for every radio.

`all=true` is in the device HTTP API spec and cannot fix it. The body is bare concatenated
protobufs; protobuf is not self-delimiting; and `decodePacket` parses exactly one
`FromRadio` per chunk. A concatenation therefore MERGES into one message and, the payload
being a `oneof`, only the last frame survives. That is consistent with
`receiveBatchRequests` being hardcoded `false` with no setter — batching appears never to
have worked.

So a batch has to carry lengths. This branch asks for StreamAPI framing
(`0x94 0xc3 <len hi> <len lo> <payload>`) — the same framing the project already uses on
serial, BLE and TCP — and splits the body before enqueuing. **142 round trips became 3**;
in a real browser, 174 requests became 13.

It is safe against a device that has never heard of it: a response that is not framed
switches the mode off permanently, so the cost of trying is one response.

Making this upstreamable means getting the framing into the firmware's HTTP handler, which
is a conversation with them, not a patch here.

## Keeping up with upstream

```bash
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main

for b in multi-connection-sidebar root-renders-connections framed-batch-fetch fork-notes; do
  git checkout "$b" && git rebase upstream/main && git push --force-with-lease origin "$b"
done

# deploy is REBUILT, not merged into: it stays exactly "upstream + our changes"
git checkout deploy
git reset --hard upstream/main
git merge --no-edit multi-connection-sidebar root-renders-connections framed-batch-fetch fork-notes
git push --force-with-lease origin deploy

pnpm install && pnpm run build:all
```

Rebuilding `deploy` rather than merging into it means it never accumulates history, and a
conflict surfaces on the small branch that caused it instead of in a pile.

## Building

Upstream declares `node >= 24` and `pnpm@11.9.0`. The Node requirement is **advisory** —
there is no `engine-strict`, and it builds on Node 22. pnpm comes from `corepack`:

```bash
export PATH="$PWD/.tools:$PATH"      # the buf binary, see below
corepack pnpm install
corepack pnpm run build:all          # output: apps/web/dist
```

`packages/protobufs` generates its TypeScript with the **Buf CLI** and ships none of it, so
`buf` must be on `PATH` or the build fails with `sh: 1: buf: not found`. A copy lives in
`.tools/buf` (v1.75.0, a single static binary).

`Error getting git version: git describe --tags` during a build is harmless — it is the
version stamp, and it only fails on a clone with no tags.

## Serving it

`apps/web/dist` is a path-routed SPA, so a plain static file server **404s on reload** —
`/messages/broadcast/0` is a route, not a file. It needs index.html fallback for
extensionless paths.

**Storage needs HTTPS.** Served over plain HTTP to an IP address the page is not a secure
context, so the browser withholds `navigator.storage`, OPFS and `crypto.subtle` — the app
reports that it cannot open its storage and messages are not saved. Measured:

```
origin            http://<ip>:8089
isSecureContext   false
hasStorageManager false
hasSubtleCrypto   false
```

Only `https://` or `http://localhost` are secure contexts. There is no way round this from
either the client or the gateway.
