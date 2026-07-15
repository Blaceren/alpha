"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import type { UserSummary } from "@/domain/users/user";
import type { UserSortField } from "@/data/contracts/CrmDataProvider";
import { USERS_COLUMNS, type UsersColumnMeta } from "./columns/columns";
import { MobileUserCard } from "./components/mobile-user-card";

export interface UsersTableProps {
  users: UserSummary[];
  columnVisibility: VisibilityState;
  sort: { field: UserSortField; dir: "asc" | "desc" };
  onSort: (field: UserSortField) => void;
}

export function UsersTable({ users, columnVisibility, sort, onSort }: UsersTableProps) {
  const table = useReactTable({
    data: users,
    columns: USERS_COLUMNS,
    state: { columnVisibility },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
  });

  return (
    <>
      {/* Desktop / tablet: semantic table */}
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="border-b border-border bg-surface">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const cmeta = header.column.columnDef.meta as UsersColumnMeta | undefined;
                  const sortField = cmeta?.sortField;
                  const active = sortField && sort.field === sortField;
                  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={sortField ? (ariaSort as "ascending" | "descending" | "none") : undefined}
                      className={cn(
                        "px-2 py-2 align-bottom text-2xs font-semibold uppercase tracking-wide text-text-muted",
                        cmeta?.hideOnTablet && "hidden xl:table-cell",
                      )}
                    >
                      {sortField ? (
                        <button
                          type="button"
                          onClick={() => onSort(sortField)}
                          className="inline-flex items-start gap-1 rounded text-left hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {active ? (
                            sort.dir === "asc" ? (
                              <ChevronUp className="h-3 w-3" aria-hidden />
                            ) : (
                              <ChevronDown className="h-3 w-3" aria-hidden />
                            )
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-50" aria-hidden />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0 hover:bg-row-hover">
                {row.getVisibleCells().map((cell) => {
                  const cmeta = cell.column.columnDef.meta as UsersColumnMeta | undefined;
                  return (
                    <td
                      key={cell.id}
                      className={cn("px-2 py-2 align-middle", cmeta?.hideOnTablet && "hidden xl:table-cell")}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: card list with the same data */}
      <div className="space-y-2 md:hidden" role="list" aria-label="Пользователи">
        {users.map((u) => (
          <div key={u.id} role="listitem">
            <MobileUserCard user={u} />
          </div>
        ))}
      </div>
    </>
  );
}
