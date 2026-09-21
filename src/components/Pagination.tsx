import Link from 'next/link';

export function Pagination({
  href,
  nextCursor,
  label = 'Następna strona',
}: {
  href: string;
  nextCursor: string | null;
  label?: string;
}) {
  if (!nextCursor) return null;
  const separator = href.includes('?') ? '&' : '?';
  return (
    <nav aria-label="Paginacja" className="pagination">
      <Link className="button secondary" href={`${href}${separator}cursor=${encodeURIComponent(nextCursor)}`}>
        {label}
      </Link>
    </nav>
  );
}
