import type { Protobuf } from "@meshtastic/sdk";
import { numberToHexUnpadded } from "@noble/curves/utils.js";
import type { TFunction } from "i18next";

/**
 * What the Nodes page says about a node, shared by the table and the cards so
 * the two views cannot disagree about a name, a signal or a hop count.
 */

export interface NodeNames {
  shortName: string;
  longName: string;
}

export const nodeNames = (
  node: Protobuf.Mesh.NodeInfo,
  t: TFunction,
): NodeNames => {
  const shortName =
    node.user?.shortName ??
    numberToHexUnpadded(node.num).slice(-4).toUpperCase();
  const longName =
    node.user?.longName ?? t("fallbackName", { last4: shortName });
  return { shortName, longName };
};

export type SnrTone = "text-green-500" | "text-yellow-500" | "text-red-500";

export interface SnrInfo {
  snr: number;
  /** 0-100. */
  quality: number;
  tone: SnrTone;
}

/**
 * SNR is reported in dB. Map it to a 0-100% signal-quality heuristic
 * (-10 dB -> 0%, +10 dB -> 100%) for an at-a-glance read, and pick a tone.
 */
export const snrInfo = (node: Protobuf.Mesh.NodeInfo): SnrInfo => {
  const snr = node.snr ?? 0;
  const quality = Math.min(Math.max(Math.round((snr + 10) * 5), 0), 100);
  const tone =
    quality >= 67
      ? "text-green-500"
      : quality >= 34
        ? "text-yellow-500"
        : "text-red-500";
  return { snr, quality, tone };
};

export const connectionLabel = (
  node: Protobuf.Mesh.NodeInfo,
  t: TFunction,
): string => {
  // The MQTT marker is appended even when the hop count is unknown, exactly
  // as the table always did.
  const hops =
    node.hopsAway === undefined
      ? t("unknown.longName")
      : node.viaMqtt === false && node.hopsAway === 0
        ? t("nodesTable.connectionStatus.direct")
        : `${node.hopsAway.toString()} ${
            node.hopsAway > 1 ? t("unit.hop.plural") : t("unit.hop.one")
          } ${t("nodesTable.connectionStatus.away")}`;
  return node.viaMqtt === true
    ? `${hops}${t("nodesTable.connectionStatus.viaMqtt")}`
    : hops;
};
