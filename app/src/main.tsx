import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setupIonicReact } from '@ionic/react'

// Рано регистрируем нативный мост: в оболочке ставит window.SugarLifeBridge,
// в браузере — no-op (getBridge подхватит Nightscout-шим).
import './native/sugarLifeBridge'

/* Базовые стили Ionic */
import '@ionic/react/css/core.css'
import '@ionic/react/css/normalize.css'
import '@ionic/react/css/structure.css'
import '@ionic/react/css/typography.css'
import '@ionic/react/css/padding.css'
import '@ionic/react/css/flex-utils.css'
import '@ionic/react/css/palettes/dark.class.css'

/* Наша тема (токены Nocturne + проброс в Ionic) */
import './theme/variables.css'
import './theme/app.css'

import App from '@/app/App'
import { notifyAppReady, запомнитьНативнуюСборку, APP_BUILD } from '@/platform/appUpdate'
import { отметитьСборку } from '@/sources/дневникStore'
import { следитьЗаРазмером } from '@/platform/размерТекста'
import { завестиСторожа } from '@/platform/rescue'

setupIonicReact({ mode: 'ios' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Сообщаем Capgo, что бандл успешно загрузился — иначе он откатит OTA-обновление.
notifyAppReady()

// И себе — из какой сборки собран установленный APK: после OTA это уже не узнать (#238).
запомнитьНативнуюСборку()

/* В дневник — если сборка сменилась с прошлого запуска (#396). «Запрос на обновление»
   человек видел на «Сегодня», и в истории он ищет ответ на «когда же оно приехало». */
отметитьСборку(APP_BUILD)

/* Системный размер текста (#325). На Android rem масштабирует сам браузер, на iOS —
   никто: там про Dynamic Type надо спрашивать и ставить корню руками. */
следитьЗаРазмером()

/* И сторожу запуска — что приложение ожило (public/boot-guard.js, #131). Отсюда, а не
   из App: пока эта строка выполнилась, первый кадр уже нарисован, а любое место внутри
   дерева зависело бы от того, что дерево вообще собралось. */
завестиСторожа()
