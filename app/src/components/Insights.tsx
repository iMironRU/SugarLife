import { useState } from 'react';
import { IonIcon } from '@ionic/react';
import {
  checkmarkCircle, informationCircle, warning, alertCircle,
  medkitOutline, pulseOutline, restaurantOutline, waterOutline, helpCircleOutline,
  chevronForward,
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

function Group({ title, items, color, defaultOpen = false }: { title: string; items: Insight[]; color: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!items.length) return null;
  return (
    <div className="ins-group">
      <button className={'ins-group-btn' + (open ? ' open' : '')} onClick={() => setOpen((o) => !o)}>
        <span className="ins-group-dot" style={{ background: color }} />
        <span>{title}</span>
        <span className="ins-group-count">{items.length}</span>
        <IonIcon icon={chevronForward} className="chev" />
      </button>
      {open && <div className="insights" style={{ marginTop: 10 }}>{items.map((it) => <Card key={it.id} it={it} />)}</div>}
    </div>
  );
}

export default function Insights({ analysis }: { analysis: Analysis | null }) {
  if (!analysis) {
    return <div className="metric-note" style={{ marginTop: 30 }}>Собираю аналитику…</div>;
  }
  const r = READY[analysis.readiness.level];

  const attention = analysis.insights.filter((i) => i.severity === 'bad' || i.severity === 'warn');
  const notes = analysis.insights.filter((i) => i.severity === 'info');
  const ok = analysis.insights.filter((i) => i.severity === 'good');

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

      {/* приоритет: что требует внимания */}
      <div className="section-label sec">Требует внимания</div>
      {attention.length ? (
        <div className="insights">{attention.map((it) => <Card key={it.id} it={it} />)}</div>
      ) : (
        <div className="insight" style={{ borderLeftColor: 'var(--c-glu)' }}>
          <div className="insight-top">
            <IonIcon icon={checkmarkCircle} style={{ color: 'var(--c-glu)' }} className="insight-sev" />
            <span className="insight-title">Ничего срочного</span>
          </div>
          <div className="insight-msg">Всё важное в порядке — ниже только заметки и то, что уже хорошо.</div>
        </div>
      )}

      {/* остальное — свёрнуто */}
      <div className="ins-groups">
        <Group title="Заметки" items={notes} color="var(--color-accent)" />
        <Group title="В норме" items={ok} color="var(--c-glu)" />
      </div>

      <div className="metric-note">Аналитика за {analysis.windowDays} дн. по данным Nightscout. Подсказки — не медицинское назначение; любые изменения терапии обсуждай с врачом.</div>
    </>
  );
}
