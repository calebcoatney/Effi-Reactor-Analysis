interface Props {
  cycleId: number;
  totalCycles: number;
  onChange: (id: number) => void;
}

export default function CycleNavigator({
  cycleId,
  totalCycles,
  onChange,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        margin: "12px 0",
      }}
    >
      <button
        onClick={() => onChange(cycleId - 1)}
        disabled={cycleId <= 1}
      >
        ◀ Prev
      </button>
      <span>
        Cycle{" "}
        <select
          value={cycleId}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {Array.from({ length: totalCycles }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>{" "}
        / {totalCycles}
      </span>
      <button
        onClick={() => onChange(cycleId + 1)}
        disabled={cycleId >= totalCycles}
      >
        Next ▶
      </button>
    </div>
  );
}
