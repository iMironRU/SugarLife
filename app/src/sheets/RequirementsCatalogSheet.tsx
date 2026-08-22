
import Иконка from '@/ui/Иконка';
import Поле from '@/ui/Поле';
import Row from '@/ui/Row';
import { searchOutline, lockClosedOutline } from 'ionicons/icons';
import { useState } from 'react';
import { REQUIREMENTS, VENDOR_CLOUDS, supportLabel, supportMark, categoryLabel, type RequirementEntry } from '@/domain/requirementsCatalog';
import Sheet from '@/ui/Sheet';

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
    <Sheet
      isOpen={isOpen} onClose={close}
      /* «Назад» здесь — шаг ВНУТРИ каталога (карточка → список), а не выход:
         выход рядом, крестиком. */
      onBack={picked ? () => setPicked(null) : undefined}
      title={picked ? picked.name : 'Назови своё устройство'}
      subtitle={picked ? categoryLabel(picked.category) : 'Каталог · что поддерживаем'}
    >

        {!picked ? (
          <>
            <div className="field">
              <Иконка icon={searchOutline} className="field-ico" />
              <Поле placeholder="Модель или бренд" value={q} onInput={(v: string) => setQ(v || '')} />
            </div>
            <div className="list" style={{ marginTop: 10 }}>
              {filtered.map((r) => (
                <Row key={r.id} title={r.name} sub={`${r.brand} · ${categoryLabel(r.category)}`}
                  value={supportMark(r.support)}
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
              {picked.vendorCloud && (
                <Row title="Облако производителя"
                  value={VENDOR_CLOUDS[picked.vendorCloud].name}
                  sub={'спросит: ' + VENDOR_CLOUDS[picked.vendorCloud].asks} />
              )}
            </div>
            {picked.support === 'blocked' ? (
              <div className="sheet-note">
                <Иконка icon={lockClosedOutline} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                Только мониторинг недоступен: активация этого устройства сама по себе — команда на
                подачу инсулина, а мы читаем только то, что не требует такой команды.
              </div>
            ) : picked.support === 'vendorCloud' ? (
              <div className="sheet-note">
                Этот сенсор отдаёт данные только через облако производителя, а туда нужен вход.
                Пароль от чужого облака мы не храним в браузере вовсе — поэтому такой сенсор
                работает только в приложении, не на сайте.
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
    </Sheet>
  );
}
