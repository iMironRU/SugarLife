import { IonIcon, IonInput } from '@ionic/react';
import {searchOutline, checkmarkCircle} from 'ionicons/icons';
import { useState } from 'react';
import Sheet from '@/ui/Sheet';

export interface PickerItem { id: string; title: string; subtitle?: string; meta?: string; current: boolean; }

/* Универсальный пикер из справочника: поиск + фильтр «только актуальные».
   Выбранный элемент показывается всегда (даже если он не актуальный). */
export default function CatalogPicker({
  isOpen, onClose, title, subtitle, items, selectedId, onSelect, currentLabel = 'только актуальные', empty = 'Ничего не найдено.',
}: {
  isOpen: boolean; onClose: () => void; title: string; subtitle?: string;
  items: PickerItem[]; selectedId: string | null; onSelect: (id: string) => void;
  currentLabel?: string; empty?: string;
}) {
  const [q, setQ] = useState('');
  const [currentOnly, setCurrentOnly] = useState(true);
  const ql = q.trim().toLowerCase();
  const filtered = items.filter((it) => {
    if (currentOnly && !it.current && it.id !== selectedId) return false;
    if (!ql) return true;
    return (it.title + ' ' + (it.subtitle || '') + ' ' + (it.meta || '')).toLowerCase().includes(ql);
  });

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title={title} subtitle={subtitle}>

        <div className="field">
          <IonIcon icon={searchOutline} className="field-ico" />
          <IonInput placeholder="Поиск" value={q} onIonInput={(e) => setQ(e.detail.value || '')} />
        </div>
        <button className={'pick-toggle' + (currentOnly ? ' on' : '')} onClick={() => setCurrentOnly((v) => !v)}>
          {currentLabel}
        </button>

        <div className="list pick-list">
          {filtered.map((it) => (
            <button key={it.id} className={'list-row pick-row' + (it.id === selectedId ? ' on' : '')}
              onClick={() => { onSelect(it.id); onClose(); }}>
              <span className="pick-main">
                <span className="list-title">{it.title}</span>
                {it.subtitle && <span className="pick-sub">{it.subtitle}</span>}
              </span>
              {it.meta && <span className="list-value">{it.meta}</span>}
              <IonIcon icon={checkmarkCircle} className="pick-check" style={{ opacity: it.id === selectedId ? 1 : 0 }} />
            </button>
          ))}
          {!filtered.length && <div className="metric-note">{empty}</div>}
        </div>
    </Sheet>
  );
}
