export function SourceLink({ href, origin }: { href: string; origin: string }) {
  if (origin === 'fixture' || href.startsWith('fixture:')) {
    return <span className="meta">Demo record. This is not a Reddit link.</span>;
  }
  return (
    <a href={href} target="_blank" rel="noreferrer">
      Open on Reddit
    </a>
  );
}
