export function InfoField(props: { label: string; value: string }) {
  return (
    <div className="info-field">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
