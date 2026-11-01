import useLocalStorage from "@core/hooks/useLocalStorage.ts";
import { useCallback } from "react";

export type NodesView = "list" | "cards";

const KEY = "nodesView";

/**
 * Which layout the Nodes page uses, remembered per browser. Anything stored
 * that is not a known layout reads as the list, so a stale or hand-edited
 * value can never leave the page with nothing to render.
 */
export const useNodesView = (): [NodesView, (view: NodesView) => void] => {
  const [stored, setStored] = useLocalStorage<unknown>(KEY, "list");
  const view: NodesView = stored === "cards" ? "cards" : "list";
  const setView = useCallback(
    (next: NodesView) => setStored(next),
    [setStored],
  );
  return [view, setView];
};
