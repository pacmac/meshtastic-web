# Nodes page: a cards view beside the list

Peter, 2026-11-01: *"in the nodes list page, add a group button/toggle to show nodes as
either cards or as a list."*

Task: `gap-nodes-list-has-no-card-view-toggle`. Rulings given with "go": the four defaults
below were put to him and he said go without changing any.

## What is being added

A two-button segmented control on the Nodes page toolbar, beside the `n/total` count:
**List** (today's table, unchanged) and **Cards** (a responsive grid, one card per node).
The choice is remembered per browser. Default is List, so nobody's page changes until they
press it.

## Why the card view is its own component and not a mode of `Table`

`Table` takes rows of pre-rendered cells (`DataRow.cells[].content`) and owns its sort state
privately (`sortColumn` default `"Last Heard"`, `sortOrder`). A card needs the raw node, and
making `Table` render cards would put a second layout into a generic component that upstream
also edits. So the cards are a new file and `Table` is **not touched**.

The cost is that the cards need their own sort. A small "sort by" select supplies it, using
the same keys the table sorts on, and favourites still come first (same rule as `Table`).

## The one duplication this would create, and how it is avoided

The page computes the display name, the SNR quality percentage, the SNR tone and the
connection label inline inside the `tableRows` map. Cards need exactly the same values. Two
copies of the SNR heuristic would drift, so the computation moves to a pure helper module and
both views call it. This is the only change to the existing row building.

## Files

| file | change |
|---|---|
| `apps/web/src/pages/Nodes/nodeDisplay.ts` | **new.** Pure helpers: `nodeNames(node, t)`, `snrInfo(node)` (`{ snr, quality, tone }`), `connectionLabel(node, t)`. Lifted unchanged from `index.tsx` |
| `apps/web/src/pages/Nodes/nodeDisplay.test.ts` | **new.** The three helpers, including the SNR clamp at both ends and the hop wording |
| `apps/web/src/pages/Nodes/useNodesView.ts` | **new.** `useNodesView()` returns `[view, setView]`, backed by `useLocalStorage("nodesView", "list")`. Any stored value other than `"list"` or `"cards"` reads as `"list"` |
| `apps/web/src/pages/Nodes/useNodesView.test.ts` | **new.** default is `list`; set to `cards` persists across a re-render; a junk stored value falls back to `list` |
| `apps/web/src/pages/Nodes/NodeCards.tsx` | **new.** Props: `nodes`, `hasNodeError(num)`, `onOpen(num)`, optional `locale` (for `TimeAgo`). Own sort state and select. Renders a grid of `Card`s |
| `apps/web/src/pages/Nodes/NodeCards.test.tsx` | **new.** See Tests |
| `apps/web/src/pages/Nodes/index.tsx` | **edit.** Use the helpers in the row map; add `useNodesView`; add the toggle; render `<NodeCards>` or `<Table>` |
| `apps/web/public/i18n/locales/en/nodes.json` | **edit.** Add `view.list`, `view.cards`, `view.label`, `sort.label` and the sort option names |

## The card

```
┌──────────────────────────────┐
│ [avatar]  Long Name  🔒 ✓    │   avatar with favourite star and error badge;
│           status message…    │   NodeTrustIndicators beside the name;
│                              │   status line truncated, full text in title
│ Direct              12 s ago │   connection label · last heard (TimeAgo)
│ 5.5 dB  80%          🔒      │   SNR in its tone colour · encryption lock
│ HELTEC_V3                    │   hardware model
└──────────────────────────────┘
```

- The long name opens the node details dialog, the same call the table makes
  (`setNodeNumDetails(num)` then `setDialogOpen("nodeDetails", true)`). In the card it is a
  real `<button>`, not the table's `<h1>` with an `onMouseDown`, so it works from the
  keyboard.
- A node that is not heard on the current LoRa settings gets `opacity-60`, from the same
  `isNodeUnheardOnCurrentLora(node)` the table uses.
- Favourite nodes get the same yellow tint family the table uses.
- **MAC address is left off.** It is a table-only detail. This is a deliberate omission
  and is stated here so it is not mistaken for a bug.
- The grid is `grid-cols-1`, `sm:grid-cols-2`, `xl:grid-cols-3`; the page is already a
  scrolling container so the grid adds no scroll of its own.

Sort keys, matching the table's columns: **Last heard** (default, newest first), **Name**,
**Connection** (hops, direct first), **SNR**, **Model**. Favourites first, always.

## Tests, and what the red is

The red is: the files do not exist, so each test file fails to import. That is a legitimate
red for a new feature but a weak one, so the tests are written to bite on behaviour once the
files exist:

1. `NodeCards` renders one card per node and shows each node's name.
2. Favourites sort before non-favourites whatever the sort key.
3. Changing the sort select to Name reorders the cards.
4. A node whose `heardOnCurrentLora` is false and not via MQTT renders with `opacity-60`;
   one that is heard does not.
5. Pressing a card's name calls `onOpen` with that node's number.
6. `useNodesView` defaults to `list`, persists `cards`, and rejects junk.
7. `snrInfo` clamps below -10 dB to 0 and above +10 dB to 100.

Falsification: after green, revert the favourites-first comparator only and confirm test 2
goes red, then restore. Control: the unmutated source is green.

## Not changing, and why

- `components/generic/Table/index.tsx`. Generic, upstream-owned, and the card view does not
  need it changed.
- The other 22 locales. `i18n-config.ts` declares `fallbackLng`, so a missing key renders in
  the fallback language. Translations are Crowdin's job upstream.
- `Card.tsx`, `ToggleGroup.tsx`. Used as they are.
- Routes and the sidebar. No new page.

## What this does not verify

Rendering in a real browser, in both themes, at the sizes actually used. The Playwright MCP
is disconnected this session, so that check cannot run until it is back. The work is not
called verified until it has.

## Found in passing, not in scope

`Table` defaults its sort to the English literal `"Last Heard"` and finds its column by
comparing translated heading text, so outside English the default sort matches nothing and
the rows come out unsorted. Read from the code, not run in another locale. To be registered
and sent upstream, not fixed here. The cards sort by a key, not by heading text, so they do
not inherit it.

source_hash (sha256, 2026-11-01, after the tests passed 19/19):

```
f7a8a410463a92548630be9f596cd2b3461a3869b38608cdf4cb0da25315c443  pages/Nodes/nodeDisplay.ts
b295c4f6b0596a4660edaf11010053497f9c1e8d10238849295ee1b3ad8890f7  pages/Nodes/useNodesView.ts
fa7e0b4ab90fb043e608f110f6d983e2607a52f677e0e063ef2c5e608a05b7ee  pages/Nodes/NodeCards.tsx
14c760d450f6ef3776d3ed515be8884f67a0b2ced0ddc2a9e7021827cc99250b  pages/Nodes/index.tsx
2c70e07e2f46f411d96f2798ac30d0ad9994313fbe1ebcdfee8eeb72795271f9  public/i18n/locales/en/nodes.json
```

The finding in passing is registered as `the-table-default-sort-is-an-english-literal`.
