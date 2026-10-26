export function paginate<T>(items: T[], page: number, pageSize: number) {
  const size = Math.min(50, Math.max(1, Math.floor(pageSize) || 10));
  const current = Math.max(1, Math.floor(page) || 1);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const safePage = Math.min(current, pageCount);
  const start = (safePage - 1) * size;
  return {
    page: safePage,
    pageSize: size,
    total: items.length,
    pageCount,
    items: items.slice(start, start + size)
  };
}
