import { Capacitor } from '@capacitor/core';

/* Камера вместо восьми символов руками (SugarLife#350).

   `XDUD671K` с коробки сенсора вводят вручную, и ошибка в нём выглядит как «сенсор не
   отвечает»: человек идёт искать неисправность в приборе, которого нет. Тем же кодом
   опознаётся свой сенсор среди чужих в эфире (SugarLifeCore#70) — то есть опечатка ломает
   и поиск.

   ЧТО МЫ ВОЗВРАЩАЕМ: строку КАК ЕСТЬ и тип носителя. Разбирать — ядру (#350): на
   этикетке Sibionics два кода, и в UDI код подключения лежит ВНУТРИ серийника
   (`260430XDUD671KHP20`), а на линейном может быть сам по себе. Правило разбора зависит
   от производителя и меняется вместе с ним; окажись оно здесь — каждый новый сенсор
   требовал бы правки экрана. По той же причине, по которой у нас нет ни подсказок к
   полям, ни списка моделей (SugarLifeCore#16).

   Пробелы срезаем — это не разбор, а мусор носителя: камера и буфер обмена добавляют их
   по-разному. Регистр НЕ трогаем: в QR бывает не код, а ссылка, и «привести к верхнему»
   сломало бы её молча. */

export type ТипКода = 'qr' | 'dataMatrix' | 'code128' | 'иной';

export interface Прочитанное {
  текст: string;
  тип: ТипКода;
}

/* Форматы просим ровно те, что бывают на упаковках сенсоров: QR, DataMatrix (им печатают
   UDI) и Code128 (длинный линейный). Узкий список — это скорость распознавания, а не
   придирчивость: сканер не перебирает то, чего там не бывает. */
const ФОРМАТЫ: Record<string, ТипКода> = {
  QR_CODE: 'qr', DATA_MATRIX: 'dataMatrix', CODE_128: 'code128',
};

/* Есть ли сканер ЗДЕСЬ И СЕЙЧАС — спрашиваем, а не выводим из платформы.

   «Натив» на этот вопрос не отвечает. Проект iOS собирается через Swift Package Manager,
   а у плагина сканера пакета SPM нет — на айфоне он в сборку не попадает вовсе, и вызов
   упал бы с «не реализовано». Кнопка, которая заведомо не работает, читается как поломка
   приложения, а не как «этого пока нет».

   Проверка асинхронная и в try: на платформе без плагина сам вызов и есть ответ. Появится
   пакет — кнопка включится сама, без правок здесь. */
export async function можноСканировать(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
    const { supported } = await BarcodeScanner.isSupported();
    return supported;
  } catch {
    return false;
  }
}

export type Причина = 'нет-разрешения' | 'не-поддерживается' | 'ошибка';

export class ОтказКамеры extends Error {
  причина: Причина;
  constructor(причина: Причина, сообщение: string) {
    super(сообщение);
    this.причина = причина;
  }
}

/** Класс на <body>: пока он висит, приложение прозрачно и под ним видно камеру. */
export const КЛАСС_СКАНА = 'скан-идёт';

/* Читаем СВОЕЙ камерой, а не сканером сервисов Google.

   Соблазн был: у плагина есть `scan()`, он открывает готовое окно Google, не требует
   разрешения и не нуждается во встроенной модели. Но работает только там, где есть
   сервисы Google, — а телефон, на котором это и ловят (HUAWEI P40 lite), из тех, что
   ездят без них. Сканер, который не открывается на телефоне заказчика, не сканер.

   Модель мы всё равно везём с собой: она в APK, из-за неё он и потяжелел. Значит и
   пользуемся ею — тогда скан работает офлайн и на телефонах без Google.

   Плата: камера показывается ПОД веб-слоем, и приложение на это время надо сделать
   прозрачным. Отсюда класс на body и обязательная уборка за собой: не снять его —
   человек останется смотреть в невидимое приложение. */
async function разрешитьКамеру(
  scanner: typeof import('@capacitor-mlkit/barcode-scanning').BarcodeScanner,
): Promise<void> {
  const текущее = await scanner.checkPermissions();
  if (текущее.camera === 'granted' || текущее.camera === 'limited') return;
  const после = await scanner.requestPermissions();
  if (после.camera === 'granted' || после.camera === 'limited') return;
  throw new ОтказКамеры('нет-разрешения',
    'Камера не разрешена. Разрешите доступ в настройках телефона — или введите код руками.');
}

/** Открыть камеру и вернуть прочитанное. Отменил человек — вернём null, это не ошибка. */
export async function сканировать(отмена: { отменено: boolean }): Promise<Прочитанное | null> {
  if (!Capacitor.isNativePlatform()) {
    throw new ОтказКамеры('не-поддерживается', 'В браузере камеры нет — введите код с коробки руками.');
  }
  const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');

  const { supported } = await BarcodeScanner.isSupported();
  if (!supported) throw new ОтказКамеры('не-поддерживается', 'Этот телефон не умеет сканировать коды.');

  await разрешитьКамеру(BarcodeScanner);

  document.body.classList.add(КЛАСС_СКАНА);
  try {
    return await new Promise<Прочитанное | null>((готово, беда) => {
      let слушатель: { remove: () => Promise<void> } | null = null;
      const прибрать = async () => {
        await слушатель?.remove();
        await BarcodeScanner.stopScan().catch(() => { /* уже остановлен */ });
      };
      /* Отмена приходит снаружи — из наложения с кнопкой. Проверяем её тиком, потому что
         остановить чужое ожидание иначе нечем: слушатель молчит, пока код не найден. */
      const тик = window.setInterval(async () => {
        if (!отмена.отменено) return;
        window.clearInterval(тик);
        await прибрать();
        готово(null);
      }, 200);

      BarcodeScanner.addListener('barcodesScanned', async (e) => {
        const первый = e.barcodes[0];
        if (!первый) return;   // кадр без кода — просто ждём следующий
        window.clearInterval(тик);
        await прибрать();
        готово({
          текст: (первый.rawValue ?? '').trim(),
          тип: ФОРМАТЫ[String(первый.format)] ?? 'иной',
        });
      }).then((l) => {
        слушатель = l;
        return BarcodeScanner.startScan({
          formats: [BarcodeFormat.QrCode, BarcodeFormat.DataMatrix, BarcodeFormat.Code128],
        });
      }).catch(async (e: unknown) => {
        window.clearInterval(тик);
        await прибрать();
        беда(new ОтказКамеры('ошибка', 'Не получилось открыть камеру: '
          + (e instanceof Error ? e.message : String(e))));
      });
    });
  } finally {
    // Прозрачность снимаем ВСЕГДА: иначе приложение останется невидимым.
    document.body.classList.remove(КЛАСС_СКАНА);
  }
}

/** Как называется носитель — человеку, чтобы он видел, что именно прочитано. */
export const ИМЯ_ТИПА: Record<ТипКода, string> = {
  qr: 'QR-код', dataMatrix: 'DataMatrix (UDI)', code128: 'штрихкод', иной: 'код',
};
