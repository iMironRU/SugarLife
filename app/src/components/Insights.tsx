import { useState } from 'react';
import { IonIcon } from '@ionic/react';
import {
  checkmarkCircle, informationCircle, warning, alertCircle,
  helpCircleOutline, chevronForward,
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

function Card({ it, open, onToggle }: { it: Insight; open: boolean; onToggle: () => void }) {
  return (
    <div className="insight" style={{ borderLeftColor: SEV_COLOR[it.severity] }}>
      <button className="insight-top" onClick={onToggle}>
        <IonIcon icon={SEV_ICON[it.severity]} style={{ color: SEV_COLOR[it.severity] }} className="insight-sev" />
        <span className="insight-title">{it.title}</span>
        <IonIcon icon={chevronForward} className={'insight-chev' + (open ? ' open' : '')} />
      </button>
      {open && (
        <div className="insight-body">
          <div className="insight-msg">{it.message}</div>
          {it.question && (
            <div className="insight-q"><IonIcon icon={helpCircleOutline} /><span>{it.question}</span></div>
          )}
        </div>
      )}
    </div>
  );
}

type TabKey = 'attention' | 'notes' | 'ok';

export default function Insights({ analysis }: { analysis: Analysis | null }) {
  const [tab, setTab] = useState<TabKey>('attention');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  if (!analysis) {
    return <div className="metric-note" style={{ marginTop: 6 }}>Собираю аналитику…</div>;
  }
  const toggle = (id: string) => setOpenIds((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const attention = analysis.insights.filter((i) => i.severity === 'bad' || i.severity === 'warn');
  const notes = analysis.insights.filter((i) => i.severity === 'info');
  const ok = analysis.insights.filter((i) => i.severity === 'good');

  const tabs: { key: TabKey; label: string; items: Insight[]; color: string; empty: string }[] = [
    { key: 'attention', label: 'Внимание', items: attention, color: attention.some((i) => i.severity === 'bad') ? 'var(--c-danger)' : 'var(--c-carb)', empty: 'Ничего срочного.' },
    { key: 'notes', label: 'Заметки', items: notes, color: 'var(--color-accent)', empty: 'Заметок нет.' },
    { key: 'ok', label: 'В норме', items: ok, color: 'var(--c-glu)', empty: 'Пока пусто.' },
  ];
  const active = tabs.find((t) => t.key === tab)!;

  return (
    <>
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
        <div className="insights">{active.items.map((it) => <Card key={it.id} it={it} open={openIds.has(it.id)} onToggle={() => toggle(it.id)} />)}</div>
      ) : (
        <div className="metric-note" style={{ marginTop: 12 }}>{active.empty}</div>
      )}
    </>
  );
}
