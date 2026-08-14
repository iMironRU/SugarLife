import { IonIcon, IonInput, IonToggle } from '@ionic/react';
import { qrCodeOutline } from 'ionicons/icons';
import type { SettingsSpec } from '@/sources/bridge';

/* Форма параметров по спецификации — одна на все устройства и сервисы.

   Драйвер сам себя описывает: `SettingsSpec` приходит от ядра (`DeviceInfo.settings`,
   `DriverDescriptor.settings`), а правки уходят обратно интентом `setParams`. Значит
   рисовать под каждую железку свой экран не нужно и вредно: OrangeLink, помпа Medtronic
   и будущий вендор-аккаунт — это одна форма с разными спеками.

   Проверено на живом примере: мы шли делать «карточку настроек OrangeLink» и ошиблись —
   у радиомоста пользовательских параметров нет вовсе, а серийник и частота 868/916
   принадлежат драйверу помпы за ним (SugarLifeCore#4). Экран под конкретную железку
   пришлось бы выбросить; форма по спеке пережила это без единой правки.

   Пустая спека — законное состояние, а не ошибка: у транспорта настраивать нечего.
   В этом случае форма не рисует ничего, и вызывающему не нужно про это думать. */

export interface ParamsFormProps {
  spec: SettingsSpec | null | undefined;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  /** Нажали «Сканировать» у параметра с `scan: 'qr'`. Нет обработчика — нет кнопки. */
  onScan?: (key: string) => void;
  /** Заголовок над формой; не передан — формa идёт без заголовка. */
  title?: string;
}

export default function ParamsForm({ spec, values, onChange, onScan, title }: ParamsFormProps) {
  const params = spec?.parameters ?? [];
  if (!params.length) return null;

  return (
    <>
      {title && <div className="section-label sec">{title}</div>}
      {params.map((p) => {
        const value = values[p.key] ?? '';
        if (p.type === 'Bool') {
          const on = value === 'true' || (value === '' && p.default === 'true');
          return (
            <div key={p.key} className="list">
              <div className="list-row">
                <span className="pick-main">
                  <span className="list-title">{p.title}</span>
                  {p.hint && <span className="pick-sub">{p.hint}</span>}
                </span>
                <IonToggle checked={on} onIonChange={(e) => onChange(p.key, String(e.detail.checked))} />
              </div>
            </div>
          );
        }

        if (p.type === 'Enum') {
          return (
            <div key={p.key} className="param">
              <div className="field-label">{p.title}{p.required && <span className="param-req"> · обязательно</span>}</div>
              {p.hint && <div className="field-hint param-hint">{p.hint}</div>}
              <div className="period">
                {p.options.map((o) => (
                  <button key={o}
                    className={'period-seg' + ((value || p.default) === o ? ' on' : '')}
                    onClick={() => onChange(p.key, o)}>{o}</button>
                ))}
              </div>
            </div>
          );
        }

        /* Secret — только на запись (SugarLifeCore#3): значение никогда не приходит
           обратно из снимка, поэтому поле всегда пустое, а «задано или нет» показывает
           состояние самой записи, а не подставленные звёздочки. */
        const secret = p.type === 'Secret';
        return (
          <div key={p.key} className="param">
            <div className="field-label">{p.title}{p.required && <span className="param-req"> · обязательно</span>}</div>
            <div className="field">
              <IonInput
                value={value}
                type={secret ? 'password' : p.type === 'Number' ? 'number' : 'text'}
                /* Клавиатуру выбираем отдельно от типа: серийник помпы — текст (ведущие
                   нули существуют), но набирают его цифрами, и буквенная раскладка тут
                   лишний шаг у человека, который смотрит на наклейку сзади помпы. */
                inputmode={p.keyboard ?? (p.type === 'Number' ? 'numeric' : undefined)}
                autocapitalize="off"
                placeholder={p.default ?? (secret ? '' : 'не задано')}
                onIonInput={(e) => onChange(p.key, e.detail.value ?? '')}
              />
              {p.scan === 'qr' && onScan && (
                <button className="field-copy" onClick={() => onScan(p.key)} aria-label="Сканировать QR">
                  <IonIcon icon={qrCodeOutline} />
                </button>
              )}
            </div>
            {/* Подсказку пишет тот, кто знает железку, — ядро. Мы её только показываем:
                хардкод под конкретный коннектор здесь означал бы, что каждое новое
                устройство требует правки интерфейса. */}
            {p.hint && <div className="field-hint param-hint">{p.hint}</div>}
          </div>
        );
      })}
    </>
  );
}
