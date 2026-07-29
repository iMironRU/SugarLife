import type { Stats } from '../data/agp';

const ZONES = [
  { key: 'veryHigh', label: 'Очень высоко', range: '> 13,9', color: '#b8792f' },
  { key: 'high', label: 'Высоко', range: '10,0–13,9', color: 'var(--c-carb)' },
  { key: 'target', label: 'В диапазоне', range: '3,9–10,0', color: 'var(--c-glu)' },
  { key: 'low', label: 'Низко', range: '3,0–3,9', color: 'var(--c-danger)' },
  { key: 'veryLow', label: 'Очень низко', range: '< 3,0', color: '#8f2b3a' },
] as const;

export default function TirBar({ s }: { s: Stats }) {
  return (
    <div className="tir">
      <div className="tir-bar">
        {ZONES.map((z) => {
          const pct = (s as any)[z.key] as number;
          return <div key={z.key} className="tir-seg" style={{ height: `${pct}%`, background: z.color }} title={`${z.label} ${Math.round(pct)}%`} />;
        })}
      </div>
      <div className="tir-legend">
        {ZONES.map((z) => {
          const pct = (s as any)[z.key] as number;
          return (
            <div key={z.key} className="tir-row">
              <span className="tir-dot" style={{ background: z.color }} />
              <span className="tir-name">{z.label}</span>
              <span className="tir-range">{z.range}</span>
              <span className="tir-pct">{Math.round(pct)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
