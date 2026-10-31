import type {
  Connection,
  ConnectionStatus,
  ConnectionType,
} from "@app/core/stores/deviceStore/types";
import { useDeviceStore } from "@core/stores";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.hoisted(() => vi.fn(async (_id: number) => true));

vi.mock("@app/pages/Connections/useConnections", () => ({
  useConnections: () => ({ connect }),
}));

import { useAutoConnect } from "./useAutoConnect.ts";

let nextId = 1;

function seed(
  partial: Partial<Connection> & { type?: ConnectionType } = {},
): Connection {
  const conn = {
    id: nextId++,
    type: "http",
    name: `conn-${nextId}`,
    url: "radio.example",
    createdAt: Date.now(),
    status: "disconnected" as ConnectionStatus,
    ...partial,
  } as Connection;
  useDeviceStore.getState().addSavedConnection(conn);
  return conn;
}

function clearConnections(): void {
  for (const c of [...useDeviceStore.getState().savedConnections]) {
    useDeviceStore.getState().removeSavedConnection(c.id);
  }
}

describe("useAutoConnect", () => {
  beforeEach(() => {
    connect.mockClear();
    clearConnections();
    // The real store hydrates from IndexedDB, which never completes under
    // happy-dom. The hook's contract is "once the saved connections are
    // KNOWN", so the test says they are.
    vi.spyOn(useDeviceStore.persist, "hasHydrated").mockReturnValue(true);
  });

  it("connects only the flagged HTTP connections, default last", async () => {
    const plain = seed({ name: "plain" });
    const flagged = seed({ name: "flagged", autoConnect: true });
    const dflt = seed({ name: "default", autoConnect: true, isDefault: true });
    const ble = seed({ name: "ble", type: "bluetooth", autoConnect: true });

    renderHook(() => useAutoConnect());

    await waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
    // Default LAST: setupMeshDevice claims the selected device as it goes, so
    // the connection the user has said they want to look at must be the one
    // that claims it.
    expect(connect.mock.calls.map(([id]) => id)).toEqual([flagged.id, dflt.id]);
    // Never called without the flag, and never for a transport that needs a
    // user gesture to hand out a handle.
    expect(connect).not.toHaveBeenCalledWith(plain.id);
    expect(connect).not.toHaveBeenCalledWith(ble.id);
  });

  it("leaves a connection that is already live alone", async () => {
    seed({ name: "live", autoConnect: true, status: "configured" });
    const down = seed({ name: "down", autoConnect: true });

    renderHook(() => useAutoConnect());

    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    expect(connect).toHaveBeenCalledWith(down.id);
  });

  it("does not try the same connection twice in one page load", async () => {
    const conn = seed({ name: "once", autoConnect: true });

    const first = renderHook(() => useAutoConnect());
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    first.unmount();

    // A remount is not a new page load. The user may have disconnected it by
    // hand in between, and a flag that re-dials over that is a flag that
    // cannot be turned off.
    renderHook(() => useAutoConnect());
    await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(conn.id);
  });

  it("never passes allowPrompt, so nothing can raise a chooser", async () => {
    seed({ name: "quiet", autoConnect: true });
    renderHook(() => useAutoConnect());
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    expect(connect.mock.calls[0]).toHaveLength(1);
  });
});
