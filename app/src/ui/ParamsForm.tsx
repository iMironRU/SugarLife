import { IonIcon, IonInput, IonToggle } from '@ionic/react';
import { qrCodeOutline, openOutline } from 'ionicons/icons';
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

/* «Подробнее» — ссылка наружу, на гайд (SugarLifeCore#16).

   Подсказка под полем отвечает на «что сюда вписать». На «как это получить» она ответить
   не может: поднять Nightscout или выдать токен с правом записи — это страница текста, а
   не строка под полем. Раньше такие вещи заканчивались тем, что человек шёл искать ответ
   в поиске и находил чужую инструкцию к другой версии.

   Адрес приходит от ядра вместе с параметром. Своих ссылок мы не подставляем по той же
   причине, по которой не пишем подсказок: знание о железке живёт у того, кто её знает.

   ЗЕРКАЛО — ЗАПАСНОЙ ВЫХОД, А НЕ ВТОРАЯ КНОПКА (core#114). Тот же текст лежит в
   репозитории и отвечает даже там, где основной домен ещё не разрешается. Но поставить
   их рядом нельзя: два одинаковых «подробнее» у одного поля человек читает как выбор,
   которого нет, — и первым делом попробует угадать, чем они отличаются. Поэтому зеркало
   появляется отдельной, тихой строкой и названо тем, чем является: «не открывается?». */
function Подробнее({ адрес, зеркало }: { адрес: string; зеркало?: string | null }) {
  return (
    <>
      <a className="param-help" href={адрес} target="_blank" rel="noreferrer">
        <IonIcon icon={openOutline} /> Подробнее
      </a>
      {зеркало && зеркало !== адрес && (
        <a className="param-help-alt" href={зеркало} target="_blank" rel="noreferrer">
          не открывается?
        </a>
      )}
    </>
  );
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
                  {p.helpUrl && <Подробнее адрес={p.helpUrl} зеркало={p.helpUrlMirror} />}
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
              {p.helpUrl && <Подробнее адрес={p.helpUrl} зеркало={p.helpUrlMirror} />}
              {/* Подпись варианта — от ядра (мост 1.23). Своей не выдумываем: `auto`,
                  `868`, `916` человеку не говорят ничего, но что именно они значат,
                  знает тот, кто знает железку. Нет подписи — показываем сам вариант:
                  так было всегда и ничего не ломает. */}
              <div className="period">
                {p.options.map((o) => (
                  <button key={o}
                    className={'period-seg' + ((value || p.default) === o ? ' on' : '')}
                    onClick={() => onChange(p.key, o)}>{p.optionTitles?.[o] ?? o}</button>
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
            {p.helpUrl && <Подробнее адрес={p.helpUrl} зеркало={p.helpUrlMirror} />}
          </div>
        );
      })}
    </>
  );
}
