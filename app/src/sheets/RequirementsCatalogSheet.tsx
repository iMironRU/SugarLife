import { IonModal, IonContent, IonIcon, IonInput } from '@ionic/react';
import Row from '@/ui/Row';
import { closeOutline, searchOutline, chevronBack, lockClosedOutline } from 'ionicons/icons';
import { useState } from 'react';
import { REQUIREMENTS, supportLabel, categoryLabel, type RequirementEntry } from '@/domain/requirementsCatalog';

/* Каталог требований (docs/CONNECT-UX.md §7a): для человека, у которого скан ничего не нашёл
   (устройство ещё не в эфире/не активировано) или он просто хочет узнать заранее, что нужно
   для его модели. Чисто информационный: «поддерживаем ли и что нужно» — без записи модели
   отсюда напрямую, чтобы не дублировать существующий выбор в DeviceSection → «Модель». Кто решил
   записать — открывает нужную категорию в «Устройствах» сам (одним лишним тапом). */
export default function RequirementsCatalogSheet({ isOpen, onClose }: {
  isOpen: boolean; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<RequirementEntry | null>(null);
  const ql = q.trim().toLowerCase();
  const filtered = REQUIREMENTS.filter((r) => !ql || (r.name + ' ' + r.brand).toLowerCase().includes(ql));

  const close = () => { onClose(); setPicked(null); setQ(''); };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={close} initialBreakpoint={0.85} breakpoints={[0, 0.85, 1]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          {picked && (
            <button className="sheet-close" onClick={() => setPicked(null)} aria-label="Назад">
              <IonIcon icon={chevronBack} />
            </button>
          )}
          <div style={{ flex: 1 }}>
            <div className="sheet-title">{picked ? picked.name : 'Назови своё устройство'}</div>
            <div className="sheet-subtitle">{picked ? categoryLabel(picked.category) : 'Каталог · что поддерживаем'}</div>
          </div>
          <button className="sheet-close" onClick={close} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        {!picked ? (
          <>
            <div className="field">
              <IonIcon icon={searchOutline} className="field-ico" />
              <IonInput placeholder="Модель или бренд" value={q} onIonInput={(e) => setQ(e.detail.value || '')} />
            </div>
            <div className="list" style={{ marginTop: 10 }}>
              {filtered.map((r) => (
                <Row key={r.id} title={r.name} sub={`${r.brand} · ${categoryLabel(r.category)}`}
                  value={r.support === 'blocked' ? '⛔' : r.support === 'bridge' ? '✓ мост' : '✓'}
                  onClick={() => setPicked(r)} />
              ))}
              {!filtered.length && <div className="metric-note">Не нашли — но справочник моделей в разделе устройства шире, попробуй там.</div>}
            </div>
          </>
        ) : (
          <>
            <div className="list">
              <Row title="Поддержка" value={supportLabel(picked.support)} />
              <Row title="Что нужно" value={picked.requirement} />
            </div>
            {picked.support === 'blocked' ? (
              <div className="sheet-note">
                <IonIcon icon={lockClosedOutline} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                Только мониторинг недоступен: активация этого устройства сама по себе — команда на
                подачу инсулина, а мы читаем только то, что не требует такой команды.
              </div>
            ) : (
              <div className="sheet-note">
                {picked.category === 'sensor' || picked.category === 'pump'
                  ? `Модель можно выбрать в «Устройства → ${categoryLabel(picked.category)}» — запись сохранится, мост можно подключить позже.`
                  : `${categoryLabel(picked.category)} — учёт модели пока в разработке.`}
              </div>
            )}
          </>
        )}
      </IonContent>
    </IonModal>
  );
}
