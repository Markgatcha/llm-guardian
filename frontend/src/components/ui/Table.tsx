import {
  forwardRef,
  type HTMLAttributes,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  stripedRows?: boolean;
}

export const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, stripedRows = false, ...props }, ref) => (
    <div className="w-full overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/40">
      <table
        ref={ref}
        className={cn(
          "w-full caption-bottom text-sm text-slate-200",
          stripedRows ? "[&_tbody_tr:nth-child(odd)]:bg-slate-900/35" : "",
          className
        )}
        {...props}
      />
    </div>
  )
);

Table.displayName = "Table";

export const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn("bg-slate-900/80 text-slate-400", className)} {...props} />
  )
);

TableHeader.displayName = "TableHeader";

export const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("divide-y divide-slate-800", className)} {...props} />
  )
);

TableBody.displayName = "TableBody";

export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr ref={ref} className={cn("transition-colors hover:bg-slate-900/60", className)} {...props} />
  )
);

TableRow.displayName = "TableRow";

export const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400",
        className
      )}
      {...props}
    />
  )
);

TableHead.displayName = "TableHead";

export const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn("px-4 py-4 align-middle text-slate-200", className)} {...props} />
  )
);

TableCell.displayName = "TableCell";
