import { Mono } from "@components/generic/Mono.tsx";
import {
  isNodeUnheardOnCurrentLora,
  NodeTrustIndicators,
} from "@components/generic/NodeTrustIndicators.tsx";
import { TimeAgo } from "@components/generic/TimeAgo.tsx";
import { Avatar } from "@components/UI/Avatar.tsx";
import { Card } from "@components/UI/Card.tsx";
import type { NodeInfoWithStatus } from "@core/hooks/useNodesAsProto.ts";
import { cn } from "@core/utils/cn.ts";
import { Protobuf } from "@meshtastic/sdk";
import { LockIcon, LockOpenIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { connectionLabel, nodeNames, snrInfo } from "./nodeDisplay.ts";

type SortKey = "lastHeard" | "name" | "connection" | "snr" | "model";

const SORT_KEYS: SortKey[] = [
  "lastHeard",
  "name",
  "connection",
  "snr",
  "model",
];

const modelName = (node: Protobuf.Mesh.NodeInfo): string =>
  Protobuf.Mesh.HardwareModel[node.user?.hwModel ?? 0] ?? "UNSET";

export interface NodeCardsProps {
  nodes: NodeInfoWithStatus[];
  hasNodeError: (num: number) => boolean;
  onOpen: (num: number) => void;
  locale?: string;
}

export const NodeCards = ({
  nodes,
  hasNodeError,
  onOpen,
  locale,
}: NodeCardsProps) => {
  const { t } = useTranslation("nodes");
  const [sortKey, setSortKey] = useState<SortKey>("lastHeard");

  const sorted = useMemo(() => {
    const compare = (a: NodeInfoWithStatus, b: NodeInfoWithStatus): number => {
      switch (sortKey) {
        case "lastHeard":
          return b.lastHeard - a.lastHeard;
        case "name":
          return nodeNames(a, t).longName.localeCompare(
            nodeNames(b, t).longName,
          );
        case "connection":
          return (
            (a.hopsAway ?? Number.MAX_SAFE_INTEGER) -
            (b.hopsAway ?? Number.MAX_SAFE_INTEGER)
          );
        case "snr":
          return (b.snr ?? 0) - (a.snr ?? 0);
        case "model":
          return modelName(a).localeCompare(modelName(b));
      }
    };
    return [...nodes].sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) {
        return a.isFavorite ? -1 : 1;
      }
      return compare(a, b);
    });
  }, [nodes, sortKey, t]);

  return (
    <div>
      <div className="flex items-center gap-2 px-2 pt-2 text-sm text-slate-500 dark:text-slate-400">
        <label htmlFor="nodes-sort">{t("sort.label")}</label>
        <select
          id="nodes-sort"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-slate-900 dark:border-slate-600 dark:text-slate-100"
        >
          {SORT_KEYS.map((key) => (
            <option
              key={key}
              value={key}
              className="bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100"
            >
              {t(`sort.${key}`)}
            </option>
          ))}
        </select>
      </div>
      {/* More columns on a wide page, never wider cards. */}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2 p-2">
        {sorted.map((node) => {
          const { shortName, longName } = nodeNames(node, t);
          const { snr, quality, tone } = snrInfo(node);
          const hasKey = (node.user?.publicKey?.length ?? 0) > 0;
          return (
            <li
              key={node.num}
              className={cn(isNodeUnheardOnCurrentLora(node) && "opacity-60")}
            >
              <Card
                className={cn(
                  "flex h-full items-start gap-2 p-2",
                  node.isFavorite && "bg-yellow-100/30 dark:bg-slate-800",
                )}
                data-short-name={shortName}
              >
                <Avatar
                  nodeNum={node.num}
                  showFavorite={node.isFavorite}
                  showError={hasNodeError(node.num)}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpen(node.num)}
                      title={longName}
                      className="max-w-full min-w-0 cursor-pointer truncate text-left text-sm font-medium underline"
                    >
                      {longName}
                    </button>
                    <NodeTrustIndicators node={node} />
                    <span className="ml-auto shrink-0">
                      {hasKey ? (
                        <LockIcon
                          size={14}
                          className="text-green-600"
                          aria-label={t("nodesTable.headings.encryption")}
                        />
                      ) : (
                        <LockOpenIcon
                          size={14}
                          className="text-yellow-300"
                          aria-label={t("nodesTable.headings.encryption")}
                        />
                      )}
                    </span>
                  </div>
                  {node.status && (
                    <span
                      className="truncate text-xs text-slate-500 dark:text-slate-400"
                      title={node.status}
                    >
                      <span className="sr-only">
                        {t("trust.statusMessage.label")}:{" "}
                      </span>
                      {node.status}
                    </span>
                  )}
                  {/* Wraps rather than truncating: "1 Hop away, via MQTT" must stay readable. */}
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <Mono className="text-xs">{connectionLabel(node, t)}</Mono>
                    <Mono className="ml-auto text-xs">
                      {node.lastHeard === 0 ? (
                        t("unknown.longName")
                      ) : (
                        <TimeAgo
                          timestamp={node.lastHeard * 1000}
                          locale={locale}
                        />
                      )}
                    </Mono>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <Mono className="flex items-baseline gap-1.5 text-xs">
                      <span className={tone}>
                        {Number(snr.toFixed(1))} {t("unit.db")}
                      </span>
                      <span className="text-gray-500 dark:text-gray-400/70">
                        {quality}%
                      </span>
                    </Mono>
                    <Mono className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {modelName(node)}
                    </Mono>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
