import type { Stats } from '@/domain/agp';
import { useUnit } from '@/domain/units';

const RANGES = {
  mmol: ['> 13,9', '10,0–13,9', '3,9–10,0', '3,0–3,9', '< 3,0'],
  mgdl: ['> 250', '180–250', '70–180', '54–70', '< 54'],
} as const;

const ZONES = [
  { key: 'veryHigh', label: 'Очень высоко', color: '#b8792f' },
  { key: 'high', label: 'Высоко', color: 'var(--c-carb)' },
  { key: 'target', label: 'В диапазоне', color: 'var(--c-glu)' },
  { key: 'low', label: 'Низко', color: 'var(--c-danger)' },
  { key: 'veryLow', label: 'Очень низко', color: '#8f2b3a' },
] as const;

export default function TirBar({ s }: { s: Stats }) {
  const unit = useUnit();
  const ranges = RANGES[unit];
  return (
    <div className="tir">
      <div className="tir-bar">
        {ZONES.map((z) => {
          const pct = (s as any)[z.key] as number;
          return <div key={z.key} className="tir-seg" style={{ height: `${pct}%`, background: z.color }} title={`${z.label} ${Math.round(pct)}%`} />;
        })}
      </div>
      <div className="tir-legend">
        {ZONES.map((z, i) => {
          const pct = (s as any)[z.key] as number;
          return (
            <div key={z.key} className="tir-row">
              <span className="tir-dot" style={{ background: z.color }} />
              <span className="tir-name">{z.label}</span>
              <span className="tir-range">{ranges[i]}</span>
              <span className="tir-pct">{Math.round(pct)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
