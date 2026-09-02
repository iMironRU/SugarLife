import Иконка from '@/ui/Иконка';
import { СЛОВО_УЧЁТКИ } from '@/слова/облака';
import { cloudOutline, checkmarkCircle, alertCircle, personOutline, hardwareChipOutline } from 'ionicons/icons';
import { useState } from 'react';
import Section from '@/ui/Section';
import Row from '@/ui/Row';
import ParamsForm from '@/ui/ParamsForm';
import { useSnapshot, sendIntent } from '@/sources/bridge';
import type { AccountView, CloudProviderView } from '@/sources/bridge';
import {
  учёткиПровайдера, нуженВыборСубъекта, активныйСубъект, имяСубъекта,
  состояниеУчётки, чтоДелать, можноВойти,
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
  const провайдеры = snap?.availableCloudProviders ?? [];
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
      <Section title={вход.displayName} subtitle="вход в облако"
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
    <Section title="Облачные учётки" описание="Входы в облака производителей. Через них читаются данные приборов, которые не отдают их напрямую." onBack={onClose}>
      {!провайдеры.length && (
        <div className="metric-note">
          Движок пока не предлагает ни одного облака. Здесь появятся LibreLinkUp,
          Dexcom Share и другие — когда они приедут в сборку.
        </div>
      )}

      {/* Сначала подключённое, потом каталог (#279). Раньше и то и другое лежало одной
          простынёй: человек видел «LibreLinkUp», «Войти», «не удалось войти» и «Dexcom
          Share — пока недоступно» подряд и не понимал, где его учётки, а где список
          того, что бывает. Порядок отвечает на вопросы по частоте: «что у меня» человек
          спрашивает каждый раз, «что бывает» — один раз при заведении. */}
      {провайдеры.map((p) => {
        const свои = учёткиПровайдера(snap, p.id);
        if (!свои.length) return null;
        return (
          <div key={p.id}>
            <div className="section-label sec">{p.displayName}</div>
            <div className="list">
              {свои.map((a) => <Учётка key={a.id} a={a} />)}
              <Row icon={cloudOutline} title="Добавить ещё одну"
                onClick={можноВойти(p) ? () => { setВход(p); setПоля({}); } : undefined} />
            </div>
          </div>
        );
      })}

      {/* Каталог — вторым блоком и целиком: сюда приходят один раз, при заведении.
          Недоступного показываем с пометкой: спрятать значило бы соврать про планы,
          показать без пометки — про готовность. */}
      <div className="section-label sec">Подключить сервис</div>
      <div className="list">
        {провайдеры.map((p) => (
          <Row key={p.id} icon={cloudOutline} title={p.displayName}
            sub={!можноВойти(p) ? 'пока недоступно'
              : p.readOnly ? 'вход по учётной записи · только чтение' : 'вход по учётной записи'}
            titleMuted={!можноВойти(p)}
            chevron={можноВойти(p)}
            onClick={можноВойти(p) ? () => { setВход(p); setПоля({}); } : undefined} />
        ))}
      </div>
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
              <Иконка icon={s.kind === 'device' ? hardwareChipOutline : personOutline} className="list-ico" />
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
