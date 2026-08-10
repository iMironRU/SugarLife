import { IonInput, IonToggle, IonButton, IonIcon } from '@ionic/react';
import { linkOutline, keyOutline, closeOutline, chevronForward, gitNetworkOutline, copyOutline, checkmarkOutline, trashOutline, flash, hardwareChipOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useClouds, updateCloud, removeCloud } from '../data/clouds';
import { ping, checkReadAccess, type ReadAccess } from '../data/nightscout';
import { refresh } from '../data/store';
import { toUnits } from '../data/units';
import { useDeviceConfig, isRecorded, isModelKnown } from '../data/deviceConfig';
import { pumpById, sensorById } from '../data/catalog';
import DeviceSheet from './DeviceSheet';
import { useStack } from '../data/stack';

/* Карточка одного облака (docs/CONNECT-UX.md §2b, §7). «Забираем отсюда» — по конкретным
   устройствам из реестра (не по абстрактным ролям «глюкоза»/«помпа»): облако — способ
   подключения для КОНКРЕТНОГО зарегистрированного устройства, честно называем его моделью.
   Если устройство ещё не записано в «Устройствах» — показываем строку выключенной, без
   выдумывания несуществующей связи. «Выгрузка сюда» (запись в это облако) — отдельная задача. */
export default function CloudSheet({ cloudId, onClose }: { cloudId: string; onClose: () => void }) {
  /* Облако берём из хранилища по id, а не приходящим объектом: страница живёт в стеке,
     и пока она открыта, запись успевает измениться (сохранили адрес, переключили роль).
     Копия в пропсе к этому моменту устарела бы. */
  const cloud = useClouds().find((c) => c.id === cloudId) ?? null;
  const { push, pop } = useStack();
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
  const [copied, setCopied] = useState<null | 'ok' | 'fail'>(null);
  const devCfg = useDeviceConfig();
  // Запись в реестре может быть без модели (§2b) — тогда облако для неё единственный
  // способ, и переключатель обязан быть доступен. Заперт он только если записи нет вовсе.
  const sensorRecorded = isRecorded(devCfg.sensorId);
  const pumpRecorded = isRecorded(devCfg.pumpId);
  /* Название в заголовке, состояние — во второй строке. «Сенсор · модель не указана»
     одной строкой не влезало рядом с шевроном и переключателем и переносилось надвое. */
  const sensorLabel = isModelKnown(devCfg.sensorId)
    ? (sensorById(devCfg.sensorId)?.name ?? 'Сенсор')
    : 'Сенсор';
  const pumpLabel = isModelKnown(devCfg.pumpId)
    ? (pumpById(devCfg.pumpId)?.model ?? 'Помпа')
    : 'Помпа';
  const sensorSub = !sensorRecorded ? 'не записан в «Устройствах»'
    : isModelKnown(devCfg.sensorId) ? 'настроить' : 'модель не указана';
  const pumpSub = !pumpRecorded ? 'не записана в «Устройствах»'
    : isModelKnown(devCfg.pumpId) ? 'настроить' : 'модель не указана';

  useEffect(() => {
    if (!cloud) return;
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
  }, [cloud?.id]);

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

  /* Clipboard API есть не везде: в небезопасном контексте (http на телефоне в локальной
     сети) его просто нет. Молча ничего не делать в таком случае нельзя — человек нажал
     и ждёт результата, поэтому честно говорим, что не вышло. */
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url.trim());
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    setTimeout(() => setCopied(null), 2000);
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
  /* Введённое в поля живёт в состоянии до «Проверить и сохранить». Раньше карточку
     закрывали только крестиком, и потерять набранное было трудно; теперь её закрывает
     касание по панели — то есть случайный тап рядом стирал бы адрес, который человек
     переписывал с другого устройства. Пока есть несохранённое: по панели не закрываем
     вовсе, а крестик переспрашивает. */
  const dirty = url.trim() !== (cloud.url || '') || token.trim() !== (cloud.token || '');
  const askClose = () => {
    if (dirty && !window.confirm('Адрес или токен изменены, но не сохранены. Закрыть и потерять правки?')) return;
    onClose();
  };
  // Пока проверка не ответила — поле не мигаем: показываем, только когда есть за что.
  const needToken = access === 'needsToken' || tokenShown;

  return (
    <div className="sheet stack-body">
        <div className="sheet-head">
          <div className="sheet-title">{cloud.name}</div>
          <button className="sheet-close" onClick={askClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        <p className="sheet-desc">Читаем сахар и тренд напрямую из Nightscout. Адрес хранится локально на устройстве.</p>

        <div className="field-label">Адрес сайта</div>
        <div className="field">
          <IonIcon icon={linkOutline} className="field-ico" />
          <IonInput value={url} onIonInput={(e) => setUrl(e.detail.value ?? '')} placeholder="https://ваш-сайт.nightscout…" inputmode="url" autocapitalize="off" />
          {/* Адрес длинный и набирать его руками мучительно — а перенести на другое
              устройство или отправить в поддержку хочется целиком. Выделять пальцем
              внутри поля неудобно: попадаешь в правку. */}
          {url.trim() && (
            <button className={'field-copy' + (copied === 'ok' ? ' ok' : '')} onClick={copyUrl} aria-label="Скопировать адрес">
              <IonIcon icon={copied === 'ok' ? checkmarkOutline : copyOutline} />
            </button>
          )}
        </div>
        {copied === 'fail' && <div className="field-hint">Буфер обмена недоступен — скопируйте вручную.</div>}

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
          {/* Строка ведёт в карточку устройства: именно там указывают модель, а «модель
              не указана» — это ровно то место, где хочется на неё нажать. Переключатель
              вынесен из кнопки: он про источник данных, а не про переход. */}
          <div className="list-row src-row">
            <button className="src-main" onClick={() => push(<DeviceSheet cat="sensor" title="Сенсор (НМГ)" onClose={pop} />)}>
              <IonIcon icon={hardwareChipOutline} className="list-ico" />
              <span className="pick-main">
                <span className={'list-title' + (sensorRecorded ? '' : ' muted')}>{sensorLabel}</span>
                <span className="pick-sub">{sensorSub}</span>
              </span>
              <IonIcon icon={chevronForward} className="list-chev" />
            </button>
            <IonToggle checked={cloud.sourceGlucose} disabled={!sensorRecorded} onIonChange={(e) => onToggleSensor(e.detail.checked)} />
          </div>
          <div className="list-row src-row">
            <button className="src-main" onClick={() => push(<DeviceSheet cat="pump" title="Помпа" onClose={pop} />)}>
              <IonIcon icon={flash} className="list-ico" />
              <span className="pick-main">
                <span className={'list-title' + (pumpRecorded ? '' : ' muted')}>{pumpLabel}</span>
                <span className="pick-sub">{pumpSub}</span>
              </span>
              <IonIcon icon={chevronForward} className="list-chev" />
            </button>
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
    </div>
  );
}

function hostLabel(url: string): string {
  try { return new URL(url).host || url; } catch { return url; }
}
