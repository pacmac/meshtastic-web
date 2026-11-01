import type { Protobuf } from "@meshtastic/sdk";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NodeCards } from "./NodeCards.tsx";

// Avatar reads the SDK node store; the cards test is about layout and order.
vi.mock("@components/UI/Avatar.tsx", () => ({
  Avatar: () => <span data-testid="avatar" />,
}));

const node = (
  num: number,
  longName: string,
  over: Record<string, unknown> = {},
) =>
  ({
    num,
    lastHeard: 0,
    isFavorite: false,
    heardOnCurrentLora: true,
    viaMqtt: false,
    user: { shortName: longName.slice(0, 4), longName },
    ...over,
  }) as unknown as Protobuf.Mesh.NodeInfo;

const names = () =>
  screen
    .getAllByRole("listitem")
    .map((li) => within(li).getByRole("button").textContent);

const renderCards = (nodes: Protobuf.Mesh.NodeInfo[], onOpen = vi.fn()) =>
  render(
    <NodeCards nodes={nodes} hasNodeError={() => false} onOpen={onOpen} />,
  );

describe("NodeCards", () => {
  it("renders one card per node, newest heard first by default", () => {
    renderCards([
      node(1, "Alpha", { lastHeard: 100 }),
      node(2, "Bravo", { lastHeard: 300 }),
      node(3, "Charlie", { lastHeard: 200 }),
    ]);
    expect(names()).toEqual(["Bravo", "Charlie", "Alpha"]);
  });

  it("re-sorts by name when asked", async () => {
    renderCards([
      node(1, "Alpha", { lastHeard: 100 }),
      node(2, "Bravo", { lastHeard: 300 }),
      node(3, "Charlie", { lastHeard: 200 }),
    ]);
    await userEvent.selectOptions(screen.getByLabelText("Sort by"), "name");
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("keeps favourites first whatever the sort", async () => {
    renderCards([
      node(1, "Alpha", { lastHeard: 300 }),
      node(2, "Zulu", { lastHeard: 100, isFavorite: true }),
    ]);
    expect(names()).toEqual(["Zulu", "Alpha"]);
    await userEvent.selectOptions(screen.getByLabelText("Sort by"), "name");
    expect(names()).toEqual(["Zulu", "Alpha"]);
  });

  it("fades a LoRa node the radio has not heard on its current settings", () => {
    renderCards([
      node(1, "Quiet", { heardOnCurrentLora: false }),
      node(2, "Loud", { heardOnCurrentLora: true }),
    ]);
    const items = screen.getAllByRole("listitem");
    const quiet = items.find((li) => li.textContent?.includes("Quiet"));
    const loud = items.find((li) => li.textContent?.includes("Loud"));
    expect(quiet).toHaveClass("opacity-60");
    expect(loud).not.toHaveClass("opacity-60");
  });

  it("opens the node's details when its name is pressed", async () => {
    const onOpen = vi.fn();
    renderCards([node(42, "Alpha")], onOpen);
    await userEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(onOpen).toHaveBeenCalledWith(42);
  });

  it("renders nothing but an empty list for no nodes", () => {
    renderCards([]);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
