import type { ReactNode } from 'react';
import { cn } from './lib/cn';
import { EmptyState } from './primitives';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
}

const alignClass = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const;

/**
 * Server-safe table: callers pass data and render functions, so it must not be
 * a Client Component.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  emptyMessage = 'Nothing here yet.',
  caption,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyMessage?: string;
  caption?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyMessage} />;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      {caption ? (
        <div className="border-b border-border bg-subtle px-4 py-3 text-left text-xs font-medium text-muted-foreground">
          {caption}
        </div>
      ) : null}
      <table aria-label={caption} className="w-full text-sm max-sm:block">
        <thead className="bg-subtle max-sm:hidden">
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={{ width: column.width }}
                className={cn(
                  'type-overline px-4 py-3 text-muted-foreground',
                  alignClass[column.align ?? 'left'],
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {rows.map((row) => (
            <tr
              key={getRowKey(row)}
              className="border-b border-border transition-colors last:border-0 hover:bg-muted/40 max-sm:block max-sm:border-b max-sm:px-4 max-sm:py-2"
            >
              {columns.map((column, index) => (
                <td
                  key={column.key}
                  data-label={column.header}
                  className={cn(
                    'px-4 py-3 align-middle',
                    alignClass[column.align ?? 'left'],
                    'max-sm:flex max-sm:items-baseline max-sm:justify-between max-sm:gap-4 max-sm:px-0 max-sm:py-1 max-sm:text-right',
                    'max-sm:before:shrink-0 max-sm:before:text-left max-sm:before:content-[attr(data-label)] max-sm:before:text-[0.7rem] max-sm:before:font-semibold max-sm:before:uppercase max-sm:before:tracking-wide max-sm:before:text-muted-foreground',
                    index === 0
                      ? 'max-sm:block max-sm:pt-3 max-sm:text-left max-sm:font-semibold max-sm:before:hidden'
                      : null,
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
