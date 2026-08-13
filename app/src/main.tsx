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
import { notifyAppReady } from '@/platform/appUpdate'
import { завестиСторожа } from '@/platform/rescue'

setupIonicReact({ mode: 'ios' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Сообщаем Capgo, что бандл успешно загрузился — иначе он откатит OTA-обновление.
notifyAppReady()

/* И сторожу запуска — что приложение ожило (public/boot-guard.js, #131). Отсюда, а не
   из App: пока эта строка выполнилась, первый кадр уже нарисован, а любое место внутри
   дерева зависело бы от того, что дерево вообще собралось. */
завестиСторожа()
