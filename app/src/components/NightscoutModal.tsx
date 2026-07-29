import {
  IonModal, IonContent, IonInput, IonToggle, IonButton, IonIcon,
} from '@ionic/react';
import { linkOutline, keyOutline, closeOutline, gitNetworkOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { getCfg, setCfg, ping } from '../data/nightscout';
import { refresh } from '../data/store';
import { toUnits } from '../data/units';

export default function NightscoutModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const c = getCfg();
    setUrl(c?.url || '');
    setToken(c?.token || '');
    setEnabled(!!c?.enabled);
    setMsg('');
  }, [isOpen]);

  const save = async () => {
    const u = url.trim(), t = token.trim();
    setCfg({ url: u, token: t, enabled: true });
    setEnabled(true);
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
  };

  const onToggle = (val: boolean) => {
    setEnabled(val);
    const c = getCfg() || { url, token, enabled: false };
    setCfg({ url: c.url || url.trim(), token: c.token || token.trim(), enabled: val });
    refresh();
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.85} breakpoints={[0, 0.85]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div className="sheet-title">Nightscout</div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        <p className="sheet-desc">Читаем сахар и тренд напрямую из вашего Nightscout. Только чтение. Адрес и токен хранятся локально на устройстве.</p>

        <div className="field-label">Адрес сайта</div>
        <div className="field">
          <IonIcon icon={linkOutline} className="field-ico" />
          <IonInput value={url} onIonInput={(e) => setUrl(e.detail.value ?? '')} placeholder="https://ваш-сайт.nightscout…" inputmode="url" autocapitalize="off" />
        </div>

        <div className="field-label">Токен доступа · если требуется</div>
        <div className="field">
          <IonIcon icon={keyOutline} className="field-ico" />
          <IonInput value={token} onIonInput={(e) => setToken(e.detail.value ?? '')} placeholder="read-only токен (необязательно)" autocapitalize="off" />
        </div>

        <IonButton expand="block" className="connect-btn" onClick={save}>
          <IonIcon icon={gitNetworkOutline} slot="start" />
          Проверить и подключить
        </IonButton>

        <div className="sheet-msg">{msg}</div>

        <div className="sync-toggle">
          <div>
            <div className="sync-toggle-title">Синхронизация</div>
            <div className="sync-toggle-sub">{enabled ? 'включена' : 'выключена'}</div>
          </div>
          <IonToggle checked={enabled} onIonChange={(e) => onToggle(e.detail.checked)} />
        </div>
      </IonContent>
    </IonModal>
  );
}
