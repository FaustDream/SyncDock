export function NavButton(props: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return (
    <button className={`nav-button ${props.active ? "active" : ""}`} onClick={props.onClick}>
      <span className="nav-icon" aria-hidden="true">{props.icon}</span>
      <strong>{props.label}</strong>
    </button>
  );
}

export function TabBar(props: {
  items: Array<{ key: string; label: string }>;
  activeKey: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="tab-bar" role="tablist">
      {props.items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={props.activeKey === item.key}
          className={`tab-button ${props.activeKey === item.key ? "active" : ""}`}
          onClick={() => props.onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
