import { useState } from 'react';
import Section from '@/ui/Section';
import Row from '@/ui/Row';
import { cloudOutline } from 'ionicons/icons';
import { useStack } from '@/app/stackCtx';
import { ServicesSection } from '@/sections/lazy';
import SourcesSection from './SourcesSection';
import DevicesSection from './DevicesSection';

/* Один вход в хозяйство вместо трёх (SugarLife#279).

   Из Профиля вели три двери — «Откуда берутся данные», «Помпа, сенсоры, глюкометр,
   петля» и «Облака», — и список приборов встречался в двух из них. Человек выбирал
   дверь до того, как понимал, что ищет.

   ВХОД ОБЩИЙ, ВОПРОСЫ РАЗНЫЕ. Свести всё в один список нельзя: «почему цифры такие» —
   диагностика, с ней приходят, когда сахар отстал; «какой у меня прибор» — заведение и
   обслуживание, это бывает раз в несколько месяцев. Смешаешь — и человек ищет одно
   среди другого; мы уже дважды получали неправду там, где на два вопроса отвечало одно
   место (#230, #247).

   Поэтому вкладки, а не общий список: дверь одна, комнаты две. */
const ВКЛАДКИ = [
  { key: 'данные', label: 'Откуда данные' },
  { key: 'приборы', label: 'Мои приборы' },
] as const;
type Вкладка = typeof ВКЛАДКИ[number]['key'];

export default function DataDevicesSection({ onClose }: { onClose: () => void }) {
  const [вкладка, setВкладка] = useState<Вкладка>('данные');
  const { push, pop } = useStack();

  return (
    <Section title="Устройства и данные" subtitle="Профиль · Хозяйство" onBack={onClose}
      подШапкой={(
        <div className="period sec-switch">
          {ВКЛАДКИ.map((в) => (
            <button key={в.key} className={'period-seg' + (вкладка === в.key ? ' on' : '')}
              onClick={() => setВкладка(в.key)}>{в.label}</button>
          ))}
        </div>
      )}>
      {вкладка === 'данные' && <SourcesSection встроенный />}
      {вкладка === 'приборы' && (
        <>
          <DevicesSection встроенный />
          {/* Облака здесь же: это такой же источник, просто без батареи и без эфира.
              Отдельной дверью в Профиле они были ровно потому, что раньше «источник»
              и «прибор» лежали в разных местах. */}
          <div className="section-label sec">Облака</div>
          <div className="list">
            <Row icon={cloudOutline} title="Nightscout и другие"
              sub="адрес, токен, что из них забираем"
              onClick={() => push(<ServicesSection onClose={pop} />)} />
          </div>
        </>
      )}
    </Section>
  );
}
