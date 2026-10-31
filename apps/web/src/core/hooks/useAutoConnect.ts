import type { ConnectionId } from "@app/core/stores/deviceStore/types";
import { useConnections } from "@app/pages/Connections/useConnections";
import { useDeviceStore } from "@core/stores";
import { createLogger } from "@meshtastic/sdk";
import { useEffect } from "react";

const log = createLogger("useAutoConnect");

/**
 * Connections already attempted in this page load.
 *
 * Module-level and deliberately never cleared. The promise of the flag is ONCE
 * PER PAGE LOAD, not once per render and not on a timer, and `connect()` is not
 * free — it opens a transport and runs a full handshake, which brings down the
 * node DB and the message history. A connection the user then disconnects by
 * hand must stay disconnected.
 */
const attempted = new Set<ConnectionId>();

/**
 * A connection in one of these states is already being dealt with, by this hook
 * on an earlier pass or by the user clicking Connect.
 */
const LIVE_STATUSES = new Set([
  "connected",
  "configured",
  "connecting",
  "configuring",
]);

/**
 * Open every connection marked `autoConnect` once, as soon as the saved
 * connections are known.
 *
 * WHY IT WAITS FOR HYDRATION. `savedConnections` lives in IndexedDB behind
 * zustand's `persist`, and that store is ASYNCHRONOUS: on the first render the
 * array is still empty, so an effect that simply read it would decide there was
 * nothing to connect and never look again. `persist.hasHydrated()` /
 * `onFinishHydration` are the only honest way to tell "no saved connections"
 * from "not read yet".
 *
 * WHY IT LIVES IN `App`. The Connections page is unmounted the moment a device
 * exists, and is never mounted at all on a deep route once one does. The flag
 * has to work on a reload of `/messages/broadcast/0`, which is where the app
 * actually sits.
 *
 * WHY IT DOES NOT RETRY. A failure already shows on the card with a Retry
 * button. A flag that quietly re-dials a gateway that is refusing is how a
 * browser ends up hammering a dead host with nobody watching.
 */
export function useAutoConnect(): void {
  const { connect } = useConnections();

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (cancelled) return;

      // Read the live store rather than a hook value: this runs from a
      // hydration callback, outside React's render.
      const saved = useDeviceStore.getState().savedConnections;
      const due = saved.filter(
        (c) =>
          c.autoConnect &&
          c.type === "http" &&
          !attempted.has(c.id) &&
          !LIVE_STATUSES.has(c.status),
      );
      if (due.length === 0) return;

      // The default connection goes LAST, and they are started one at a time.
      // `setupMeshDevice` claims the active connection and the selected device
      // as it goes, so the last one started is the one the app lands on — and
      // the default is the connection the user has said they want to be looking
      // at. Starting them serially is what makes that deterministic;
      // `connect()` resolves once the transport is open and the handshake is
      // under way, so the handshakes still overlap and nothing is slower for it.
      due.sort((a, b) => Number(!!a.isDefault) - Number(!!b.isDefault));

      log.info("auto-connecting on load", {
        count: due.length,
        names: due.map((c) => c.name),
      });

      for (const conn of due) {
        if (cancelled) return;
        attempted.add(conn.id);
        // No `allowPrompt`: nothing here may raise a device chooser.
        await connect(conn.id);
      }
    };

    if (useDeviceStore.persist.hasHydrated()) {
      void run();
      return () => {
        cancelled = true;
      };
    }

    const unsubscribe = useDeviceStore.persist.onFinishHydration(() => {
      void run();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [connect]);
}
