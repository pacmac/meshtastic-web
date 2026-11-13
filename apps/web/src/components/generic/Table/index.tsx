import { cn } from "@core/utils/cn.ts";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import React, { useMemo, useState } from "react";

export interface Heading {
  /** What is shown. Translated, so never used to recognise the column. */
  title: string;
  /** Stable column key, e.g. "lastHeard". Falls back to `title` when absent. */
  id?: string;
  sortable: boolean;
}

const columnKey = (heading: Heading) => heading.id ?? heading.title;

// The columns the table treats specially, by `id` or — for headings that carry no id —
// by their English title.
const isLastHeard = (key: string) =>
  key === "lastHeard" || key === "Last Heard";
const isConnection = (key: string) =>
  key === "connection" || key === "Connection";

interface Cell {
  content: React.ReactNode;
  sortValue: string | number;
}

export interface DataRow {
  id: string | number;
  isFavorite?: boolean;
  /** Render the row faded, e.g. for a node not heard on the current LoRa settings. */
  isDimmed?: boolean;
  cells: Cell[];
}

export interface TableProps {
  headings: Heading[];
  rows: DataRow[];
}

function numericHops(hopsAway: string | number): number {
  if (typeof hopsAway === "number") {
    return hopsAway;
  }
  if (hopsAway.match(/direct/i)) {
    return 0;
  }
  const match = hopsAway.match(/(\d+)\s+hop/i);
  return Number(match?.[1] ?? Number.MAX_SAFE_INTEGER);
}

export const Table = ({ headings, rows }: TableProps) => {
  const [sortColumn, setSortColumn] = useState<string | null>(
    () => headings.map(columnKey).find(isLastHeard) ?? null,
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const handleSort = (key: string) => {
    if (sortColumn === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(key);
      setSortOrder("asc");
    }
  };

  const sortedRows = useMemo(() => {
    if (!sortColumn) {
      return rows;
    }

    const columnIndex = headings.findIndex((h) => columnKey(h) === sortColumn);
    if (columnIndex === -1) {
      return rows;
    }

    return [...rows].sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) {
        return a.isFavorite ? -1 : 1;
      }

      const aCell = a.cells[columnIndex];
      const bCell = b.cells[columnIndex];
      if (!aCell || !bCell) return 0;

      let aValue: string | number;
      let bValue: string | number;

      if (isConnection(sortColumn)) {
        aValue = numericHops(aCell.sortValue);
        bValue = numericHops(bCell.sortValue);
      } else {
        aValue = aCell.sortValue;
        bValue = bCell.sortValue;
      }

      if (aValue < bValue) {
        return sortOrder === "asc" ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortOrder === "asc" ? 1 : -1;
      }
      return 0;
    });
  }, [rows, sortColumn, sortOrder, headings]);

  return (
    <table className="min-w-full" style={{ contentVisibility: "auto" }}>
      <thead className="text-xs font-semibold">
        <tr>
          {headings.map((heading) => (
            <th
              key={heading.title}
              scope="col"
              className={cn(
                "py-2 pr-3 text-left",
                heading.sortable &&
                  "cursor-pointer hover:brightness-hover active:brightness-press",
              )}
              onClick={() => heading.sortable && handleSort(columnKey(heading))}
              onKeyUp={(e) => {
                if (heading.sortable && (e.key === "Enter" || e.key === " ")) {
                  handleSort(columnKey(heading));
                }
              }}
              tabIndex={heading.sortable ? 0 : -1}
              aria-sort={
                sortColumn === columnKey(heading)
                  ? sortOrder === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <div className="flex items-center gap-2">
                {heading.title}
                {heading.sortable &&
                  sortColumn === columnKey(heading) &&
                  (sortOrder === "asc" ? (
                    <ChevronUpIcon size={16} aria-hidden="true" />
                  ) : (
                    <ChevronDownIcon size={16} aria-hidden="true" />
                  ))}
              </div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="max-w-fit">
        {sortedRows.map((row) => (
          <tr
            key={row.id}
            className={cn(
              row.isFavorite
                ? "bg-yellow-100/30 dark:bg-slate-800 odd:bg-yellow-200/30 dark:odd:bg-slate-600/40"
                : "bg-white dark:bg-slate-900 odd:bg-slate-200/40 dark:odd:bg-slate-800/40",
              row.isDimmed && "opacity-60",
            )}
          >
            {row.cells.map((cell, cellIndex) => {
              const key = `${row.id}_${cellIndex}`;
              const isFirstCell = cellIndex === 0;

              const cellElement = isFirstCell ? (
                <th
                  className="whitespace-nowrap px-3 py-2 text-sm text-left text-text-secondary"
                  scope="row"
                >
                  {cell.content}
                </th>
              ) : (
                <td className="whitespace-nowrap px-3 py-2 text-sm text-text-secondary">
                  {cell.content}
                </td>
              );

              return React.cloneElement(cellElement, { key });
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
};
