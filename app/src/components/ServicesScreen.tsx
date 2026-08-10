import { IonIcon } from '@ionic/react';
import PageHead from './PageHead';
import Row from './Row';
import { cloudOutline, addCircleOutline, pulse, flash } from 'ionicons/icons';
import { useClouds, addCloud, type CloudConfig } from '../data/clouds';
import CloudSheet from './CloudSheet';
import { useStack } from '../data/stackCtx';

/* Профиль → «Сервисы» — отдельный полноэкранный раздел (docs/CONNECT-UX.md §10,
   §2b). Список облаков, а не одно поле: можно держать несколько Nightscout одновременно
   (свой + партнёра), у каждого — своя роль («забираем» глюкозу и/или статус помпы). */
export default function ServicesScreen({ onClose }: { onClose: () => void }) {
  const clouds = useClouds();
  const { push, pop } = useStack();

  const openCloud = (id: string) => push(<CloudSheet cloudId={id} onClose={pop} />);

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

  return (
    <div className="sheet stack-body">
        <PageHead title="Сервисы" subtitle="Профиль · Сервисы" onBack={onClose} />
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
    </div>
  );
}
