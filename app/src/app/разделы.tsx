import type { ReactNode } from 'react';
import { разделProПоId } from '@/издание';
import {
  AboutSection, ОхранаSection, AlarmsSection, AnalyticsSection, AppearanceSection, PermissionsSection,
  BasalProfileSection, CloudAccountsSection,
  CloudSection, DataDevicesSection, DeviceSection, DevicesSection, DiagnosticsSection,
  HealthSection, HistorySection, LoopSection, LoopSetupSection, MealsSection, ServicesSection,
  SourcesSection, VisitNoteSection, ПравилоSection,
} from '@/sections/lazy';

/* Реестр разделов: по метке — экран (#400).

   Стек страниц хранит готовые React-узлы, а узел не пережить перезагрузку: в нём
   замыкания, обработчики, ссылка на pop. Поэтому вместе с узлом кладём МЕТКУ — что это
   за раздел и с чем открыт, — а после перезапуска собираем узел заново по метке.

   Метка описана типом, а не строкой со свободными полями: раздел, открытый с чужими
   параметрами, — это раздел, который упадёт или соврёт. Компилятор ловит это здесь, а не
   человек на телефоне.

   Раздела нет в реестре — восстановление на нём ОСТАНАВЛИВАЕТСЯ, и это правильнее, чем
   пропустить его и открыть то, что было над ним: иначе человек окажется на карточке
   помпы, не имея под ней списка приборов, и кнопка «назад» уведёт его не туда, откуда
   он пришёл. */

export type Метка =
  | { id: 'приборы'; вкладка?: 'данные' | 'приборы' | 'облака' }
  | { id: 'категория'; cat: 'sensor' | 'pump' | 'meter' | 'loop'; title: string }
  | { id: 'облако'; cloudId: string }
  | { id: 'учётки' }
  | { id: 'базал' }
  | { id: 'петля' }
  | { id: 'настройкаПетли' }
  | { id: 'здоровье' }
  | { id: 'охрана' }
  | { id: 'тревоги' }
  /* Правка одного правила тревоги (#590). Ключ правила, а не готовое правило: стек хранит метку,
     и после перезапуска страница обязана собраться на СЕГОДНЯШНИХ числах, а не на тех, что были
     в момент открытия. */
  | { id: 'правило'; ruleId: string; title: string }
  | { id: 'диагностика' }
  /* Часть раздела — чтобы восстановление после перезапуска возвращало туда же, откуда ушли
     (два входа, #554). Без неё человек, закрывший телефон на «Экране блокировки и значке»,
     возвращался бы в общий список. */
  | { id: 'оформление'; часть?: 'показ' | 'вид' }
  | { id: 'разрешения' }
  | { id: 'оПриложении' }
  | { id: 'история' }
  | { id: 'приёмы' }
  | { id: 'мойСписок' }
  | { id: 'сервисы' }
  | { id: 'источники' }
  | { id: 'разбор' }
  | { id: 'кПриёму' }
  /* Раздел издания Pro (#296). Метка общая, а какой именно раздел — строкой: в Lite-сборке их нет
     вовсе, и знать их имена общему коду незачем. */
  | { id: 'pro'; раздел: string };

export function собрать(м: Метка, pop: () => void): ReactNode | null {
  switch (м.id) {
    case 'приборы': return <DataDevicesSection onClose={pop} вкладка={м.вкладка} />;
    case 'категория': return <DeviceSection cat={м.cat} title={м.title} onClose={pop} />;
    case 'облако': return <CloudSection cloudId={м.cloudId} onClose={pop} />;
    case 'учётки': return <CloudAccountsSection onClose={pop} />;
    case 'базал': return <BasalProfileSection onClose={pop} />;
    case 'петля': return <LoopSection onClose={pop} />;
    case 'настройкаПетли': return <LoopSetupSection onClose={pop} />;
    case 'здоровье': return <HealthSection onClose={pop} />;
    case 'охрана': return <ОхранаSection onClose={pop} />;
    case 'тревоги': return <AlarmsSection onClose={pop} />;
    case 'правило': return <ПравилоSection ruleId={м.ruleId} title={м.title} onClose={pop} />;
    case 'диагностика': return <DiagnosticsSection onClose={pop} />;
    case 'оформление': return <AppearanceSection onClose={pop} часть={м.часть} />;
    case 'разрешения': return <PermissionsSection onClose={pop} />;
    case 'оПриложении': return <AboutSection onClose={pop} />;
    case 'история': return <HistorySection onClose={pop} />;
    case 'приёмы': return <MealsSection onClose={pop} />;
    case 'мойСписок': return <DevicesSection onClose={pop} />;
    case 'сервисы': return <ServicesSection onClose={pop} />;
    case 'источники': return <SourcesSection onClose={pop} />;
    case 'разбор': return <AnalyticsSection onClose={pop} />;
    case 'кПриёму': return <VisitNoteSection onClose={pop} />;
    /* Раздел Pro восстанавливаем, только если он есть в этой сборке И реестр уже загружен. Иначе
       возвращаем null — восстановление остановится на нём, как и на любом незнакомом разделе. Это
       честнее, чем открыть то, что было над ним. */
    case 'pro': {
      const р = разделProПоId(м.раздел);
      return р ? <р.Экран onClose={pop} /> : null;
    }
    default: return null;
  }
}
