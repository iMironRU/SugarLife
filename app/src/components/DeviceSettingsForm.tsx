import { IonInput, IonToggle, IonIcon } from '@ionic/react';
import { qrCodeOutline } from 'ionicons/icons';
import { useState } from 'react';
import type { Param } from '../data/bridge';
import QrScanner from './QrScanner';

/* Generic-форма настроек устройства: рисуется ИЗ settings.parameters, без хардкода
   под конкретное устройство (контракт §2.5/§3). Text/Secret/Number — поле ввода,
   Bool — тумблер, Enum — выпадающий список. Поле со scan:'qr' получает кнопку
   «Сканировать QR» — честно неактивна, пока камера-сканер не подключена (§3, отдельная фича). */
export default function DeviceSettingsForm({
  params, values, onChange,
}: {
  params: Param[]; values: Record<string, string>; onChange: (key: string, v: string) => void;
}) {
  const [scanKey, setScanKey] = useState<string | null>(null);

  return (
    <div className="dev-form">
      {params.map((p) => {
        const v = values[p.key] ?? p.default ?? '';
        if (p.type === 'Bool') {
          return (
            <div key={p.key} className="sync-toggle">
              <div>
                <div className="sync-toggle-title">{p.title}</div>
                {p.required && <div className="sync-toggle-sub">обязательно</div>}
              </div>
              <IonToggle checked={v === 'true'} onIonChange={(e) => onChange(p.key, String(e.detail.checked))} />
            </div>
          );
        }
        if (p.type === 'Enum') {
          return (
            <div key={p.key}>
              <div className="field-label">{p.title}{p.required && ' *'}</div>
              <select className="dev-select" value={v} onChange={(e) => onChange(p.key, e.target.value)}>
                <option value="" disabled>выбрать</option>
                {p.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          );
        }
        return (
          <div key={p.key}>
            <div className="field-label">{p.title}{p.required && ' *'}</div>
            <div className="field">
              <IonInput
                value={v}
                onIonInput={(e) => onChange(p.key, e.detail.value ?? '')}
                type={p.type === 'Secret' ? 'password' : p.type === 'Number' ? 'number' : 'text'}
                placeholder={p.title}
              />
              {p.scan === 'qr' && (
                <button className="field-copy" onClick={() => setScanKey(p.key)} aria-label="Сканировать QR">
                  <IonIcon icon={qrCodeOutline} />
                </button>
              )}
            </div>
          </div>
        );
      })}
      <QrScanner
        isOpen={scanKey !== null}
        onClose={() => setScanKey(null)}
        onResult={(text) => { if (scanKey) onChange(scanKey, text); }}
      />
    </div>
  );
}
