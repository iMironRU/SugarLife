import { IonIcon, IonSpinner } from '@ionic/react';
import Row from '@/ui/Row';
import {bluetoothOutline, radioOutline, checkmarkCircle} from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useSnapshot, sendIntent } from '@/sources/bridge';
import type { Discovered, DriverDescriptor } from '@/sources/bridge';
import ParamsForm from '@/ui/ParamsForm';
import Sheet from '@/ui/Sheet';

/* Что показано, то и отправляется.

   Форма рисует `default` как выбранное — но в `values` его не было, и наружу уходил
   параметр без значения. Дальше решал драйвер, и обычно так же, как показано, — но это
   совпадение, а не правило: человек видел «авто», соглашался, а согласие никуда не шло.

   Для помпы это стоит минут: «регион» по умолчанию «авто» — полный перебор частот, до
   пяти минут молчания на первом подключении (#344). Разница между «выбрал авто» и
   «ничего не выбрал» должна быть видна нам, а не угадываться движком. */
function поУмолчанию(d: DriverDescriptor | null): Record<string, string> {
  const v: Record<string, string> = {};
  d?.settings.parameters.forEach((p) => { if (p.default != null) v[p.key] = p.default; });
  return v;
}

type Step = { kind: 'list' } | { kind: 'target'; item: Discovered } | { kind: 'params'; item: Discovered; target: DriverDescriptor | null };

/* Plug-and-play подключение устройства по контракту (§2.3/§3): «Подключить» → startScan →
   discovered[] → тап → прямое устройство (форма параметров) или мост (второй экран — выбор
   целевого устройства из transportFor) → addDiscovered. Показывается ТОЛЬКО когда мост
   реально предлагает драйвер для этой категории (availableDrivers) — иначе секции нет:
   Nightscout-шим никогда не сканирует, категории без BLE (шприцы/глюкометры) сюда не попадают. */
export default function DeviceScanSheet({ isOpen, onClose, kind, title, выбран }: {
  /* kind не задан — не фильтруем вовсе. Так шторка работает и из карточки конкретной
     категории («покажи сенсоры»), и из общего «что рядом», где категория заранее
     неизвестна: движок сам узнаёт, что вещает (SugarLifeCore#12). */
  isOpen: boolean; onClose: () => void; kind?: 'sensor' | 'pump'; title: string;
  /* С каким прибором пришли (SugarLife#337, п. 1).

     Раньше тап по найденному прибору открывал эту шторку без него: скан начинался
     заново, и выбирать приходилось второй раз. Обработчик игнорировал предмет нажатия —
     тот же класс, что «Найти рядом» → каталог. */
  выбран?: Discovered | null;
}) {
  const snap = useSnapshot();
  const drivers = snap?.availableDrivers ?? [];
  const discovered = snap?.discovered ?? [];
  const scanning = !!snap?.scanning;
  const driverById = (id: string) => drivers.find((d) => d.id === id) ?? null;

  const [step, setStep] = useState<Step>({ kind: 'list' });
  const [mode, setMode] = useState<'attach' | 'activate'>('attach');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!isOpen) { setStep({ kind: 'list' }); setValues({}); setMode('attach'); } }, [isOpen]);
  /* Пришли с готовым выбором — сразу к нему, минуя список. Список в этом случае был бы
     вопросом «что выбрать» после того, как человек уже выбрал. */
  useEffect(() => { if (isOpen && выбран) pick(выбран); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isOpen, выбран?.bleId]);
  /* Скан ЗДЕСЬ НЕ ВЫКЛЮЧАЕМ. Эфиром владеет экран, который его открыл (#337): шторка
     всплывает поверх ленты, где скан уже идёт, и, гася его при закрытии, она гасила
     чужой. Снаружи это выглядело так: завёл мост, закрыл шторку — и под ней «Поиск не
     идёт», хотя человек стоит ровно на экране поиска.

     Включаем на всякий случай: шторку открывают и из мест, где скан не запущен. Лишний
     startScan движок сносит, лишний stopScan — нет. */
  useEffect(() => { if (isOpen) sendIntent({ type: 'startScan' }); }, [isOpen]);

  // релевантные категории: прямые устройства нужного kind + мосты, ведущие к нему
  const relevant = kind == null ? discovered : discovered.filter((d) => {
    const own = driverById(d.driverId);
    if (own?.kind === kind) return true;
    if (d.isTransport) return d.transportFor.some((t) => driverById(t)?.kind === kind);
    return false;
  });

  const pick = (item: Discovered) => {
    if (item.isTransport) { setStep({ kind: 'target', item }); return; }
    const own = driverById(item.driverId);
    if (item.needsMoreParams) { setValues(поУмолчанию(own)); setStep({ kind: 'params', item, target: own }); return; }
    void confirm(item, null, {});
  };

  const pickTarget = (item: Discovered, targetId: string) => {
    const t = driverById(targetId);
    setValues(поУмолчанию(t));
    setStep({ kind: 'params', item, target: t });
  };

  const confirm = async (item: Discovered, target: DriverDescriptor | null, params: Record<string, string>) => {
    setBusy(true);
    await sendIntent({
      type: 'addDiscovered', bleId: item.bleId, driverType: item.driverId, params,
      mode: target?.canActivate ? mode : undefined, targetDriver: target?.id,
    });
    setBusy(false);
    onClose();
  };

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title="Подключение по BLE" subtitle={title}>

        {step.kind === 'list' && (
          <>
            <div className={'scan-state' + (scanning ? ' on' : '')}>
              {scanning ? <IonSpinner name="crescent" /> : <IonIcon icon={bluetoothOutline} />}
              <span>{scanning ? 'Ищу устройства рядом…' : 'Поиск остановлен'}</span>
            </div>
            <div className="list">
              {relevant.map((d) => (
                <Row key={d.bleId} icon={d.isTransport ? radioOutline : bluetoothOutline}
                  title={d.displayName} sub={d.name || undefined}
                  value={d.rssi != null ? `${d.rssi} дБм` : undefined} onClick={() => pick(d)} />
              ))}
            </div>
            {!relevant.length && (
              <div className="metric-note" style={{ marginTop: 14 }}>
                {scanning ? 'Рядом ничего подходящего — держите устройство ближе.' : 'Пока ничего не найдено.'}
              </div>
            )}
          </>
        )}

        {step.kind === 'target' && (
          <>
            <div className="metric-note" style={{ marginTop: 0, marginBottom: 10 }}>«{step.item.displayName}» — мост. Выберите устройство, которое через него подключаем.</div>
            <div className="list">
              {step.item.transportFor.map((tid) => {
                const t = driverById(tid);
                if (!t || (kind != null && t.kind !== kind)) return null;
                return (
                  <Row key={tid} icon={bluetoothOutline} title={t.displayName}
                    onClick={() => pickTarget(step.item, tid)} />
                );
              })}
            </div>
          </>
        )}

        {step.kind === 'params' && (
          <>
            {step.target?.canActivate && (
              <div className="dev-seg" style={{ marginTop: 0 }}>
                <button className={'dev-seg-btn' + (mode === 'attach' ? ' on' : '')} onClick={() => setMode('attach')}>Уже активирован</button>
                <button className={'dev-seg-btn' + (mode === 'activate' ? ' on' : '')} onClick={() => setMode('activate')}>Активировать новый</button>
              </div>
            )}
            {/* Та же форма, что у облачных учёток и в карточке прибора (ui/ParamsForm).

                Здесь стояла вторая, своя, и разошлась ровно там, где дороже всего:
                ПОДСКАЗКИ ЯДРА ОНА НЕ ПОКАЗЫВАЛА ВОВСЕ. Драйверы их пишут — «где взять
                токен», «тот же регион, что у учётки», «ручка не знает, что в неё
                заряжено», — а до человека они не доходили: в форме подключения, то есть
                там, где он видит эти поля первый и единственный раз.

                Заодно Enum стал переключателем вместо выпадающего списка: варианта два-три,
                и прятать их за нажатием незачем. */}
            <ParamsForm
              spec={step.target?.settings}
              values={values}
              onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
            />
            <button className="food-save" disabled={busy} onClick={() => confirm(step.item, step.target, values)} style={{ marginTop: 16 }}>
              <IonIcon icon={checkmarkCircle} style={{ marginRight: 6, verticalAlign: -2 }} />
              {busy ? 'Подключаю…' : 'Подключить'}
            </button>
          </>
        )}
    </Sheet>
  );
}
