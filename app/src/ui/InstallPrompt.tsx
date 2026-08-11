import { useEffect, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { Capacitor } from '@capacitor/core';
import { downloadOutline, shareOutline, addOutline, close } from 'ionicons/icons';

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEY = 'sl.install.v1';
const SNOOZE_MS = 14 * 86400e3; // не напоминать 2 недели после отказа

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

const ua = navigator.userAgent;
const isIos = () => /iphone|ipad|ipod/i.test(ua);
// «На экран Домой» на iOS умеет только Safari (не Chrome/Firefox/Edge для iOS).
const isIosSafari = () => isIos() && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);

export default function InstallPrompt() {
  const [mode, setMode] = useState<null | 'android' | 'ios'>(null);
  const [evt, setEvt] = useState<BIPEvent | null>(null);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return; // в нативном приложении баннер не нужен
    if (isStandalone()) return;
    const raw = localStorage.getItem(KEY);
    if (raw === 'installed') return;
    if (raw && Date.now() - Number(raw) < SNOOZE_MS) return;

    let t: number | undefined;
    const showAndroid = (e: BIPEvent) => {
      setEvt(e);
      if (t) clearTimeout(t);
      t = window.setTimeout(() => setMode('android'), 1800);
    };

    const w = window as unknown as { __bip?: BIPEvent };
    if (w.__bip) showAndroid(w.__bip);
    const onReady = () => { if (w.__bip) showAndroid(w.__bip); };
    const onBIP = (e: Event) => { e.preventDefault(); showAndroid(e as BIPEvent); };
    window.addEventListener('bip-ready', onReady);
    window.addEventListener('beforeinstallprompt', onBIP);

    const onInstalled = () => { localStorage.setItem(KEY, 'installed'); setMode(null); };
    window.addEventListener('appinstalled', onInstalled);

    if (isIosSafari()) t = window.setTimeout(() => setMode('ios'), 2200);

    return () => {
      window.removeEventListener('bip-ready', onReady);
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
      if (t) clearTimeout(t);
    };
  }, []);

  if (!mode) return null;

  const dismiss = () => { localStorage.setItem(KEY, String(Date.now())); setMode(null); };

  const install = async () => {
    if (!evt) return dismiss();
    try { await evt.prompt(); await evt.userChoice; } catch { /* ignore */ }
    localStorage.setItem(KEY, String(Date.now()));
    setMode(null);
  };

  return (
    <div className="install-banner">
      <div className="install-ico"><IonIcon icon={downloadOutline} /></div>
      {mode === 'android' ? (
        <>
          <div className="install-text">
            <b>Установить приложение</b>
            <span>Запуск с экрана «Домой», работает офлайн.</span>
          </div>
          <button className="install-btn" onClick={install}>Установить</button>
        </>
      ) : (
        <div className="install-text">
          <b>Добавить на экран «Домой»</b>
          <span>
            Нажмите <IonIcon icon={shareOutline} /> внизу Safari, затем «На экран „Домой“» <IonIcon icon={addOutline} />.
          </span>
        </div>
      )}
      <button className="install-close" onClick={dismiss} aria-label="Закрыть"><IonIcon icon={close} /></button>
    </div>
  );
}
