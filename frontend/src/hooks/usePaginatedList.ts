import { useMemo, useState } from 'react';

// Client-side pagination for lists already fetched in full (small master
// tables: Users, Roles, Approval Levels, Categories, Units, Vendors). Resets
// to page 1 whenever the underlying list length changes (e.g. after a filter
// or a create/delete), so the view never gets stuck on an out-of-range page.
export function usePaginatedList<T>(items: T[], pageSize = 20) {
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  return { pageItems, page: safePage, totalPages, setPage };
}
