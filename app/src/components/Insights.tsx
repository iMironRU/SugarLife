import { useState } from 'react';
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

function Card({ it }: { it: Insight }) {
  return (
    <div className="insight" style={{ borderLeftColor: SEV_COLOR[it.severity] }}>
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
  );
}

type TabKey = 'attention' | 'notes' | 'ok';

export default function Insights({ analysis }: { analysis: Analysis | null }) {
  const [tab, setTab] = useState<TabKey>('attention');
  if (!analysis) {
    return <div className="metric-note" style={{ marginTop: 18 }}>Собираю аналитику…</div>;
  }
  const r = READY[analysis.readiness.level];

  const attention = analysis.insights.filter((i) => i.severity === 'bad' || i.severity === 'warn');
  const notes = analysis.insights.filter((i) => i.severity === 'info');
  const ok = analysis.insights.filter((i) => i.severity === 'good');

  const tabs: { key: TabKey; label: string; items: Insight[]; color: string; empty: string }[] = [
    { key: 'attention', label: 'Требует внимания', items: attention, color: attention.some((i) => i.severity === 'bad') ? 'var(--c-danger)' : 'var(--c-carb)', empty: 'Ничего срочного — всё важное в порядке.' },
    { key: 'notes', label: 'Заметки', items: notes, color: 'var(--color-accent)', empty: 'Заметок нет.' },
    { key: 'ok', label: 'В норме', items: ok, color: 'var(--c-glu)', empty: 'Пока нет подтверждённо хороших пунктов.' },
  ];
  const active = tabs.find((t) => t.key === tab)!;

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

      {/* вкладки по важности */}
      <div className="ins-tabs">
        {tabs.map((t) => {
          const on = tab === t.key;
          return (
            <button key={t.key} className={'ins-tab' + (on ? ' on' : '')} onClick={() => setTab(t.key)}
              style={on ? { borderColor: `color-mix(in srgb, ${t.color} 60%, transparent)`, background: `color-mix(in srgb, ${t.color} 16%, var(--color-neutral-900))` } : undefined}>
              <span>{t.label}</span>
              <span className="ins-tab-count" style={t.items.length ? { color: t.color } : undefined}>{t.items.length}</span>
            </button>
          );
        })}
      </div>

      {active.items.length ? (
        <div className="insights">{active.items.map((it) => <Card key={it.id} it={it} />)}</div>
      ) : (
        <div className="metric-note" style={{ marginTop: 14 }}>{active.empty}</div>
      )}

      <div className="metric-note">Аналитика за {analysis.windowDays} дн. по данным Nightscout. Подсказки — не медицинское назначение; любые изменения терапии обсуждай с врачом.</div>
    </>
  );
}
