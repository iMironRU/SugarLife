import { IonModal, IonContent, IonInput, IonToggle, IonButton, IonIcon } from '@ionic/react';
import { linkOutline, keyOutline, closeOutline, gitNetworkOutline, trashOutline, flash, hardwareChipOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { type CloudConfig, updateCloud, removeCloud } from '../data/clouds';
import { ping } from '../data/nightscout';
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
  }, [isOpen, cloud?.id]);

  if (!cloud) return null;

  const save = async () => {
    const u = url.trim(), t = token.trim();
    updateCloud(cloud.id, { url: u, token: t, name: hostLabel(u) || cloud.name });
    setChecking(true);
    setMsg('Проверяю подключение…');
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

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.9} breakpoints={[0, 0.9]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div className="sheet-title">{cloud.name}</div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        <p className="sheet-desc">Читаем сахар и тренд напрямую из Nightscout. Для записи (еда, болюсы) нужен токен с правом записи. Адрес и токен хранятся локально на устройстве.</p>

        <div className="field-label">Адрес сайта</div>
        <div className="field">
          <IonIcon icon={linkOutline} className="field-ico" />
          <IonInput value={url} onIonInput={(e) => setUrl(e.detail.value ?? '')} placeholder="https://ваш-сайт.nightscout…" inputmode="url" autocapitalize="off" />
        </div>

        <div className="field-label">Токен доступа · нужен для записи (еда, болюсы)</div>
        <div className="field">
          <IonIcon icon={keyOutline} className="field-ico" />
          <IonInput value={token} onIonInput={(e) => setToken(e.detail.value ?? '')} placeholder="токен с ролью записи (careportal/admin)" autocapitalize="off" />
        </div>

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
    </IonModal>
  );
}

function hostLabel(url: string): string {
  try { return new URL(url).host || url; } catch { return url; }
}
