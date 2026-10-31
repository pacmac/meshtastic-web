# Switching radios moves the SDK and the highlight, but not the legacy device store

## The symptom

Peter, with OMNI and YAGI both connected: the sidebar reads
`Firmware: 2.7.26.54e0d8d` for **both** radios, and stays wrong across two hard
refreshes. Switching radios changes the node count and the battery, and does not change
the firmware.

Measured the same thing myself before he said so, and reported it instead of fixing it:

| | YAGI selected | OMNI selected | OMNI connected ALONE |
|---|---|---|---|
| node count | 79 | **95** | 95 |
| battery | 94 % | **99 %** | 94 % |
| voltage | 4.11 V | **4.18 V** | 4.13 V |
| firmware | 2.7.26.54e0d8d | 2.7.26.54e0d8d | **2.8.1.c3df491** |

Everything moves except the firmware. And with OMNI on its own the firmware is right, so
nothing is failing to arrive — it is being read off the wrong radio.

A hard refresh cannot help: the value is rebuilt from the live handshake every load, and
the load re-makes the same wrong association.

## Three things identify "the current radio", and the switcher sets two

| what | holds | read by |
|---|---|---|
| `meshRegistry.setActive(id)` | the active `MeshClient` | `useMeshDevice()`, `useChat()`, `useNodes()` — node list, battery, voltage |
| `activeConnectionId` in the device store | the highlighted row | the sidebar highlight, `useActiveConnection()` |
| **`selectedDeviceId` in the app store** | the **legacy per-device store key** | `DeviceWrapper` → `CurrentDeviceContext` → `useDevice()` |

`ConnectedDevices.select()` sets the first two:

```ts
const select = (id: number) => {
  meshRegistry.setActive(id);
  setActiveId(id);
};
```

`useDevice()` is the third:

```ts
// core/stores/index.ts
export const useDevice = (): Device => {
  const { deviceId } = useDeviceContext();          // = selectedDeviceId
  return useDeviceStore((s) => s.getDevice(deviceId) ?? s.addDevice(deviceId));
};
```

and the sidebar's firmware is `metadata.get(0)` off that device:

```ts
// components/Sidebar.tsx:80,104,232
const { metadata } = useDevice();
const myMetadata = metadata.get(0);
... firmwareVersion={myMetadata?.firmwareVersion ?? t("unknown.notAvailable")}
```

`selectedDeviceId` is only ever written by `connect()` — `setSelectedDevice(deviceId)`,
where `deviceId` is the connection's `meshDeviceId` — and by the command palette. So
after two radios auto-connect it holds whichever connected **last**, and the sidebar
switcher never moves it again.

This is a defect in `ConnectedDevices.tsx`, a file added by the
`multi-connection-sidebar` branch of this fork. Its own doc comment says

> *both are set together; one without the other leaves the pages showing a different
> radio from the one highlighted*

which is right about the two it knew about, and missed that there were three.

## What else is wrong, not just the firmware

Everything behind the legacy per-device store reads the previous radio, not only the
version string. `subscribeAll` populates that store with **waypoints, traceroutes,
neighbour info, dialog triggers and unread counts**, and `useDevice()` is also what the
settings pages, the config editors and `useDeviceCapabilities` read. So before this fix,
a traceroute run after switching radios filed its result under the other radio, and
every firmware-gated control in Settings was gated on the other radio's version.

The firmware line is the visible corner of it, which is why it is the thing that got
reported.

## The fix

`select()` moves all three. The connection's `meshDeviceId` is exactly what `connect()`
passed to `setSelectedDevice`, so there is nothing new to derive.

```ts
const select = (c: Connection) => {
  meshRegistry.setActive(c.id);
  setActiveId(c.id);
  if (c.meshDeviceId !== undefined) setSelectedDevice(c.meshDeviceId);
};
```

**The guard is load-bearing.** `App` renders the Connections screen whenever
`getDevice(selectedDeviceId)` is falsy, so writing an absent id would not merely show
stale data — it would drop the whole app back to the connection list mid-session. A LIVE
connection always has `meshDeviceId` (`connect()` writes it before the handshake
finishes), so the guard should never fire; it is there because the cost of it firing
wrongly is the entire UI.

## Files

| file | change |
|---|---|
| `apps/web/src/components/ConnectedDevices.tsx` | `select()` also moves `selectedDeviceId`; takes the `Connection`, not the id |
| `apps/web/src/components/ConnectedDevices.test.tsx` | a switch moves all three, and a connection with no `meshDeviceId` moves the other two and leaves it alone |

## Upstream

Not an upstream defect — `ConnectedDevices.tsx` is this fork's own file. It folds into
the `multi-connection-sidebar` PR (upstream issue #724) rather than being a separate
one, because a reviewer should never see the broken version.
