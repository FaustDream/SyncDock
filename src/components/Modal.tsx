import type { ReactNode } from "react";

export function Modal(props: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!props.open) {
    return null;
  }
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <h3>{props.title}</h3>
          </div>
          <button className="ghost-button" onClick={props.onClose}>关闭</button>
        </div>
        {props.children}
      </div>
    </div>
  );
}
