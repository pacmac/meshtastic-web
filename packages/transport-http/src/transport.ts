import {
  DeviceStatusEnum,
  type DeviceOutput,
  type Transport,
} from "@meshtastic/sdk";
import { withLocalNetworkTarget } from "./localNetwork.ts";

const FETCH_INTERVAL_MS = 3000;
const READ_TIMEOUT_MS = 7000;
const WRITE_TIMEOUT_MS = 4000;

/** StreamAPI frame header: magic, then a 16-bit big-endian length. */
const FRAME_MAGIC_0 = 0x94;
const FRAME_MAGIC_1 = 0xc3;

/**
 * Split a StreamAPI-framed body into its payloads, or null if it is not framed.
 *
 * WHY THIS IS NEEDED. `GET /api/v1/fromradio` hands out ONE protobuf per request, so a
 * handshake costs one round trip per frame — measured against a live gateway, 139 frames
 * and 142 round trips. On the same machine that is ~6 s; from a browser 200 ms away it is
 * minutes, every page reload, for every radio.
 *
 * `all=true` is in the device API spec and cannot fix it: the body is bare concatenated
 * protobufs, protobuf is not self-delimiting, and `decodePacket` parses exactly one
 * `FromRadio` per chunk — so a concatenation merges into a single message and, the
 * payload being a `oneof`, only the last frame survives.
 *
 * So a batch has to carry lengths. This reuses the framing the project already has on
 * serial, BLE and TCP rather than inventing a third encoding for one transport.
 *
 * NULL, NOT AN EXCEPTION, for anything that is not framed: the caller uses it to notice a
 * peer that does not speak this and fall back, which is what makes the request safe to
 * send to a device that has never heard of it.
 */
export function deframeStreamApi(body: Uint8Array): Uint8Array[] | null {
  const out: Uint8Array[] = [];
  let i = 0;
  while (i < body.length) {
    if (
      i + 4 > body.length ||
      body[i] !== FRAME_MAGIC_0 ||
      body[i + 1] !== FRAME_MAGIC_1
    ) {
      return null;
    }
    const len = ((body[i + 2] ?? 0) << 8) | (body[i + 3] ?? 0);
    if (i + 4 + len > body.length) {
      return null;
    }
    out.push(body.subarray(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out.length ? out : null;
}

function toArrayBuffer(uint8array: Uint8Array): ArrayBuffer {
  if (
    uint8array.buffer instanceof ArrayBuffer &&
    uint8array.byteOffset === 0 &&
    uint8array.byteLength === uint8array.buffer.byteLength
  ) {
    return uint8array.buffer;
  }
  return uint8array.slice().buffer;
}

/**
 * Provides HTTP(S) transport for Meshtastic devices.
 *
 * Implements {@link Transport} using the device's HTTP API.
 * Polls `/api/v1/fromradio` for incoming packets and writes to `/api/v1/toradio`.
 */
export class TransportHTTP implements Transport {
  private _toDevice: WritableStream<Uint8Array>;
  private _fromDevice: ReadableStream<DeviceOutput>;
  private fromDeviceController?: ReadableStreamDefaultController<DeviceOutput>;

  private url: string;
  private receiveBatchRequests: boolean;
  /**
   * Ask for the whole queue in one framed body. Tried first and switched OFF
   * permanently the moment a peer answers something that is not framed, so a device
   * that has never heard of the parameter costs exactly one wasted response.
   */
  private framedBatch: boolean;
  private fetchInterval: number;
  private fetching: boolean;
  private interval: ReturnType<typeof setInterval> | undefined;

  private inflightReadController?: AbortController;

  private lastStatus: DeviceStatusEnum = DeviceStatusEnum.DeviceDisconnected;
  private closingByUser = false;

  /**
   * Probe the device and return a connected HTTP transport.
   *
   * @param address Hostname or IP address (with optional port).
   * @param tls Use HTTPS if true, HTTP otherwise.
   */
  public static async create(
    address: string,
    tls?: boolean,
  ): Promise<TransportHTTP> {
    const connectionUrl = `${tls ? "https" : "http"}://${address}`;
    await fetch(
      `${connectionUrl}/api/v1/toradio`,
      withLocalNetworkTarget(connectionUrl, { method: "OPTIONS" }),
    );
    return new TransportHTTP(connectionUrl);
  }

  /**
   * Construct a new HTTP transport for the given device URL.
   *
   * @param url Base URL of the device (`http://host:port` or `https://host:port`).
   */
  constructor(url: string) {
    this.url = url;
    this.receiveBatchRequests = false;
    this.framedBatch = true;
    this.fetchInterval = FETCH_INTERVAL_MS;
    this.fetching = false;

    this._toDevice = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        try {
          await this.writeToRadio(chunk);
        } catch (error) {
          if (!this.closingByUser) {
            this.emitStatus(
              DeviceStatusEnum.DeviceDisconnected,
              this.isTimeoutOrAbort(error) ? "write-timeout" : "write-error",
            );
            return;
          }
          throw error;
        }
      },
    });

    this._fromDevice = new ReadableStream<DeviceOutput>({
      start: (ctrl) => {
        this.fromDeviceController = ctrl;
        this.emitStatus(DeviceStatusEnum.DeviceConnecting);

        // Start polling immediately
        void this.safePoll();
        this.interval = setInterval(
          () => void this.safePoll(),
          this.fetchInterval,
        );
      },
      cancel: () => {
        if (this.interval) {
          clearInterval(this.interval);
        }
        this.interval = undefined;
      },
    });
  }

  /** Poll `/api/v1/fromradio` and enqueue incoming packets. */
  private async readFromRadio(): Promise<void> {
    let readBuffer = new ArrayBuffer(1);

    while (readBuffer.byteLength > 0) {
      const inflight = new AbortController();
      this.inflightReadController = inflight;

      const signal = AbortSignal.any([
        inflight.signal,
        AbortSignal.timeout(READ_TIMEOUT_MS),
      ]);

      try {
        const query = this.framedBatch
          ? "all=true&framed=1"
          : `all=${this.receiveBatchRequests ? "true" : "false"}`;
        const response = await fetch(
          `${this.url}/api/v1/fromradio?${query}`,
          withLocalNetworkTarget(this.url, {
            method: "GET",
            headers: { Accept: "application/x-protobuf" },
            signal,
          }),
        );
        if (!response.ok) {
          throw new Error(
            `fromradio ${response.status} ${response.statusText}`,
          );
        }

        this.emitStatus(DeviceStatusEnum.DeviceConnected);

        readBuffer = await response.arrayBuffer();

        if (readBuffer.byteLength > 0) {
          if (this.framedBatch) {
            // ONE BODY, MANY FRAMES. Split on StreamAPI framing and enqueue each
            // separately, because the decoder parses exactly one FromRadio per chunk
            // (`fromBinary(FromRadioSchema, chunk.data)`) — handing it a concatenation
            // would merge every message into one and, the payload being a `oneof`, leave
            // only the last. That is why `all=true` has never been usable.
            const frames = deframeStreamApi(new Uint8Array(readBuffer));
            if (frames === null) {
              // NOT FRAMED: the peer does not speak this, so stop asking and let the
              // next poll fall back to one frame per request. Degrading beats failing,
              // and this is the only way a caller finds out — the parameter is ours, not
              // the device API's, so an older gateway simply ignores it.
              this.framedBatch = false;
              this.fromDeviceController?.enqueue({
                type: "packet",
                data: new Uint8Array(readBuffer),
              });
            } else {
              for (const frame of frames) {
                this.fromDeviceController?.enqueue({
                  type: "packet",
                  data: frame,
                });
              }
            }
          } else {
            this.fromDeviceController?.enqueue({
              type: "packet",
              data: new Uint8Array(readBuffer),
            });
          }
        }
      } finally {
        this.inflightReadController = undefined;
      }
    }
  }

  /** Write a protobuf-encoded request to `/api/v1/toradio`. */
  private async writeToRadio(data: Uint8Array): Promise<void> {
    try {
      const response = await fetch(
        `${this.url}/api/v1/toradio`,
        withLocalNetworkTarget(this.url, {
          method: "PUT",
          headers: { "Content-Type": "application/x-protobuf" },
          body: toArrayBuffer(data),
          signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
        }),
      );
      if (!response.ok) {
        throw new Error(`toradio ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      if (!this.closingByUser) {
        this.emitStatus(
          DeviceStatusEnum.DeviceDisconnected,
          this.isTimeoutOrAbort(error) ? "write-timeout" : "write-error",
        );
        return;
      }
      throw error;
    }
  }

  /** Writable stream of bytes to the device. */
  get toDevice(): WritableStream<Uint8Array> {
    return this._toDevice;
  }

  /** Readable stream of {@link DeviceOutput} from the device. */
  get fromDevice(): ReadableStream<DeviceOutput> {
    return this._fromDevice;
  }

  /**
   * Stop polling and emit `DeviceDisconnected("user")`.
   */
  disconnect(): Promise<void> {
    this.closingByUser = true;

    if (this.interval) {
      clearInterval(this.interval);
    }
    this.interval = undefined;
    this.fetching = false;

    try {
      this.inflightReadController?.abort();
    } catch {}
    this.inflightReadController = undefined;

    this.emitStatus(DeviceStatusEnum.DeviceDisconnected, "user");

    return Promise.resolve();
  }

  private emitStatus(next: DeviceStatusEnum, reason?: string): void {
    if (next === this.lastStatus) {
      return;
    }
    this.lastStatus = next;
    this.fromDeviceController?.enqueue({
      type: "status",
      data: { status: next, reason },
    });
  }

  private isTimeoutOrAbort(err: unknown): boolean {
    return (
      (err instanceof DOMException &&
        (err.name === "AbortError" || err.name === "TimeoutError")) ||
      (err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError"))
    );
  }

  private async safePoll(): Promise<void> {
    if (this.fetching) {
      return;
    }
    this.fetching = true;
    try {
      await this.readFromRadio();
    } catch (error) {
      if (!this.closingByUser) {
        this.emitStatus(
          DeviceStatusEnum.DeviceDisconnected,
          this.isTimeoutOrAbort(error) ? "read-timeout" : "read-error",
        );
      }
    } finally {
      this.fetching = false;
    }
  }
}
