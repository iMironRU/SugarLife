import { useState } from 'react';
import { IonIcon, IonInput, IonButton } from '@ionic/react';
import { linkOutline, keyOutline, gitNetworkOutline } from 'ionicons/icons';
import { getCfg, setCfg, ping } from '../data/nightscout';
import { sendIntent } from '../data/bridge';
import { refresh } from '../data/store';
import { toUnits } from '../data/units';
import BrandDrop from '../components/BrandDrop';

export default function Connect() {
  const c = getCfg();
  const [url, setUrl] = useState(c?.url || '');
  const [token, setToken] = useState(c?.token || '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    const u = url.trim(), t = token.trim();
    if (!u) { setMsg('Введите адрес сайта Nightscout'); return; }
    setBusy(true); setMsg('Проверяю подключение…');
    try {
      const res = await ping(u, t);
      if (res.ok) {
        setCfg({ url: u, token: t, enabled: true });
        // Поднять Nightscout как ИСТОЧНИК в KMP-движке (наш Socket.IO-драйвер), а не только в стор приложения.
        void sendIntent({ type: 'addCloudSource', url: u, token: t || null, streams: ['glucose', 'pump', 'treatments'] });
        setMsg(`Подключено · сахар ${toUnits(res.latestMmol!)}`);
        refresh(); // статус стора → ok → гейт откроет приложение
      } else {
        setMsg('Сервер ответил, но нет данных сахара. Проверьте адрес/токен.');
        setBusy(false);
      }
    } catch (e: any) {
      setMsg('Не удалось подключиться: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <div className="connect">
      <BrandDrop size={92} />
      <h1 className="connect-title">SladkaЯ жизнь</h1>
      <p className="connect-desc">Подключите Nightscout, чтобы видеть сахар, тренд и метрики. Только чтение. Адрес и токен хранятся на устройстве.</p>

      <div className="connect-form">
        <div className="field">
          <IonIcon icon={linkOutline} className="field-ico" />
          <IonInput value={url} onIonInput={(e) => setUrl(e.detail.value ?? '')} placeholder="https://ваш-сайт.nightscout…" inputmode="url" autocapitalize="off" />
        </div>
        <div className="field">
          <IonIcon icon={keyOutline} className="field-ico" />
          <IonInput value={token} onIonInput={(e) => setToken(e.detail.value ?? '')} placeholder="токен доступа (если требуется)" autocapitalize="off" />
        </div>
        <IonButton expand="block" className="connect-btn" onClick={connect} disabled={busy}>
          <IonIcon icon={gitNetworkOutline} slot="start" />
          Подключить
        </IonButton>
        <div className="connect-msg">{msg}</div>
      </div>
    </div>
  );
}
