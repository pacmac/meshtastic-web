import type * as Protobuf from "@meshtastic/protobufs";

export interface Node {
  readonly num: number;
  readonly user?: Protobuf.Mesh.User;
  readonly position?: Protobuf.Mesh.Position;
  readonly deviceMetrics?: Protobuf.Telemetry.DeviceMetrics;
  readonly lastHeard?: number;
  readonly snr?: number;
  readonly channel?: number;
  readonly viaMqtt?: boolean;
  readonly hopsAway?: number;
  readonly isFavorite: boolean;
  readonly isIgnored: boolean;
  readonly isKeyManuallyVerified?: boolean;
  readonly isMuted?: boolean;
  /** The node signs its packets with XEdDSA (firmware 2.8+). */
  readonly hasXeddsaSigned?: boolean;
  /**
   * Heard over LoRa since the radio's current LoRa settings took effect.
   *
   * Not every firmware answers this. The wire field is a plain proto3 `bool`
   * with no presence, so a radio that never populates it is indistinguishable
   * from one reporting that it heard nothing — and the firmware VERSION does
   * not settle it either: builds reporting 2.8.1 exist that never set it.
   * `NodesClient` therefore decides from the data, and leaves this `true`
   * until the radio has answered `true` at least once.
   * See {@link isUnheardOnCurrentLora}.
   */
  readonly heardOnCurrentLora?: boolean;
  /** Latest status message the node broadcast (NODE_STATUS_APP). */
  readonly status?: string;
}

/**
 * True for a node the radio hasn't heard on its current LoRa settings.
 * Nodes seen only over MQTT are never "unheard": LoRa settings don't apply.
 */
export const isUnheardOnCurrentLora = (node: Node): boolean =>
  node.heardOnCurrentLora === false && !node.viaMqtt;
