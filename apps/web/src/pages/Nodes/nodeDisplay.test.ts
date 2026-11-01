import type { Protobuf } from "@meshtastic/sdk";
import i18n from "i18next";
import { describe, expect, it } from "vitest";
import { connectionLabel, nodeNames, snrInfo } from "./nodeDisplay.ts";

const t = i18n.getFixedT("en", "nodes");

const node = (over: Record<string, unknown> = {}) =>
  ({
    num: 0x1234abcd,
    lastHeard: 0,
    isFavorite: false,
    ...over,
  }) as unknown as Protobuf.Mesh.NodeInfo;

describe("snrInfo", () => {
  it("maps -10 dB to 0% and +10 dB to 100%, clamping beyond both", () => {
    expect(snrInfo(node({ snr: -10 })).quality).toBe(0);
    expect(snrInfo(node({ snr: 10 })).quality).toBe(100);
    expect(snrInfo(node({ snr: -30 })).quality).toBe(0);
    expect(snrInfo(node({ snr: 30 })).quality).toBe(100);
  });

  it("treats a node with no SNR as 0 dB", () => {
    const info = snrInfo(node());
    expect(info.snr).toBe(0);
    expect(info.quality).toBe(50);
  });

  it("picks green from 67%, yellow from 34%, red below", () => {
    expect(snrInfo(node({ snr: 4 })).tone).toBe("text-green-500"); // 70%
    expect(snrInfo(node({ snr: 0 })).tone).toBe("text-yellow-500"); // 50%
    expect(snrInfo(node({ snr: -5 })).tone).toBe("text-red-500"); // 25%
  });
});

describe("nodeNames", () => {
  it("uses the user's names when present", () => {
    const n = node({ user: { shortName: "ABCD", longName: "Alpha Base" } });
    expect(nodeNames(n, t)).toEqual({
      shortName: "ABCD",
      longName: "Alpha Base",
    });
  });

  it("falls back to the last four hex digits of the node number", () => {
    const names = nodeNames(node(), t);
    expect(names.shortName).toBe("ABCD");
    expect(names.longName).toContain("ABCD");
  });
});

describe("connectionLabel", () => {
  it("says Direct for a zero-hop LoRa node", () => {
    expect(connectionLabel(node({ hopsAway: 0, viaMqtt: false }), t)).toBe(
      "Direct",
    );
  });

  it("counts hops, with the plural form above one", () => {
    expect(connectionLabel(node({ hopsAway: 1, viaMqtt: false }), t)).toMatch(
      /^1 \S+ away$/,
    );
    expect(connectionLabel(node({ hopsAway: 3, viaMqtt: false }), t)).toMatch(
      /^3 \S+ away$/,
    );
  });

  it("appends the MQTT marker for a node heard via MQTT", () => {
    expect(connectionLabel(node({ hopsAway: 2, viaMqtt: true }), t)).toContain(
      "MQTT",
    );
  });

  it("says unknown when the hop count was never reported", () => {
    expect(connectionLabel(node(), t)).toBe(t("unknown.longName"));
  });
});
