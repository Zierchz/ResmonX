import { useMemo, useState, type CSSProperties } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import { useProcessMenu } from "@/components/process/ProcessMenu";
import { cn } from "@/lib/utils";
import type { CtxTarget } from "@/lib/types";

// Column meta: right-align, path ellipsis, and per-cell heatmap background.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    num?: boolean;
    path?: boolean;
    cellStyle?: (row: TData) => CSSProperties | undefined;
  }
}

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  initialSorting?: SortingState;
  // optional filter input: fn receives the row and the lowercased query
  filter?: { placeholder: string; fn: (row: T, q: string) => boolean };
  // rows that map to a process target get the right-click actions menu
  rowTarget?: (row: T) => CtxTarget | null;
  getRowId?: (row: T, index: number) => string;
}

export function DataTable<T>({
  data,
  columns,
  initialSorting,
  filter,
  rowTarget,
  getRowId,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? []);
  const [query, setQuery] = useState("");
  const openMenu = useProcessMenu();

  const filtered = useMemo(() => {
    if (!filter || !query.trim()) return data;
    const q = query.toLowerCase().trim();
    return data.filter((r) => filter.fn(r, q));
  }, [data, query, filter]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
  });

  return (
    <>
      {filter && (
        <Input
          className="mb-3 max-w-sm"
          placeholder={filter.placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="table-wrap">
        <table className="rx-table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={cn(canSort && "sortable")}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sorted && (
                        <span className="sort-ind">{sorted === "asc" ? " ▲" : " ▼"}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const cells = row.getVisibleCells().map((cell) => {
                const m = cell.column.columnDef.meta;
                return (
                  <td
                    key={cell.id}
                    className={cn(m?.num && "num", m?.path && "path")}
                    style={m?.cellStyle?.(row.original)}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              });
              const target = rowTarget ? rowTarget(row.original) : null;
              return (
                <tr
                  key={row.id}
                  className={cn(target && "cursor-pointer")}
                  onContextMenu={
                    target
                      ? (e) => {
                          e.preventDefault();
                          openMenu(e, target);
                        }
                      : undefined
                  }
                >
                  {cells}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
