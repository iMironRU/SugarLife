import {
  IonModal, IonContent, IonInput, IonToggle, IonButton, IonIcon,
} from '@ionic/react';
import { linkOutline, keyOutline, closeOutline, gitNetworkOutline, lockClosed, createOutline, copyOutline, checkmarkOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { getCfg, setCfg, ping } from '../data/nightscout';
import { sendIntent } from '../data/bridge';
import { refresh, useStore } from '../data/store';
import { toUnits } from '../data/units';

export default function NightscoutModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [msg, setMsg] = useState('');
  const { writable, status } = useStore();
  const connected = status === 'ok' || status === 'stale';
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    const u = url.trim();
    if (!u) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(u);
      ok = true;
    } catch {
      // запасной путь для старых WebView без async-clipboard
      try {
        const ta = document.createElement('textarea');
        ta.value = u;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

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
    // Подключить Nightscout как ИСТОЧНИК в KMP-движке (способ «облако», наш Socket.IO-драйвер).
    void sendIntent({ type: 'addCloudSource', url: u, token: t || null, streams: ['glucose', 'pump', 'treatments'] });
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

        <p className="sheet-desc">Читаем сахар и тренд напрямую из вашего Nightscout. Для записи (еда, болюсы) нужен токен с правом записи. Адрес и токен хранятся локально на устройстве.</p>

        <div className="field-label">Адрес сайта</div>
        <div className="field">
          <IonIcon icon={linkOutline} className="field-ico" />
          <IonInput value={url} onIonInput={(e) => setUrl(e.detail.value ?? '')} placeholder="https://ваш-сайт.nightscout…" inputmode="url" autocapitalize="off" />
          {url.trim() && (
            <button className={'field-copy' + (copied ? ' ok' : '')} onClick={copyUrl} aria-label="Скопировать адрес">
              <IonIcon icon={copied ? checkmarkOutline : copyOutline} />
            </button>
          )}
        </div>

        <div className="field-label">Токен доступа · нужен для записи (еда, болюсы)</div>
        <div className="field">
          <IonIcon icon={keyOutline} className="field-ico" />
          <IonInput value={token} onIonInput={(e) => setToken(e.detail.value ?? '')} placeholder="токен с ролью записи (careportal/admin)" autocapitalize="off" />
        </div>

        <IonButton expand="block" className="connect-btn" onClick={save}>
          <IonIcon icon={gitNetworkOutline} slot="start" />
          Проверить и подключить
        </IonButton>

        <div className="sheet-msg">{msg}</div>

        {/* режим доступа */}
        {connected && (
          <div className={'ns-access' + (writable ? ' rw' : '')}>
            <IonIcon icon={writable ? createOutline : lockClosed} />
            <div>
              <div className="ns-access-title">{writable ? 'Чтение и запись' : 'Только чтение'}</div>
              <div className="ns-access-sub">
                {writable
                  ? 'Токен даёт право записи — доступны объявление еды, болюсы и запись в Nightscout.'
                  : 'Ввод данных (еда, болюсы, запись) выключен. Добавьте токен с правом записи, чтобы включить.'}
              </div>
            </div>
          </div>
        )}

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
