import { IonIcon } from '@ionic/react';
import {
  checkmarkCircle, informationCircle, warning, alertCircle,
  medkitOutline, pulseOutline, restaurantOutline, waterOutline, helpCircleOutline,
} from 'ionicons/icons';
import type { Analysis, Insight, Severity } from '../data/analysis';

const SEV_COLOR: Record<Severity, string> = {
  good: 'var(--c-glu)',
  info: 'var(--color-accent)',
  warn: 'var(--c-carb)',
  bad: 'var(--c-danger)',
};
const SEV_ICON: Record<Severity, string> = {
  good: checkmarkCircle, info: informationCircle, warn: warning, bad: alertCircle,
};
const KIND_ICON: Record<Insight['kind'], string> = {
  device: medkitOutline, data: pulseOutline, habit: restaurantOutline, glucose: waterOutline,
};

const READY = {
  ready: { label: 'Готов к Autotune', color: 'var(--c-glu)', desc: 'Данных достаточно и они полные — Autotune даст осмысленные рекомендации по базалу, ISF и углеводному коэффициенту.' },
  partial: { label: 'Частично готов', color: 'var(--c-carb)', desc: 'Autotune запустится, но к результатам относись осторожно — есть пробелы в данных.' },
  not: { label: 'Пока не готов', color: 'var(--c-danger)', desc: 'Сейчас Autotune выдаст недостоверный результат. Сначала стоит закрыть пробелы ниже.' },
};

export default function Insights({ analysis }: { analysis: Analysis | null }) {
  if (!analysis) {
    return <div className="metric-note" style={{ marginTop: 30 }}>Собираю аналитику…</div>;
  }
  const r = READY[analysis.readiness.level];

  return (
    <>
      {/* готовность к Autotune */}
      <div className="ready-card" style={{ borderColor: `color-mix(in srgb, ${r.color} 45%, transparent)` }}>
        <div className="ready-head">
          <span className="ready-dot" style={{ background: r.color }} />
          <span className="ready-label">{r.label}</span>
          <span className="ready-tag">Autotune</span>
        </div>
        <div className="ready-desc">{r.desc}</div>
        {analysis.readiness.reasons.length > 0 && (
          <div className="ready-reasons">
            {analysis.readiness.reasons.map((x, i) => (
              <div key={i} className="ready-reason"><IonIcon icon={alertCircle} /><span>{x}</span></div>
            ))}
          </div>
        )}
        <div className="ready-foot">Autotune анализирует историю и предлагает правки терапии. Он ничего не меняет сам — только советует, решение за тобой и врачом.</div>
      </div>

      {/* инсайты */}
      <div className="section-label sec">Что улучшить</div>
      <div className="insights">
        {analysis.insights.map((it) => (
          <div key={it.id} className="insight" style={{ borderLeftColor: SEV_COLOR[it.severity] }}>
            <div className="insight-top">
              <IonIcon icon={SEV_ICON[it.severity]} style={{ color: SEV_COLOR[it.severity] }} className="insight-sev" />
              <span className="insight-title">{it.title}</span>
              <IonIcon icon={KIND_ICON[it.kind]} className="insight-kind" />
            </div>
            <div className="insight-msg">{it.message}</div>
            {it.question && (
              <div className="insight-q"><IonIcon icon={helpCircleOutline} /><span>{it.question}</span></div>
            )}
          </div>
        ))}
      </div>
      <div className="metric-note">Аналитика за {analysis.windowDays} дн. по данным Nightscout. Подсказки — не медицинское назначение; любые изменения терапии обсуждай с врачом.</div>
    </>
  );
}
