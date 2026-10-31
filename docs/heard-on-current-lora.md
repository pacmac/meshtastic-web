# The whole node list renders dimmed, because a version check stands in for a capability

## The symptom

Open **Nodes**, then switch radios. One radio's list is entirely greyed out and the
other's is not. Not a few rows — every row, on every visit, on one radio only.

## What dims a row

```
Table/index.tsx:142        row.isDimmed && "opacity-60"
Nodes/index.tsx:171        isDimmed: isNodeUnheardOnCurrentLora(node)
Node.ts:33                 node.heardOnCurrentLora === false && !node.viaMqtt
```

So the whole list dims when every node is stored with `heardOnCurrentLora === false`.
That value is not the wire value. `NodesClient` overrides it:

```ts
// NodesClient.ts:131
heardOnCurrentLora: mapped.heardOnCurrentLora || !this.firmwareReportsHeard(),

// NodesClient.ts:140 — "heard_on_current_lora exists from firmware 2.8.1."
private firmwareReportsHeard(): boolean {
  const version = this.client.device.metadata.value?.firmwareVersion;
  return !!version && firmwareAtLeast(version, "2.8.1");
}
```

Below 2.8.1 the field did not exist, so the client forces every node to heard and
nothing dims. From 2.8.1 it trusts the wire.

## The defect

**The version is a proxy for a capability the firmware does not necessarily have.**
`NodeInfo.heard_on_current_lora` is field 15, a **plain proto3 `bool`** — not
`optional`. proto3 scalars have no presence: a false bool is omitted from the wire
entirely, so *absent* and *false* are the same zero bytes. Nothing in a NodeInfo
distinguishes

- "the radio has not heard this node on its current LoRa settings", from
- "this build never answers the question".

The version check assumes the first. Measured on two live radios, reading field 15
straight off the original frame bytes with nothing re-serialised and no schema
consulted (`probe_raw15.py`):

| | OMNI `!fdcee922` | YAGI `!db98d761` |
|---|---|---|
| firmware | **2.8.1**.c3df491 | **2.7.26**.54e0d8d |
| NodeInfo frames | 96 | 79 |
| carrying field 15 true | **0** | 0 |
| list dims | **yes, all 96 rows** | no |

OMNI's own fields, per NodeInfo: `[1, 2, 3, 5, 6, 10, 14]` and `[1, 2, 4, 5, 9]`.
Field 15 appears in neither, nor in any of the other 94.

So this 2.8.1 build does not populate the field. The version says it does, the client
believes the version, every node reads false, every row dims. YAGI is spared only
because it sits *below* the threshold and gets the blanket override.

The asymmetry Peter saw is not between the two radios' node DBs. It is that the two
radios are on different firmware, and the bug needs 2.8.1 to fire.

This is an upstream `@meshtastic/sdk` defect, not a gateway one — mesh-gw passes the
frames through unaltered, which is why the raw-bytes probe was the measurement that
settled it.

## The fix: ask the data, not the version

A radio whose firmware answers this question answers it `true` for at least one node —
in practice every node it has heard directly, and at minimum itself. A radio whose
firmware does not answer it never sends a true. That is observable, and unlike the
version string it cannot be wrong.

So `NodesClient` keeps a per-connection capability flag:

- it starts false, meaning **unanswered**, and while it is false nothing dims
- the first NodeInfo carrying `heardOnCurrentLora: true` flips it to true, and from
  then on a false is believed

Because the flip can happen partway through the handshake dump, the nodes stored
before it must be re-evaluated. `NodesClient` therefore remembers each node's **raw**
wire value alongside the overridden one, and sweeps the store once when the flag
flips, restoring each node's raw value. One boolean per node.

### What this gets right that the version check does not

- A 2.8.1 build that does not populate the field dims nothing, instead of dimming
  everything.
- A build that *does* populate it behaves exactly as before — and the existing
  upstream test `reports unheard nodes on firmware 2.8.1` passes unchanged, because it
  already dispatches an unflagged node *before* a flagged one and expects the
  unflagged one to end up false. The sweep is what makes that still hold.
- The firmware version is no longer consulted at all for this, so a future build that
  gains or loses the field needs no table of versions.

### The deliberate false negative

A radio on a reporting firmware that has genuinely heard *nothing* — freshly flashed,
or isolated — never sends a true, so the flag never flips and nothing dims. The list
is then under-dimmed rather than wholly dimmed. That is the right way round to be
wrong: a missing hint costs a user nothing, and a list that is entirely grey is
indistinguishable from a broken page.

## Files

| file | change |
|---|---|
| `packages/sdk/src/features/nodes/NodesClient.ts` | capability flag + raw-value map + sweep, replacing `firmwareReportsHeard()` |
| `packages/sdk/src/features/nodes/NodesClient.test.ts` | new cases for the 2.8.1-that-does-not-report radio and for the retroactive sweep |
| `packages/sdk/src/features/nodes/domain/Node.ts` | doc comment: the field is a capability question, not a version question |

`firmwareAtLeast` stays — eight other call sites use it correctly, for fields that
really did arrive with a version.

## Upstream

PR candidate against `meshtastic/web`, alongside `multi-connection-sidebar`. The
report needs the raw-bytes measurement in it, because the obvious reading of the
symptom — "those nodes really were not heard" — is wrong and is what the version
check already assumed.
