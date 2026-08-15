import { IonIcon } from '@ionic/react';
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

  const openCloud = (id: string) => push(<CloudSection cloudId={id} onClose={pop} />);

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
        {c.sourceGlucose && <IonIcon icon={pulse} aria-label="глюкоза" title="глюкоза" />}
        {c.sourcePumpStatus && <IonIcon icon={flash} aria-label="статус помпы" title="статус помпы" />}
      </span>
    );
  };

  const тело = (
    <>
        <div className="sheet-note">
          Облако — такой же способ подключения, как мост, только со своими адресом/токеном.
          Можно держать несколько одновременно, у каждого своя роль в «Забираем отсюда».
        </div>

        <div className="section-label sec">Облака</div>
        <div className="list">
          {clouds.length === 0 && (
            <Row title="Нет ни одного облака" titleMuted />
          )}
          {clouds.map((c) => (
            <Row key={c.id} icon={cloudOutline} title={c.name || 'Nightscout'} oneLine
              value={roleIcons(c)} onClick={() => openCloud(c.id)} />
          ))}
          <Row icon={addCircleOutline} title="Добавить облако" chevron={false} onClick={onAdd} />
        </div>

        {/* Учётки вендоров — отдельным входом, а не в том же списке (SugarLifeCore#52).

            Nightscout выше — СВОЙ сервер: адрес, токен, туда пишут. Облако вендора —
            ЧУЖОЙ: логин с паролем, чаще всего только чтение, и данные там могут
            принадлежать другому человеку. Сложить их в один список значит попросить
            человека различать это самому.

            Вход виден, только когда движок отдал каталог: без адаптеров это была бы
            дверь в пустую комнату. */}
        {(снимок?.cloudProviders?.length ?? 0) > 0 && (
          <>
            <div className="section-label sec">Учётные записи</div>
            <div className="list">
              <Row icon={personCircleOutline} title="Облачные учётки"
                sub="LibreLinkUp, Dexcom Share и другие сервисы производителей"
                onClick={() => push(<CloudAccountsSection onClose={pop} />)} />
            </div>
          </>
        )}
    </>
  );

  if (встроенный) return тело;
  return (
    <Section title="Сервисы" subtitle="Профиль · Сервисы" onBack={onClose ?? (() => {})}>
      {тело}
    </Section>
  );
}
