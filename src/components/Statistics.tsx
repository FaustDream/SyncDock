import type { RepoTone } from "../types";

export function SummaryPill(props: { label: string; value: number | string; tone: RepoTone }) {
  return (
    <div className={`summary-pill ${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
