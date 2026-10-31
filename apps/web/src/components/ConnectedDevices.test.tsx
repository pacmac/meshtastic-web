import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectedDevices } from "./ConnectedDevices.tsx";

/* THREE THINGS NAME THE CURRENT RADIO, and the bug was that a switch moved two.
 *
 * So these assert all three on one click. Asserting only the two that always worked is
 * what let the defect ship: the component rendered, the highlight followed the click,
 * the node list followed the click, and the firmware line quietly described the other
 * radio. See docs/switching-radios-moves-three-things.md. */

const setActive = vi.fn();
const setActiveId = vi.fn();
const setSelectedDevice = vi.fn();

let connections: Array<Record<string, unknown>> = [];
let activeId: number | undefined;

vi.mock("@app/core/meshRegistry.ts", () => ({
  meshRegistry: {
    setActive: (id: number) => setActive(id),
  },
}));

vi.mock("@app/core/stores", () => ({
  useAppStore: (sel: (s: unknown) => unknown) => sel({ setSelectedDevice }),
}));

vi.mock("@app/core/stores/deviceStore/selectors.ts", () => ({
  useSavedConnections: () => connections,
  useActiveConnectionId: () => activeId,
  useSetActiveConnectionId: () => setActiveId,
}));

const conn = (over: Record<string, unknown> = {}) => ({
  id: 1,
  type: "http",
  name: "OMNI",
  url: "https://omni.example",
  createdAt: 0,
  status: "configured",
  meshDeviceId: 111,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  connections = [];
  activeId = undefined;
});

describe("ConnectedDevices", () => {
  it("renders nothing when there is nothing to choose between", () => {
    // One live connection is what the device panel below already shows, and an empty
    // bordered box above it reads as a fault.
    connections = [conn()];
    const { container } = render(<ConnectedDevices isCollapsed={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("ignores connections that are not live", () => {
    connections = [conn(), conn({ id: 2, name: "YAGI", status: "error" })];
    const { container } = render(<ConnectedDevices isCollapsed={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("moves the client, the highlight AND the legacy device on one click", async () => {
    connections = [conn(), conn({ id: 2, name: "YAGI", meshDeviceId: 222 })];
    activeId = 1;
    render(<ConnectedDevices isCollapsed={false} />);

    await userEvent.click(screen.getByRole("button", { name: /YAGI/ }));

    expect(setActive).toHaveBeenCalledWith(2);
    expect(setActiveId).toHaveBeenCalledWith(2);
    // The one that was missing. 222, not 2: selectedDeviceId is the legacy per-device
    // store key, which is the connection's meshDeviceId and not its id.
    expect(setSelectedDevice).toHaveBeenCalledWith(222);
  });

  it("leaves the selected device alone when a connection has no meshDeviceId", async () => {
    // App renders the Connections SCREEN when getDevice(selectedDeviceId) is falsy, so
    // writing an absent id would drop the whole app to the connection list.
    connections = [
      conn(),
      conn({ id: 2, name: "YAGI", meshDeviceId: undefined }),
    ];
    activeId = 1;
    render(<ConnectedDevices isCollapsed={false} />);

    await userEvent.click(screen.getByRole("button", { name: /YAGI/ }));

    expect(setActive).toHaveBeenCalledWith(2);
    expect(setActiveId).toHaveBeenCalledWith(2);
    expect(setSelectedDevice).not.toHaveBeenCalled();
  });

  it("marks the active radio for assistive technology", async () => {
    connections = [conn(), conn({ id: 2, name: "YAGI", meshDeviceId: 222 })];
    activeId = 1;
    render(<ConnectedDevices isCollapsed={false} />);

    expect(screen.getByRole("button", { name: /OMNI/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: /YAGI/ })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
