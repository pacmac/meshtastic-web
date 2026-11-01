import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useNodesView } from "./useNodesView.ts";

describe("useNodesView", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to the list", () => {
    const { result } = renderHook(() => useNodesView());
    expect(result.current[0]).toBe("list");
  });

  it("remembers cards across a fresh mount", () => {
    const first = renderHook(() => useNodesView());
    act(() => first.result.current[1]("cards"));
    expect(first.result.current[0]).toBe("cards");
    first.unmount();

    const second = renderHook(() => useNodesView());
    expect(second.result.current[0]).toBe("cards");
  });

  it("reads anything that is not list or cards as list", () => {
    localStorage.setItem("nodesView", JSON.stringify("grid"));
    const { result } = renderHook(() => useNodesView());
    expect(result.current[0]).toBe("list");
  });

  it("reads unparseable stored text as list", () => {
    localStorage.setItem("nodesView", "{not json");
    const { result } = renderHook(() => useNodesView());
    expect(result.current[0]).toBe("list");
  });
});
