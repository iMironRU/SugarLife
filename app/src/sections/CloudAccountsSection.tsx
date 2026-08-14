import { IonIcon } from '@ionic/react';
import { cloudOutline, checkmarkCircle, alertCircle, personOutline, hardwareChipOutline } from 'ionicons/icons';
import { useState } from 'react';
import Section from '@/ui/Section';
import Row from '@/ui/Row';
import ParamsForm from '@/ui/ParamsForm';
import { useSnapshot, sendIntent } from '@/sources/bridge';
import type { AccountView, CloudProviderView } from '@/sources/bridge';
import {
  учёткиПровайдера, нуженВыборСубъекта, активныйСубъект, имяСубъекта,
  состояниеУчётки, СЛОВО_УЧЁТКИ, чтоДелать, можноВойти,
} from '@/domain/cloudAccounts';

/* Облачные учётки вендоров (SugarLifeCore#52, rev ≥ 1.10).

   Отдельно от «Сервисов» с Nightscout, и это не деление по красоте. Nightscout — СВОЙ
   сервер: адрес, токен, туда пишут. Облако вендора — ЧУЖОЙ: логин и пароль от учётной
   записи, часто только чтение, и данные там могут принадлежать другому человеку
   (родитель смотрит ребёнка). Смешать их в одном списке значит попросить человека
   различать это самому.

   Экран рисуется, только когда движок отдал каталог: без адаптеров показывать список
   облаков, в которые нельзя войти, — обещание, которого мы не выполним. */
export default function CloudAccountsSection({ onClose }: { onClose: () => void }) {
  const snap = useSnapshot();
  const провайдеры = snap?.cloudProviders ?? [];
  const [вход, setВход] = useState<CloudProviderView | null>(null);
  const [поля, setПоля] = useState<Record<string, string>>({});

  const войти = () => {
    if (!вход) return;
    void sendIntent({ type: 'linkAccount', providerId: вход.id, params: поля });
    /* Форму закрываем сразу: вход асинхронный, и ответ интента подтверждает только
       приём. Результат человек увидит в карточке учётки — там же, где он будет его
       искать в следующий раз. Держать форму открытой «до ответа» значит показывать
       вертящийся кружок неизвестной длительности и запирать пароль на экране. */
    setВход(null);
    setПоля({});
  };

  if (вход) {
    return (
      <Section title={вход.displayName} subtitle="Вход в облако"
        onBack={() => { setВход(null); setПоля({}); }}
        действие={<button className="head-next" onClick={войти}>Войти</button>}>
        <ParamsForm spec={вход.settings} values={поля}
          onChange={(k, v) => setПоля((п) => ({ ...п, [k]: v }))} />
        {/* Про регион говорим ДО входа, а не после ошибки: список регионов — обычное
            поле формы, и человек, который не знает своего, промахнётся с первого раза.
            Ошибка потом объяснит, но лишний круг он уже сделает. */}
        <div className="sheet-note">
          Пароль уходит только в движок и обратно не читается: в снимке видно лишь
          состояние учётки. {вход.readOnly && 'Это чужое облако — мы из него только читаем.'}
        </div>
      </Section>
    );
  }

  return (
    <Section title="Облачные учётки" subtitle="Профиль · Сервисы · Учётки" onBack={onClose}>
      {!провайдеры.length && (
        <div className="metric-note">
          Движок пока не предлагает ни одного облака. Здесь появятся LibreLinkUp,
          Dexcom Share и другие — когда они приедут в сборку.
        </div>
      )}

      {провайдеры.map((p) => {
        const свои = учёткиПровайдера(snap, p.id);
        return (
          <div key={p.id}>
            <div className="section-label sec">{p.displayName}</div>
            <div className="list">
              {свои.map((a) => <Учётка key={a.id} a={a} />)}
              {/* Недоступного провайдера показываем, но войти не даём: спрятать значило
                  бы соврать про планы, показать без пометки — про готовность. */}
              <Row icon={cloudOutline}
                title={можноВойти(p) ? 'Войти в учётную запись' : 'Пока недоступно'}
                sub={p.readOnly ? 'чужое облако — только чтение' : undefined}
                titleMuted={!можноВойти(p)}
                chevron={можноВойти(p)}
                onClick={можноВойти(p) ? () => { setВход(p); setПоля({}); } : undefined} />
            </div>
          </div>
        );
      })}
    </Section>
  );
}

function Учётка({ a }: { a: AccountView }) {
  const состояние = состояниеУчётки(a);
  const делать = чтоДелать(a);
  const субъект = активныйСубъект(a);

  return (
    <>
      <Row icon={состояние === 'ошибка' ? alertCircle : checkmarkCircle}
        title={a.displayName}
        sub={[СЛОВО_УЧЁТКИ[состояние], субъект ? имяСубъекта(субъект) : null].filter(Boolean).join(' · ')}
        chevron={false} />

      {/* Слова движка — как есть. LibreLinkUp живёт в двенадцати регионах, и вход не в
          тот отвечает не «неверный пароль», а указанием региона. Своё «проверьте
          пароль» отправило бы человека менять верный пароль (domain/cloudAccounts.ts). */}
      {делать && <div className="sheet-note warn">{делать}</div>}

      {/* Выбор субъекта — только когда их больше одного: единственный движок выбирает
          сам, и подтверждать уже решённое человека просить незачем. */}
      {нуженВыборСубъекта(a) && (
        <>
          <div className="section-label sec">Чьи данные читаем</div>
          {/* Пояснение стоит НАД списком, а не подписью к каждому пункту. Подпись
              «данные другого человека» под собственным именем — неправда: под учёткой
              LibreLinkUp лежат и свои данные, и подопечных, а кто здесь кто, знает
              только сам человек. */}
          <div className="metric-note">
            Под одной учётной записью бывают данные нескольких человек или приборов.
          </div>
          {(a.subjects ?? []).map((s) => (
            <button key={s.id}
              className={'list-row pick-row' + (s.id === a.activeSubjectId ? ' on' : '')}
              onClick={() => void sendIntent({ type: 'selectAccountSubject', accountId: a.id, subjectId: s.id })}>
              <IonIcon icon={s.kind === 'device' ? hardwareChipOutline : personOutline} className="list-ico" />
              <span className="pick-main">
                <span className="list-title">{имяСубъекта(s)}</span>
              </span>
            </button>
          ))}
        </>
      )}
    </>
  );
}
