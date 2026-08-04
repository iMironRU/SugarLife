# Нативный мост (SugarLifeBridge) — интеграция (build-from-source)

Добавляет **нативную сторону** `window.SugarLifeBridge`. `bridge.ts` уже реализует контракт —
здесь недостающая нативная половина: KMP-движок за Capacitor-плагином. После встраивания
приложение в оболочке **само** переключается с Nightscout-шима на нативный мост; в браузере
продолжает через Nightscout.

Движок **собирается из исходников** (репозиторий `sugarlife-core`) на каждой сборке Xcode —
бинарника в git нет. Пока это **скелет**: движок кормится симулятором (без BLE), проверяет
вертикаль натив → мост → webview → UI. Реальные драйверы впаиваются в движок позже.

## Что в PR

| Файл | Что |
|---|---|
| `app/ios/App/App/SugarLifeBridgePlugin.swift` | Capacitor-плагин: держит движок, инжектит мост |
| `app/ios/build-engine.sh` | build-phase-скрипт: собирает движок из `sugarlife-core` |
| `app/ios/engine-path.local.example` | пример конфига пути к движку (скопировать → `engine-path.local`) |
| `app/src/native/sugarLifeBridge.ts` | JS-шим: ставит `window.SugarLifeBridge` (нативный хост) |
| `app/src/main.tsx` | ранний импорт шима |
| `app/src/data/bridge.ts` | rev 1.1: типы истории + опциональный `query()` |

## Предпосылки

- Репозиторий движка **`sugarlife-core`** на машине сборки. JDK 17 (для gradle).
- `SugarLifeEngine` API — строковый (JSON): `subscribe(onSnapshot:)`, `sendIntent(json:)`, `query(json:)`, `startAsync()`.

## Настройка (один раз на машину)

1. Указать путь к движку: `cp app/ios/engine-path.local.example app/ios/engine-path.local`,
   вписать абсолютный путь к `sugarlife-core` (файл gitignored). Либо env `SUGARLIFE_CORE_DIR`.

## Шаги в Xcode (в реальном проекте, вслепую не делать)

1. `npm install && npm run cap:sync`, затем `npm run cap:ios` (откроет проект).
2. Таргет **App → Build Phases → +  → New Run Script Phase**. Перетащить её **выше `Compile Sources`**.
   Скрипт:
   ```sh
   "$SRCROOT/build-engine.sh"
   ```
   (снять галку «Based on dependency analysis», чтобы шла каждый раз).
3. Один раз собрать (⌘B) — скрипт положит `SugarLifeKit.framework` в build-продукты.
4. Таргет **App → General → Frameworks, Libraries, and Embedded Content → +** → добавить
   `SugarLifeKit.framework` (из build-продуктов). Статус: **Do Not Embed** (статический фреймворк).
5. **Build Settings → Framework Search Paths** содержит `$(BUILT_PRODUCTS_DIR)` (обычно уже есть).
6. Плагин `SugarLifeBridgePlugin.swift` — в таргете App (member of App). Capacitor 6+ автообнаруживает
   `CAPPlugin`+`CAPBridgedPlugin`. Если не поднялся — зарегистрировать явно при старте bridge.
7. ⌘R на симуляторе.

## Как проверить

- `window.SugarLifeBridge.bridgeRevision === '1.1'`, `getBridge()` возвращает нативный мост.
- `useSnapshot()` → снимок с «Симулятор CGM» / «Симулятор помпы» и глюкозой.
- `sendIntent(...)` → `{accepted:true}` на валидный Intent.

## Обновление движка

Просто пересобрать приложение (⌘B/⌘R) — build-phase соберёт свежий движок из `sugarlife-core`.
Ручных шагов с фреймворком больше не нужно.

## На будущее (не в этом PR)

- Когда движок стабилизируется — перейти на **SPM binary target** (версионированный XCFramework
  из GitHub Release, напр. через KMMBridge) — для стора/команды/CI.
- Реальный драйвер Sibionics в движке (контракт тот же).
- Фоновая работа BLE, когда webview спит.
