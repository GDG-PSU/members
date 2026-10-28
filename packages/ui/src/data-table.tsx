import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import type { ReactNode } from 'react';
import { EmptyState } from './primitives';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
}

/**
 * Server-safe table: callers pass data and render functions, so it must not be
 * a Client Component. The MUI primitives it renders remain client components.
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
    <TableContainer
      sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 3 }}
    >
      <Table size="small" aria-label={caption}>
        {caption ? (
          <caption style={{ captionSide: 'top', textAlign: 'left' }}>{caption}</caption>
        ) : null}
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell key={column.key} align={column.align} sx={{ width: column.width }}>
                {column.header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={getRowKey(row)} hover>
              {columns.map((column) => (
                <TableCell key={column.key} align={column.align}>
                  {column.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
