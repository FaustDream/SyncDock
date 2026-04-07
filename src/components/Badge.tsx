import type { RepoTone } from "../types";

export function Badge(props: { tone: RepoTone; text: string }) {
  return <span className={`badge ${props.tone}`}>{props.text}</span>;
}
