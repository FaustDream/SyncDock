export function EmptyState(props: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <strong>{props.title}</strong>
      <p>{props.description}</p>
    </div>
  );
}
