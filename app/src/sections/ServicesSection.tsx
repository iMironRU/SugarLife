import Иконка from '@/ui/Иконка';
import { CloudSection, CloudAccountsSection } from '@/sections/lazy';
import Section from '@/ui/Section';
import Row from '@/ui/Row';
import { useSnapshot } from '@/sources/bridge';
import { cloudOutline, addCircleOutline, pulse, flash, personCircleOutline } from 'ionicons/icons';
import { useClouds, addCloud, type CloudConfig } from '@/sources/clouds';
import { useStack } from '@/app/stackCtx';

/* Профиль → «Сервисы» — отдельный полноэкранный раздел (docs/CONNECT-UX.md §10,
   §2b). Список облаков, а не одно поле: можно держать несколько Nightscout одновременно
   (свой + партнёра), у каждого — своя роль («забираем» глюкозу и/или статус помпы). */
/* Раздел живёт вкладкой внутри «Устройств и данных» (SugarLife#279). */
export default function ServicesSection({ onClose, встроенный }: {
  onClose?: () => void; встроенный?: boolean;
}) {
  const clouds = useClouds();
  const { push, pop } = useStack();
  const снимок = useSnapshot();

  const openCloud = (id: string) => push(<CloudSection cloudId={id} onClose={pop} />, { id: 'облако', cloudId: id });

  const onAdd = () => {
    const c = addCloud({
      kind: 'nightscout', name: 'Новое облако', url: '', token: '', enabled: false,
      sourceGlucose: true, sourcePumpStatus: true,
    });
    openCloud(c.id);
  };

  /* Роли — иконками, а не словами: адрес Nightscout длинный, и подпись «глюкоза · помпа»
     отбирала у него половину строки, из-за чего адрес переносился посреди слова.
     Иконки те же, что на панели и в карточках: пульс — глюкоза, молния — помпа. */
  const roleIcons = (c: CloudConfig) => {
    if (!c.enabled) return <span className="list-value">выкл</span>;
    if (!c.sourceGlucose && !c.sourcePumpStatus) return <span className="list-value">ничего не берём</span>;
    return (
      <span className="list-roles">
        {c.sourceGlucose && <Иконка icon={pulse} aria-label="глюкоза" title="глюкоза" />}
        {c.sourcePumpStatus && <Иконка icon={flash} aria-label="статус помпы" title="статус помпы" />}
      </span>
    );
  };

  const тело = (
    <>
        {/* Два вида облаков названы по владельцу, а не одним словом (#279).

            «Облако» у нас значило две разные вещи, и человек честно путался: в слотах
            это ПУТЬ к прибору, а здесь — учётная запись. Плюс в одном списке лежали
            свой сервер (адрес и токен, туда пишут) и чужой сервис (логин с паролем,
            только чтение, данные могут быть другого человека). Разделили по владельцу:
            вопрос «моё или чужое» человек решает раньше всех остальных. */}
        <div className="section-label sec">Мой сервер</div>
        <div className="list">
          {clouds.length === 0 && (
            <Row title="Своего сервера нет" titleMuted />
          )}
          {clouds.map((c) => (
            <Row key={c.id} icon={cloudOutline} title={c.name || 'Nightscout'} oneLine
              value={roleIcons(c)} onClick={() => openCloud(c.id)} />
          ))}
          <Row icon={addCircleOutline} title="Добавить свой сервер" chevron={false} onClick={onAdd} />
        </div>

        {/* Учётки вендоров — отдельным входом, а не в том же списке (SugarLifeCore#52).

            Nightscout выше — СВОЙ сервер: адрес, токен, туда пишут. Облако вендора —
            ЧУЖОЙ: логин с паролем, чаще всего только чтение, и данные там могут
            принадлежать другому человеку. Сложить их в один список значит попросить
            человека различать это самому.

            Вход виден, только когда движок отдал каталог: без адаптеров это была бы
            дверь в пустую комнату. */}
        <div className="metric-note">
          Nightscout — ваш сервер: адрес и токен, туда же можно писать. Дальше — сервисы
          производителей: вход по учётной записи, чтение чужого сервера.
        </div>

        {(снимок?.availableCloudProviders?.length ?? 0) > 0 && (
          <>
            <div className="section-label sec">Сервисы производителей</div>
            <div className="list">
              <Row icon={personCircleOutline} title="Учётные записи"
                sub="LibreLinkUp, Dexcom Share и другие"
                onClick={() => push(<CloudAccountsSection onClose={pop} />, { id: 'учётки' })} />
            </div>
          </>
        )}
    </>
  );

  if (встроенный) return тело;
  return (
    <Section title="Сервисы" описание="Nightscout и другие серверы, через которые приходят и уходят данные. Прибор — это ЧТО, сервис — это КАК." onBack={onClose ?? (() => {})}>
      {тело}
    </Section>
  );
}
