import type { Protobuf } from "@meshtastic/sdk";

type ValidConfigType = Exclude<
  keyof Protobuf.LocalOnly.LocalConfig,
  "version" | "$typeName"
>;
type ValidModuleConfigType = Exclude<
  keyof Protobuf.LocalOnly.LocalModuleConfig,
  "version" | "$typeName"
>;

interface Dialogs {
  import: boolean;
  QR: boolean;
  shutdown: boolean;
  reboot: boolean;
  deviceName: boolean;
  nodeRemoval: boolean;
  nodeDetails: boolean;
  unsafeRoles: boolean;
  refreshKeys: boolean;
  deleteMessages: boolean;
  managedMode: boolean;
  clientNotification: boolean;
  resetNodeDb: boolean;
  clearAllStores: boolean;
  factoryResetDevice: boolean;
  factoryResetConfig: boolean;
}

type DialogVariant = keyof Dialogs;

type Page = "messages" | "map" | "settings" | "channels" | "nodes";

export type ConnectionId = number;
export type ConnectionType = "http" | "bluetooth" | "serial";
export type ConnectionStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "disconnecting"
  | "configuring"
  | "configured"
  | "online"
  | "error";

export type Connection = {
  id: ConnectionId;
  type: ConnectionType;
  name: string;
  createdAt: number;
  lastConnectedAt?: number;
  isDefault?: boolean;
  /**
   * Open this connection on page load, without being asked.
   *
   * NOT the same question as `isDefault`, which only decides which saved
   * connection the sidebar points at when none is live — it has never opened
   * anything. HTTP only: Web Bluetooth and Web Serial hand out a handle only in
   * response to a user gesture, and `cachedTransports` does not survive a
   * reload, so an automatic BLE reconnect would throw or raise a chooser nobody
   * asked for.
   *
   * Persists with no further work: `partialize` writes `savedConnections`
   * whole, so there is no per-field allow-list to add it to. `undefined`
   * already means off, so the store version does not move either.
   */
  autoConnect?: boolean;
  status: ConnectionStatus;
  error?: string;
  errorKind?: "cert" | "network";
  meshDeviceId?: number;
  /**
   * Node number of the radio this connection last reached, from the
   * handshake's my_info. Message, node and telemetry history is stored per
   * node, so every connection to the same radio shares it.
   */
  nodeNum?: number;
} & NewConnection;

export type NewConnection =
  | { type: "http"; name: string; url: string }
  | {
      type: "bluetooth";
      name: string;
      deviceId?: string;
      deviceName?: string;
      gattServiceUUID?: string;
    }
  | {
      type: "serial";
      name: string;
      usbVendorId?: number;
      usbProductId?: number;
    };

type WaypointWithMetadata = Protobuf.Mesh.Waypoint & {
  metadata: {
    channel: number; // Channel on which the waypoint was received
    created: Date; // Timestamp when the waypoint was received
    updated?: Date; // Timestamp when the waypoint was last updated
    from: number; // Node number of the device that sent the waypoint
  };
};

export type {
  Page,
  Dialogs,
  DialogVariant,
  ValidConfigType,
  ValidModuleConfigType,
  WaypointWithMetadata,
};
