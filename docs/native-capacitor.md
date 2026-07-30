# Нативная сборка (Capacitor)

Приложение остаётся PWA (деплой на GitHub Pages без изменений), а Capacitor
заворачивает тот же веб-бандл (`app/dist`) в нативные iOS/Android проекты.

- **App ID:** `ru.imiron.sugarlife` (можно менять до публикации в сторах)
- **Имя проекта:** `SugarLife` (отображаемое «СладкаяЖизнь» задаётся в нативных строках)
- Конфиг: `app/capacitor.config.ts`
- Нативные проекты: `app/ios/`, `app/android/` (в репозитории)

## Рабочий цикл

Из папки `app/`:

```bash
npm run build        # собрать веб
npx cap sync         # скопировать веб + плагины в нативку
```

Удобные скрипты:

```bash
npm run cap:ios       # build + sync + открыть Xcode
npm run cap:android   # build + sync + открыть Android Studio
```

## iOS (нужен Mac + Xcode)

Capacitor 8 использует **Swift Package Manager** — CocoaPods не нужен.

1. Установить Xcode (App Store).
2. На iPhone включить **Режим разработчика** (Настройки → Конфиденциальность → Режим разработчика, iOS 16+).
3. `npm run cap:ios` → в Xcode выбрать свою команду подписи (Signing & Capabilities), подключить iPhone, Run.

| | Бесплатный Apple ID | Apple Developer Program ($99/год) |
|---|---|---|
| Установка на свой телефон | ✅ через кабель | ✅ + TestFlight (по воздуху) |
| Срок жизни сборки | 7 дней | 1 год |
| HealthKit | ❌ | ✅ |
| Локальные уведомления | ✅ | ✅ |

## Android (проще всего — без Mac и аккаунтов)

1. Установить Android Studio (тянет SDK).
2. `npm run cap:android` → Run на устройстве/эмуляторе, либо собрать APK и поставить вручную.
3. Health Connect и локальные уведомления тестируются бесплатно.

## Что дальше (план)

- Плагин `@capgo/capacitor-health` (или `capacitor-health-extended`) → адаптер
  `HealthSource` рядом с `nightscout.ts`, чтение глюкозы из HealthKit/Health Connect.
- `@capacitor/local-notifications` → напоминания об уходе (замены расходников,
  «нет углеводов») из движка `analysis.ts`.
- Иконки/сплэш регенерируются из `app/resources/` командой `npx @capacitor/assets generate`
  (только для нативки; веб-манифест и иконки в `app/public/` править отдельно).
