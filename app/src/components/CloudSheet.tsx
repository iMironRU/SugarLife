import { IonModal, IonContent, IonFooter, IonInput, IonToggle, IonButton, IonIcon } from '@ionic/react';
import { linkOutline, keyOutline, closeOutline, chevronBack, gitNetworkOutline, trashOutline, flash, hardwareChipOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { type CloudConfig, updateCloud, removeCloud } from '../data/clouds';
import { ping, checkReadAccess, type ReadAccess } from '../data/nightscout';
import { refresh } from '../data/store';
import { toUnits } from '../data/units';
import { useDeviceConfig, isRecorded, isModelKnown } from '../data/deviceConfig';
import { pumpById, sensorById } from '../data/catalog';

/* Карточка одного облака (docs/CONNECT-UX.md §2b, §7). «Забираем отсюда» — по конкретным
   устройствам из реестра (не по абстрактным ролям «глюкоза»/«помпа»): облако — способ
   подключения для КОНКРЕТНОГО зарегистрированного устройства, честно называем его моделью.
   Если устройство ещё не записано в «Устройствах» — показываем строку выключенной, без
   выдумывания несуществующей связи. «Выгрузка сюда» (запись в это облако) — отдельная задача. */
export default function CloudSheet({ isOpen, onClose, cloud }: {
  isOpen: boolean; onClose: () => void; cloud: CloudConfig | null;
}) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState('');
  const [checking, setChecking] = useState(false);
  /* Токен показываем, только если он на что-то влияет: либо чтение без него закрыто,
     либо он уже сохранён (чужие данные не прячем — их надо видеть и уметь стереть).
     У Nightscout по умолчанию роль readable, и на открытом сайте пустое поле с
     подписью «нужен для записи» — просто повод для беспокойства на ровном месте.
     Запись (еда, болюсы) — отдельная функция; токен под неё спросим, когда дойдёт. */
  const [access, setAccess] = useState<ReadAccess | 'checking' | null>(null);
  const [tokenShown, setTokenShown] = useState(false);
  const devCfg = useDeviceConfig();
  // Запись в реестре может быть без модели (§2b) — тогда облако для неё единственный
  // способ, и переключатель обязан быть доступен. Заперт он только если записи нет вовсе.
  const sensorRecorded = isRecorded(devCfg.sensorId);
  const pumpRecorded = isRecorded(devCfg.pumpId);
  const sensorLabel = isModelKnown(devCfg.sensorId)
    ? (sensorById(devCfg.sensorId)?.name ?? 'Сенсор')
    : sensorRecorded ? 'Сенсор · модель не указана' : 'Сенсор';
  const pumpLabel = isModelKnown(devCfg.pumpId)
    ? (pumpById(devCfg.pumpId)?.model ?? 'Помпа')
    : pumpRecorded ? 'Помпа · модель не указана' : 'Помпа';

  useEffect(() => {
    if (!isOpen || !cloud) return;
    setUrl(cloud.url || '');
    setToken(cloud.token || '');
    setMsg('');
    setTokenShown(!!cloud.token);
    if (!cloud.url) { setAccess(null); return; }
    let cancel = false;
    setAccess('checking');
    checkReadAccess(cloud.url, cloud.token || undefined)
      .then((a) => { if (!cancel) setAccess(a); })
      .catch(() => { if (!cancel) setAccess(null); });
    return () => { cancel = true; };
  }, [isOpen, cloud?.id]);

  if (!cloud) return null;

  const save = async () => {
    const u = url.trim(), t = token.trim();
    updateCloud(cloud.id, { url: u, token: t, name: hostLabel(u) || cloud.name });
    setChecking(true);
    setMsg('Проверяю подключение…');
    // адрес мог смениться — вместе с ним меняется и ответ на вопрос «нужен ли токен»
    checkReadAccess(u, t || undefined).then(setAccess).catch(() => setAccess(null));
    try {
      const res = await ping(u, t);
      setMsg(res.ok
        ? `Подключено · Nightscout ${res.version || ''} · сахар ${toUnits(res.latestMmol!)}`
        : 'Ответ есть, но нет данных сахара');
      refresh();
    } catch (e: any) {
      setMsg('Ошибка: ' + (e?.message || e));
    }
    setChecking(false);
  };

  const onToggleEnabled = (val: boolean) => {
    updateCloud(cloud.id, { enabled: val });
    refresh();
  };
  const onToggleSensor = (val: boolean) => { updateCloud(cloud.id, { sourceGlucose: val }); refresh(); };
  const onTogglePump = (val: boolean) => { updateCloud(cloud.id, { sourcePumpStatus: val }); refresh(); };

  const onDelete = () => {
    if (!window.confirm(`Удалить облако «${cloud.name}»?`)) return;
    removeCloud(cloud.id);
    onClose();
  };

  const noRoles = !cloud.sourceGlucose && !cloud.sourcePumpStatus;
  // Пока проверка не ответила — поле не мигаем: показываем, только когда есть за что.
  const needToken = access === 'needsToken' || tokenShown;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} className="full-page">
      <IonContent className="sheet">
        <div className="sheet-head">
          <div className="sheet-title">{cloud.name}</div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        <p className="sheet-desc">Читаем сахар и тренд напрямую из Nightscout. Адрес хранится локально на устройстве.</p>

        <div className="field-label">Адрес сайта</div>
        <div className="field">
          <IonIcon icon={linkOutline} className="field-ico" />
          <IonInput value={url} onIonInput={(e) => setUrl(e.detail.value ?? '')} placeholder="https://ваш-сайт.nightscout…" inputmode="url" autocapitalize="off" />
        </div>

        {needToken && (
          <>
            <div className="field-label">
              {access === 'needsToken' ? 'Токен доступа · этот Nightscout закрыт' : 'Токен доступа'}
            </div>
            <div className="field">
              <IonIcon icon={keyOutline} className="field-ico" />
              <IonInput value={token} onIonInput={(e) => setToken(e.detail.value ?? '')} placeholder="токен из Nightscout" autocapitalize="off" />
            </div>
          </>
        )}
        {!needToken && access === 'open' && (
          <button className="token-hint" onClick={() => setTokenShown(true)}>
            Чтение открыто — токен не нужен. <u>Всё равно указать</u>
          </button>
        )}

        <IonButton expand="block" className="connect-btn" onClick={save} disabled={checking}>
          <IonIcon icon={gitNetworkOutline} slot="start" />
          Проверить и сохранить
        </IonButton>

        {msg && <div className="sheet-msg">{msg}</div>}

        <div className="sync-toggle">
          <div>
            <div className="sync-toggle-title">Подключено</div>
            <div className="sync-toggle-sub">{cloud.enabled ? 'включено' : 'выключено'}</div>
          </div>
          <IonToggle checked={cloud.enabled} onIonChange={(e) => onToggleEnabled(e.detail.checked)} />
        </div>

        <div className="section-label sec">Забираем отсюда</div>
        <div className="list">
          <div className="list-row" style={{ cursor: 'default' }}>
            <IonIcon icon={hardwareChipOutline} className="list-ico" />
            <span className="pick-main">
              <span className={'list-title' + (sensorRecorded ? '' : ' muted')}>{sensorLabel}</span>
              {!sensorRecorded && <span className="pick-sub">не записан в «Устройствах»</span>}
            </span>
            <IonToggle checked={cloud.sourceGlucose} disabled={!sensorRecorded} onIonChange={(e) => onToggleSensor(e.detail.checked)} />
          </div>
          <div className="list-row" style={{ cursor: 'default' }}>
            <IonIcon icon={flash} className="list-ico" />
            <span className="pick-main">
              <span className={'list-title' + (pumpRecorded ? '' : ' muted')}>{pumpLabel}</span>
              {!pumpRecorded && <span className="pick-sub">не записана в «Устройствах»</span>}
            </span>
            <IonToggle checked={cloud.sourcePumpStatus} disabled={!pumpRecorded} onIonChange={(e) => onTogglePump(e.detail.checked)} />
          </div>
        </div>
        {noRoles && (
          <div className="sheet-note">Ни одно устройство не забирает данные отсюда — облако подключено, но никуда не идёт.</div>
        )}

        <button className="sheet-danger" onClick={onDelete}>
          <IonIcon icon={trashOutline} />
          Удалить облако
        </button>
      </IonContent>
      {/* подвал ВНЕ прокрутки: фиксированный слой поверх контента перекрывал
          последнюю кнопку, пока не домотаешь до конца */}
      <IonFooter className="page-foot">
        <button className="page-back" onClick={onClose}>
          <IonIcon icon={chevronBack} />
          Назад
        </button>
      </IonFooter>
    </IonModal>
  );
}

function hostLabel(url: string): string {
  try { return new URL(url).host || url; } catch { return url; }
}
