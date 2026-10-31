import { create } from "@bufbuild/protobuf";
import * as Protobuf from "@meshtastic/protobufs";
import { describe, expect, it } from "vitest";
import { MeshClient } from "../../core/client/MeshClient.ts";
import { createFakeTransport } from "../../core/testing/createFakeTransport.ts";
import { ChannelNumber } from "../../core/types.ts";

describe("NodesClient", () => {
  it("populates the list signal from incoming NodeInfo packets", async () => {
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });

    expect(client.nodes.list.value).toEqual([]);

    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, { num: 1 }),
    );
    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, { num: 2, isFavorite: true }),
    );

    expect(client.nodes.list.value.map((n) => n.num)).toEqual([1, 2]);
    expect(client.nodes.byNum(2)?.isFavorite).toBe(true);
  });

  it("byNum returns undefined for unknown nodes", () => {
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });
    expect(client.nodes.byNum(999)).toBeUndefined();
  });

  it("folds live device-metrics telemetry into the node", () => {
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });

    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, { num: 100 }),
    );
    client.events.onTelemetryPacket.dispatch({
      id: 1,
      from: 100,
      to: 0,
      channel: ChannelNumber.Primary,
      type: "broadcast",
      rxTime: new Date(1000),
      data: create(Protobuf.Telemetry.TelemetrySchema, {
        variant: {
          case: "deviceMetrics",
          value: create(Protobuf.Telemetry.DeviceMetricsSchema, {
            batteryLevel: 80,
            voltage: 4.1,
          }),
        },
      }),
    });

    expect(client.nodes.byNum(100)?.deviceMetrics?.batteryLevel).toBe(80);
    expect(client.nodes.byNum(100)?.deviceMetrics?.voltage).toBeCloseTo(4.1);
  });

  it("updates lastHeard only from packets that carry rx_time", () => {
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });
    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, { num: 5, lastHeard: 1_000 }),
    );

    // A replayed packet with no rx_time leaves lastHeard alone.
    client.events.onMeshPacket.dispatch(
      create(Protobuf.Mesh.MeshPacketSchema, { from: 5, id: 1 }),
    );
    expect(client.nodes.byNum(5)?.lastHeard).toBe(1_000);

    client.events.onMeshPacket.dispatch(
      create(Protobuf.Mesh.MeshPacketSchema, { from: 5, id: 2, rxTime: 2_000 }),
    );
    expect(client.nodes.byNum(5)?.lastHeard).toBe(2_000);
  });

  function withFirmware(client: MeshClient, firmwareVersion: string) {
    client.events.onDeviceMetadataPacket.dispatch({
      id: 0,
      from: 0,
      to: 0,
      type: "direct",
      channel: ChannelNumber.Primary,
      rxTime: new Date(),
      data: create(Protobuf.Mesh.DeviceMetadataSchema, { firmwareVersion }),
    });
  }

  it("treats every node as heard on firmware older than 2.8.1", () => {
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });
    withFirmware(client, "2.7.15.abc");
    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, { num: 8 }),
    );
    expect(client.nodes.byNum(8)?.heardOnCurrentLora).toBe(true);
  });

  it("treats every node as heard when 2.8.1 never populates the field", () => {
    // MEASURED on a RAK4631 running 2.8.1.c3df491: heard_on_current_lora is
    // absent from all 96 NodeInfo frames it sends. The version check this
    // replaces trusted the field here and dimmed the entire node list.
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });
    withFirmware(client, "2.8.1.c3df491");
    for (const num of [8, 9, 10]) {
      client.events.onNodeInfoPacket.dispatch(
        create(Protobuf.Mesh.NodeInfoSchema, { num }),
      );
    }
    for (const num of [8, 9, 10]) {
      expect(client.nodes.byNum(num)?.heardOnCurrentLora).toBe(true);
    }
  });

  it("reports unheard nodes without being told the firmware version", () => {
    // The radio answering `true` once is the whole capability check, so this
    // works with no DeviceMetadata at all.
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });
    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, {
        num: 9,
        heardOnCurrentLora: true,
      }),
    );
    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, { num: 8 }),
    );
    expect(client.nodes.byNum(9)?.heardOnCurrentLora).toBe(true);
    expect(client.nodes.byNum(8)?.heardOnCurrentLora).toBe(false);
  });

  it("re-reads nodes that arrived before the radio first answered", () => {
    // The first `true` can land anywhere in the handshake dump. Nodes stored
    // while the question was unanswered were given the benefit of the doubt,
    // and that has to be taken back once the radio proves it answers.
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });
    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, { num: 8 }),
    );
    expect(client.nodes.byNum(8)?.heardOnCurrentLora).toBe(true);

    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, {
        num: 9,
        heardOnCurrentLora: true,
      }),
    );
    expect(client.nodes.byNum(8)?.heardOnCurrentLora).toBe(false);
    expect(client.nodes.byNum(9)?.heardOnCurrentLora).toBe(true);
  });

  it("does not mark a node seeded without a NodeInfo as unheard", () => {
    // A stray UserPacket seeds a stub Node. The radio has said nothing about
    // that node's heard state, so the sweep must leave it alone.
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });
    client.events.onUserPacket.dispatch({
      id: 0,
      from: 7,
      to: 0,
      type: "broadcast",
      channel: ChannelNumber.Primary,
      rxTime: new Date(),
      data: create(Protobuf.Mesh.UserSchema, { longName: "stub" }),
    });
    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, {
        num: 9,
        heardOnCurrentLora: true,
      }),
    );
    expect(client.nodes.byNum(7)?.heardOnCurrentLora).toBeUndefined();
  });

  it("forgets the capability answer when rescoped to another radio", () => {
    // Otherwise the next radio's first NodeInfo is read against the previous
    // radio's capability and its whole list dims.
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });
    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, {
        num: 9,
        heardOnCurrentLora: true,
      }),
    );
    client.nodes.rescope(2);
    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, { num: 8 }),
    );
    expect(client.nodes.byNum(8)?.heardOnCurrentLora).toBe(true);
  });

  it("reports unheard nodes on firmware 2.8.1", () => {
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });
    withFirmware(client, "2.8.1.8e6a88d");
    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, { num: 8 }),
    );
    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, {
        num: 9,
        heardOnCurrentLora: true,
      }),
    );
    expect(client.nodes.byNum(8)?.heardOnCurrentLora).toBe(false);
    expect(client.nodes.byNum(9)?.heardOnCurrentLora).toBe(true);
  });

  it("keeps a known position when a thin NodeInfo arrives", () => {
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });
    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, {
        num: 3,
        position: { latitudeI: 10, longitudeI: 20 },
      }),
    );
    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, { num: 3, isFavorite: true }),
    );
    expect(client.nodes.byNum(3)?.position?.latitudeI).toBe(10);
    expect(client.nodes.byNum(3)?.isFavorite).toBe(true);
  });

  it("records a node's status message", () => {
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });
    client.events.onNodeStatusPacket.dispatch({
      id: 1,
      from: 4,
      to: 0xffffffff,
      type: "broadcast",
      channel: ChannelNumber.Primary,
      rxTime: new Date(),
      data: create(Protobuf.Mesh.StatusMessageSchema, { status: "at camp" }),
    });
    expect(client.nodes.byNum(4)?.status).toBe("at camp");
  });
});
