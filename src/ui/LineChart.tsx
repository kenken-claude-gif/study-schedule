import { useRef, useState } from 'react';
import type { ScorePoint } from '../domain/scores.ts';

export interface ChartSeries {
  name: string;
  /** 1〜4（色の枠）。選んだ教科ごとに固定して、ほかの教科を外しても色が変わらないようにする */
  slot: number;
}

const W = 360;
const H = 230;
const PAD = { top: 12, right: 76, bottom: 28, left: 34 };
const LABEL_GAP = 13;

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
}

/** 線の端の教科名が重ならないよう、上下に少しずつずらす */
function spreadLabels(ys: { name: string; y: number }[]): Map<string, number> {
  const sorted = [...ys].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - sorted[i - 1].y < LABEL_GAP) sorted[i].y = sorted[i - 1].y + LABEL_GAP;
  }
  return new Map(sorted.map((s) => [s.name, s.y]));
}

/**
 * 回ごとの点数の折れ線グラフ。縦軸は1本だけ（単位の違う値は混ぜない）。
 * タップ（マウスを乗せる）と、その回の値が出る
 */
export function LineChart(props: {
  points: ScorePoint[];
  series: ChartSeries[];
  yMin: number;
  yMax: number;
  unit: string;
}) {
  const { points, series, yMin, yMax, unit } = props;
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (plotW * i) / (points.length - 1));
  const y = (v: number) => PAD.top + plotH * (1 - (v - yMin) / Math.max(1, yMax - yMin));
  // 目盛りはきりのいい数字（幅が60までは10刻み、それより広ければ20刻み）
  const step = yMax - yMin <= 60 ? 10 : 20;
  const ticks: number[] = [];
  for (let t = yMin; t <= yMax; t += step) ticks.push(t);

  const pick = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };

  // 線の端（最後に値がある回）に教科名を直接書く
  const ends = series
    .map((s) => {
      let idx = -1;
      points.forEach((p, i) => {
        if (p.values[s.name] !== undefined) idx = i;
      });
      return idx < 0 ? null : { name: s.name, y: y(points[idx].values[s.name]), idx };
    })
    .filter((e): e is { name: string; y: number; idx: number } => e !== null);
  const labelY = spreadLabels(ends);

  const hp = hover !== null ? points[hover] : null;
  const tipLeft = hover !== null ? (x(hover) / W) * 100 : 0;

  return (
    <div className="chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="成績の推移グラフ"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={t === yMin ? 'axis' : 'grid'} />
            <text x={PAD.left - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <text key={p.id} x={x(i)} y={H - 8} className="tick" textAnchor="middle">
            {shortDate(p.date)}
          </text>
        ))}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} className="crosshair" />
        )}
        {series.map((s) => {
          // 値がない回では線を切る（つないで嘘の傾きを作らない）
          const segs: string[] = [];
          let cur: string[] = [];
          points.forEach((p, i) => {
            const v = p.values[s.name];
            if (v === undefined) {
              if (cur.length > 1) segs.push(cur.join(' '));
              cur = [];
            } else {
              cur.push(`${x(i)},${y(v)}`);
            }
          });
          if (cur.length > 1) segs.push(cur.join(' '));
          return (
            <g key={s.name} style={{ color: `var(--series-${s.slot})` }}>
              {segs.map((d) => (
                <polyline key={d} points={d} className="line" />
              ))}
              {points.map((p, i) =>
                p.values[s.name] === undefined ? null : (
                  <circle
                    key={p.id}
                    cx={x(i)}
                    cy={y(p.values[s.name])}
                    r={hover === i ? 5 : 4}
                    className="dot-mark"
                  />
                ),
              )}
            </g>
          );
        })}
        {ends.map((e) => {
          const s = series.find((x) => x.name === e.name)!;
          const ly = labelY.get(e.name) ?? e.y;
          return (
            <g key={e.name}>
              <circle cx={W - PAD.right + 8} cy={ly} r={3.5} style={{ fill: `var(--series-${s.slot})` }} />
              <text x={W - PAD.right + 15} y={ly} className="end-label" dominantBaseline="middle">
                {e.name.length > 6 ? `${e.name.slice(0, 6)}…` : e.name}
              </text>
            </g>
          );
        })}
      </svg>
      {hp && (
        // 右半分の点では吹き出しを左側に出して、線の端の教科名に重ねない
        <div
          className="chart-tip"
          style={tipLeft > 50 ? { right: `${100 - tipLeft + 3}%` } : { left: `${tipLeft + 3}%` }}
        >
          <div className="tip-title">{hp.label}</div>
          {series.map((s) =>
            hp.values[s.name] === undefined ? null : (
              <div key={s.name} className="tip-row">
                <span className="dot" style={{ background: `var(--series-${s.slot})` }} />
                <span className="tip-name">{s.name}</span>
                <b>
                  {hp.values[s.name]}
                  {unit}
                </b>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
