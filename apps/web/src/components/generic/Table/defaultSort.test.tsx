import { Table } from "@components/generic/Table/index.tsx";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// @ts-types="react"

// The headings are translated, so the table must not recognise its columns by their
// English title. `id` is the stable key; `title` is only what is shown.
const germanHeadings = [
  { id: "longName", title: "Name", sortable: true },
  { id: "connection", title: "Verbindung", sortable: true },
  { id: "lastHeard", title: "Zuletzt gehört", sortable: true },
];

const rows = [
  {
    id: "a",
    cells: [
      { content: "A", sortValue: "A" },
      { content: "10 hops away", sortValue: "10 hops away" },
      { content: "1", sortValue: 1 },
    ],
  },
  {
    id: "b",
    cells: [
      { content: "B", sortValue: "B" },
      { content: "Direct", sortValue: "Direct" },
      { content: "3", sortValue: 3 },
    ],
  },
  {
    id: "c",
    cells: [
      { content: "C", sortValue: "C" },
      { content: "2 hops away", sortValue: "2 hops away" },
      { content: "2", sortValue: 2 },
    ],
  },
];

const firstCellOrder = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.querySelector("th")?.textContent);

describe("Table with translated headings", () => {
  it("sorts by last heard, newest first, on first render", () => {
    render(<Table headings={germanHeadings} rows={rows} />);
    expect(firstCellOrder()).toEqual(["B", "C", "A"]);
    expect(
      screen.getByRole("columnheader", { name: "Zuletzt gehört" }),
    ).toHaveAttribute("aria-sort", "descending");
  });

  it("sorts the connection column by hop count, not as text", () => {
    render(<Table headings={germanHeadings} rows={rows} />);
    fireEvent.click(screen.getByRole("columnheader", { name: "Verbindung" }));
    expect(firstCellOrder()).toEqual(["B", "C", "A"]);
  });
});
