import { useMemo } from 'preact/hooks'
import { escapeHtml } from '@web/lib/api'

type Probe = { at: string; points: Array<{ model: string; totalSec: number }> }

export function LatencyChart({
  probes,
  selected,
  colors,
}: {
  probes: Probe[]
  selected: string[]
  colors: string[]
}) {
  const { svgHtml, legend } = useMemo(() => {
    if (!probes?.length) {
      return {
        svgHtml: '<text x="20" y="140" fill="#5c6775" font-size="14">暂无数据</text>',
        legend: [] as Array<{ model: string; color: string }>,
      }
    }
    const modelSet = new Set<string>()
    for (const p of probes) for (const pt of p.points || []) modelSet.add(pt.model)
    let models = selected.filter((m) => modelSet.has(m))
    if (!models.length) models = [...modelSet]
    models = models.slice(0, 10)

    const series = models.map((model) => ({
      model,
      ys: probes.map((probe) => {
        const hit = (probe.points || []).find((x) => x.model === model)
        return hit ? hit.totalSec : null
      }),
    }))

    const allY = series.flatMap((s) => s.ys.filter((v): v is number => v != null))
    const yMin = allY.length ? Math.min(...allY) : 0
    const yMax = allY.length ? Math.max(...allY) : 1
    const pad = (yMax - yMin) * 0.08 || 0.1
    const lo = Math.max(0, yMin - pad)
    const hi = yMax + pad
    const W = 900
    const H = 280
    const L = 48
    const R = 16
    const T = 16
    const B = 36
    const iw = W - L - R
    const ih = H - T - B
    const n = probes.length
    const xAt = (i: number) => L + (n === 1 ? iw / 2 : (i / (n - 1)) * iw)
    const yAt = (v: number) => T + ih - ((v - lo) / (hi - lo || 1)) * ih

    let html = ''
    for (let g = 0; g <= 4; g++) {
      const y = T + (ih * g) / 4
      const val = hi - ((hi - lo) * g) / 4
      html += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="#d3dbe5" />`
      html += `<text x="${L - 6}" y="${y + 4}" text-anchor="end" fill="#5c6775" font-size="11">${val.toFixed(1)}</text>`
    }
    const labelIdx = n === 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 2), n - 1]
    for (const i of labelIdx) {
      const t = probes[i]?.at || ''
      const short = t.slice(11, 16) || t.slice(0, 10)
      html += `<text x="${xAt(i)}" y="${H - 10}" text-anchor="middle" fill="#5c6775" font-size="11">${escapeHtml(short)}</text>`
    }

    const legendItems: Array<{ model: string; color: string }> = []
    series.forEach((s, si) => {
      const color = colors[si % colors.length]!
      legendItems.push({ model: s.model, color })
      const parts: string[] = []
      let started = false
      s.ys.forEach((v, i) => {
        if (v == null) {
          started = false
          return
        }
        parts.push(`${started ? 'L' : 'M'} ${xAt(i)} ${yAt(v)}`)
        started = true
        html += `<circle cx="${xAt(i)}" cy="${yAt(v)}" r="4" fill="${color}" stroke="#fff" stroke-width="1" />`
      })
      if (parts.length) {
        html += `<path d="${parts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />`
      }
    })
    html += '<text x="8" y="14" fill="#5c6775" font-size="11">总耗时 (s)</text>'
    return { svgHtml: html, legend: legendItems }
  }, [probes, selected, colors])

  return (
    <div class="mt-1">
      <div class="overflow-x-auto rounded-xl border border-border/70 bg-white/90">
        <svg
          viewBox="0 0 900 280"
          preserveAspectRatio="none"
          class="block h-[280px] w-full min-w-[640px]"
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      </div>
      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
        {legend.map((l) => (
          <span key={l.model} class="inline-flex items-center gap-1.5">
            <i class="inline-block h-1.5 w-3.5 rounded-sm" style={{ background: l.color }} />
            {l.model}
          </span>
        ))}
      </div>
    </div>
  )
}
