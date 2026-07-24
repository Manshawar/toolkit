const COLORS = [
  '#1a5f7a',
  '#e8a87c',
  '#2a9d8f',
  '#457b9d',
  '#e76f51',
  '#6d597a',
  '#4a6fa5',
  '#bc6c25',
]

export function PieChart({
  slices,
  size = 180,
}: {
  slices: Array<{ name: string; value: number }>
  size?: number
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1
  let angle = -90
  const paths = slices.map((s, i) => {
    const portion = (s.value / total) * 360
    const start = angle
    angle += portion
    return {
      ...s,
      color: COLORS[i % COLORS.length]!,
      d: describeArc(size / 2, size / 2, size / 2 - 4, start, angle),
      pct: Math.round((s.value / total) * 1000) / 10,
    }
  })

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        {paths.length === 1 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={size / 2 - 4}
            fill={paths[0]!.color}
          />
        ) : (
          paths.map((p) => (
            <path key={p.name} d={p.d} fill={p.color}>
              <title>
                {p.name}: {p.value}h ({p.pct}%)
              </title>
            </path>
          ))
        )}
        <circle cx={size / 2} cy={size / 2} r={size * 0.28} fill="var(--color-card)" />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground"
          style={{ fontSize: 14, fontWeight: 700 }}
        >
          {Math.round(total * 10) / 10}h
        </text>
      </svg>
      <ul className="w-full space-y-2 text-sm">
        {paths.map((p) => (
          <li key={p.name} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: p.color }}
            />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="tabular-nums text-muted">
              {p.value}h · {p.pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
) {
  const start = polar(cx, cy, r, endAngle)
  const end = polar(cx, cy, r, startAngle)
  const large = endAngle - startAngle > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${end.x} ${end.y} A ${r} ${r} 0 ${large} 1 ${start.x} ${start.y} Z`
}
