import {
  useActiveConnectionId,
  useSavedConnections,
  useSetActiveConnectionId,
} from "@app/core/stores/deviceStore/selectors.ts";
import { meshRegistry } from "@app/core/meshRegistry.ts";
import type { Connection } from "@app/core/stores/deviceStore/types.ts";

/* EVERY LIVE CONNECTION, not just the active one.
 *
 * The sidebar renders ONE connection — `useActiveConnection() ||
 * useDefaultConnection() || useFirstSavedConnection()` — so a gateway holding several
 * radios looks like a gateway holding one, and switching between them means a trip to the
 * Connections page.
 *
 * NOTHING UNDERNEATH NEEDED CHANGING, which is why this is a new file and not a patch.
 * `MeshRegistry` already "holds one MeshClient per active connection"; `connect()` tears
 * down nothing; `cachedTransports`, `configSubscriptions`, `handshakeAttempts` and
 * `pendingRetries` are already `Map<ConnectionId, …>`; and `useSavedConnections`,
 * `useActiveConnectionId` and `useSetActiveConnectionId` were all already exported. The
 * app was multi-connection everywhere except the one component that displays it.
 *
 * SWITCHING SETS THE ACTIVE CLIENT AND NOTHING ELSE. The others stay connected and keep
 * receiving — they are separate transports to separate radios. `meshRegistry.setActive`
 * is what the `useMeshDevice()` / `useChat()` hooks read, and the store's
 * `activeConnectionId` is what the rest of the UI reads, so both are set together; one
 * without the other leaves the pages showing a different radio from the one highlighted.
 */

/** Connected enough to be worth listing. `configuring` is included deliberately: a radio
 *  part-way through its handshake is present and is about to be usable, and hiding it
 *  makes a slow connection look like a failed one. */
const LIVE = new Set(["connected", "configured", "configuring"]);

function statusDot(status: string | undefined): string {
  if (status === "connected" || status === "configured") {
    return "bg-green-500";
  }
  if (status === "configuring" || status === "connecting") {
    return "bg-yellow-500";
  }
  return "bg-red-500";
}

export function ConnectedDevices({ isCollapsed }: { isCollapsed: boolean }) {
  const connections = useSavedConnections();
  const activeId = useActiveConnectionId();
  const setActiveId = useSetActiveConnectionId();

  const live = connections.filter((c: Connection) => LIVE.has(c.status));

  // NOTHING AT ALL WHEN THERE IS NOTHING TO CHOOSE. One connection is what the panel
  // below already shows, so listing it here as well would be the same fact twice in two
  // styles — and an empty bordered box above the device panel reads as a fault.
  if (live.length < 2) {
    return null;
  }

  const select = (id: number) => {
    meshRegistry.setActive(id);
    setActiveId(id);
  };

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 px-2 py-2">
      {!isCollapsed && (
        <div className="px-2 pb-1 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Radios
        </div>
      )}
      <ul className="space-y-0.5">
        {live.map((c: Connection) => {
          const isActive = c.id === activeId;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => select(c.id)}
                aria-current={isActive ? "true" : undefined}
                title={`${c.name} — ${c.status}`}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm
                            transition-colors ${
                              isActive
                                ? "bg-slate-200 dark:bg-slate-700 font-medium"
                                : "hover:bg-slate-100 dark:hover:bg-slate-800"
                            }`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${statusDot(c.status)}`}
                  aria-hidden="true"
                />
                {!isCollapsed && <span className="truncate">{c.name}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default ConnectedDevices;
