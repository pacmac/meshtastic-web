# TIDY - start this repo clean after the host move

Peter, 2026-11-13: *"you need to do housekeeping so we can start off clean"* — all five
items. The repo was moved from a retired host. Everything below was measured on the new
host (`aidev`) on 2026-11-13, not copied from `docs/HANDOVER.md`.

## Where the commits go

`deploy` is **rebuilt, not merged into** (FORK.md), so a commit made directly on it is
deleted by the next `./deploy.sh update`. `CLAUDE.md` edits and docs belong on **`fork-notes`**,
then `deploy` takes a merge of it.

`git diff fork-notes deploy -- CLAUDE.md` is empty, so the uncommitted `CLAUDE.md` edit
travels across `git checkout fork-notes` without conflict. No stash (see HANDOVER, AVOID).

## Files that change

| file | change |
|---|---|
| `CLAUDE.md` | see item 1 and 2 |
| `docs/HANDOVER.md` | see item 3. The old copy is first archived as `docs/handover/2026-10-31-1800.md` |
| `docs/housekeeping-after-the-host-move.md` | this spec |

Nothing under `apps/`, `packages/`, `e2e/` changes. No source file is named by an open
register entry (`idiot list open`: the three Nodes-page entries touch `apps/web/src/pages/Nodes/*`
and `en/nodes.json` only).

## 1. The uncommitted CLAUDE.md edit

Measured: `git diff CLAUDE.md` replaces the `<thinking>` Think-First line with
`## - **Think First: …<thinking>…` (a heading, so no longer a bullet) and adds a new
Think-First bullet ("briefly summarize the intended approach … Do not expose internal
reasoning"). It also adds a trailing newline.

The two lines contradict each other, and the `## ` prefix is the way the old one was
switched off. Change: **delete the old, commented-out line**, keep the new bullet and the
trailing newline. Commit on `fork-notes`.

Cost: `CLAUDE.md` now differs from upstream in the Think-First line, so a rebase of
`fork-notes` onto `upstream/main` can conflict there. One line, resolved by hand.

## 2. The dangling `@AGENTS.md` import

Measured: `AGENTS.md` exists in **no ref** of this repo, including `upstream/main`
(`fe233b50`) — the defect is upstream's, not caused by the move. `.skills/` is missing the
same way. A missing `@` import is silently dropped, so nothing breaks; it is just noise.

Change: **delete the `@AGENTS.md` line** and leave the paragraph about
`<copilot_cli_workflow>` as it is. It is a statement about a file we do not have, but
rewording upstream's text widens the rebase conflict for nothing.

Raise upstream? Not in this task. Recorded here so a later session can.

## 3. HANDOVER.md

The handover is correct about what the code does and wrong about state. Archive the old
copy to `docs/handover/2026-10-31-1800.md` (never edited afterwards), then correct in the
live one, each against a measurement taken today:

- "Nothing is pushed" and "12 ahead": `deploy` is 0 ahead / 0 behind; the three branches
  now have upstreams.
- STATE: this host is `aidev`; `meshtastic-web` and `mesh-gw` are inactive, nothing on
  `:8089` / `:8001` / `:4403`; Node is v26.13.0; `node_modules` was absent.
- New work since: `58e152f2`, `28c7d257` (Nodes List/Cards toggle), merged `07861a81`.
- This repo now has its own `idiot.yaml` (three entries) and its own mcpp project
  `meshtastic-web`, so "this repo has no idiot.yaml" and "mcpp project is mesh-gw" are stale.
  `plan_file_attach` can attach specs here now.
- The xsession instruction `--as mesh-gw` is kept but marked **unverified on this host**.

Written with a dated "Amended 2026-11-13" note at the foot. Claims I could not re-measure
(live radios, nginx on `nginx-host`) stay as written and are marked `as of 2026-10-31`.

## 4. Install and build

From the repo root: `corepack pnpm install` then the app build
(`pnpm --filter "./apps/web" run build`), with `.tools` on `PATH` for `buf`. Output
`apps/web/dist` is gitignored. If the install or `buf` fails, that is reported, not worked around.

Not done: restarting any service, running `deploy.sh update`, touching nginx. The new host
has no services running and none were asked for.

## 5. Baseline

- SDK: `pnpm --filter @meshtastic/sdk exec vitest run` (repo root). Handover: 183 pass / 32 files.
- Web: `pnpm exec vitest run` from `apps/web`. Handover: 600 pass / 81 files.

Reported as measured. A different count is a finding, not a failure to fix in this task.
`pnpm lint` and `pnpm format` are also run once so the baseline names them.

## Out of scope — found, not fixed

- `pnpm typecheck` 180 errors; upstream issue for `heard_on_current_lora`; stale `FORK.md`
  branch table; `/ble` and `/ota` SPA fallback — all in HANDOVER REMAINS, untouched.
- `AGENTS.md` and `.skills/` absent upstream.

source_hash:
- CLAUDE.md `ecd7df17ca5b5c5161bfbb4878b99f0f3cd13af64ac485b556aedfd6aeb407d4`
- docs/HANDOVER.md `26ca254a67e7b6580b66188468c660527c6ef3abf5fc6a30a713a8c12415585f`
- docs/handover/2026-10-31-1800.md `bb780570c2003f1cd9b96af821a4512d281cfe86a622ce5359d98902bf289862` (byte-identical to the pre-edit HANDOVER.md, `cmp` verified)

## Found while doing it

- `nodes-cards-view` is on no remote and not in `deploy.sh` `BRANCHES`; the next
  `./deploy.sh update` would drop the Nodes List/Cards toggle. Recorded in HANDOVER.
  Not fixed: `deploy.sh` is outside this spec.
