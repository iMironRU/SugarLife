import { IonIcon, IonInput } from '@ionic/react';
import {searchOutline, checkmarkCircle} from 'ionicons/icons';
import { useState } from 'react';
import Sheet from '@/ui/Sheet';
import { useSnapshot } from '@/sources/bridge';
import {
  ключиДрайверов, делимЛи, поддержка, ПОРЯДОК_ГРУПП, ПОДДЕРЖКА_ПОДПИСЬ,
} from '@/domain/catalogSupport';

export interface PickerItem {
  id: string; title: string; subtitle?: string; meta?: string; current: boolean;
  /* Ключ модели у ядра (SugarLifeCore#37). По нему список делится на «читаем
     напрямую» / «только через облако» / «старое и снятое» — то есть на то, что человек
     и пришёл узнать. Пусто — модели нет в таблице драйверов. */
  driverKey?: string;
}

/* Универсальный пикер из справочника: поиск, фильтр «только актуальные» и деление по
   тому, ЧТО МЫ УМЕЕМ с моделью (SugarLife#190).

   Список из шестидесяти девяти помп без деления отвечал не на тот вопрос: человек
   открывает его, чтобы понять, заработает ли его помпа, а список рассказывал про год
   выпуска. Теперь сверху то, что читается напрямую, ниже — то, что придёт через облако,
   в конце — снятое с производства.

   Группы появляются только когда движок сам сказал, какие модели читает: показать
   «читаем напрямую» без его подтверждения хуже, чем не делить вовсе (домовая логика —
   domain/catalogSupport.ts).

   Выбранный элемент показывается всегда, даже если он не актуальный. */
export default function CatalogPicker({
  isOpen, onClose, title, subtitle, items, selectedId, onSelect, currentLabel = 'только актуальные', empty = 'Ничего не найдено.',
}: {
  isOpen: boolean; onClose: () => void; title: string; subtitle?: string;
  items: PickerItem[]; selectedId: string | null; onSelect: (id: string) => void;
  currentLabel?: string; empty?: string;
}) {
  const [q, setQ] = useState('');
  const [currentOnly, setCurrentOnly] = useState(true);
  const снимок = useSnapshot();
  const ключи = ключиДрайверов(снимок?.availableDrivers);
  const делим = делимЛи(снимок?.availableDrivers);
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

        {(делим ? ПОРЯДОК_ГРУПП : [null]).map((группа) => {
          const свои = группа == null ? filtered
            : filtered.filter((it) => поддержка(it.driverKey, it.current, ключи) === группа);
          if (!свои.length) return null;
          return (
            <div key={группа ?? 'все'}>
              {группа && <div className="section-label sec">{ПОДДЕРЖКА_ПОДПИСЬ[группа]}</div>}
              <div className="list pick-list">
                {свои.map((it) => (
                  <button key={it.id} className={'list-row pick-row' + (it.id === selectedId ? ' on' : '')}
                    onClick={() => { onSelect(it.id); onClose(); }}>
                    <span className="pick-main">
                      <span className="list-title">{it.title}</span>
                      {it.subtitle && <span className="pick-sub">{it.subtitle}</span>}
                    </span>
                    {it.meta && <span className="list-value pick-meta">{it.meta}</span>}
                    <IonIcon icon={checkmarkCircle} className="pick-check" style={{ opacity: it.id === selectedId ? 1 : 0 }} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {!filtered.length && <div className="metric-note">{empty}</div>}
    </Sheet>
  );
}
