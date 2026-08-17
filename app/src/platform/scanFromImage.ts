import type { Прочитанное, ТипКода } from './scanCode';

/* Чтение кода С ФОТО — одинаково в браузере и в приложении (SugarLife#350).

   Живой скан требует камеры, а камеры нет ни в PWA на десктопе, ни у проверяющего за
   столом. Фото снимает это ограничение целиком: сняли коробку один раз — и дальше
   разбираем этот же файл сколько угодно, включая браузер, где всё и проверяется.

   ДЕЛАЕМ ЭТО ВЕБОМ, А НЕ ПЛАГИНОМ, хотя плагин умеет читать картинку. Веб-путь работает
   везде одинаково — в PWA, в вебвью на телефоне, в браузере на компьютере, — и это тот
   самый случай, когда одна реализация вместо двух не экономия, а гарантия: разойтись им
   негде.

   ДВА ДЕКОДЕРА, и порядок не случаен. Встроенный в браузер быстрее и точнее: он идёт
   через системный распознаватель. Но его нет в Safari и в части сборок Chrome, а PWA
   ставят и на айфон — поэтому запасной ZXing грузим по требованию, чтобы он не весил
   ничего у тех, кому не понадобился. */

const ФОРМАТЫ_БРАУЗЕРА: Record<string, ТипКода> = {
  qr_code: 'qr', data_matrix: 'dataMatrix', code_128: 'code128',
};
const НУЖНЫЕ = ['qr_code', 'data_matrix', 'code_128'];

interface ДетекторКодов {
  detect(источник: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>;
}
type КонструкторДетектора = new (o?: { formats?: string[] }) => ДетекторКодов;

function детекторБраузера(): КонструкторДетектора | null {
  const w = window as unknown as { BarcodeDetector?: КонструкторДетектора };
  return w.BarcodeDetector ?? null;
}

async function картинка(файл: Blob): Promise<ImageBitmap> {
  return createImageBitmap(файл);
}

/** Прозрачное на белом. Без этого прозрачный фон читается как чёрный — см. ниже. */
async function наБеломФоне(и: ImageBitmap): Promise<ImageBitmap> {
  const c = document.createElement('canvas');
  c.width = и.width; c.height = и.height;
  const ctx = c.getContext('2d');
  if (!ctx) return и;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(и, 0, 0);
  и.close?.();
  return createImageBitmap(c);
}

async function черезБраузер(файл: Blob): Promise<Прочитанное[] | null> {
  const Детектор = детекторБраузера();
  if (!Детектор) return null;
  /* Тот же белый фон, что и для запасного пути: системный детектор спотыкается о
     прозрачность ровно так же. */
  const битмап = await наБеломФоне(await картинка(файл));
  try {
    const найдено = await new Детектор({ formats: НУЖНЫЕ }).detect(битмап);
    return найдено.map((к) => ({
      текст: (к.rawValue ?? '').trim(),
      тип: ФОРМАТЫ_БРАУЗЕРА[к.format] ?? 'иной',
    }));
  } finally {
    битмап.close?.();
  }
}

/* ZXing читает с канвы, через яркость пикселей.

   Крупные фото сжимаем: распознавание идёт по точкам, и снимок на двенадцать мегапикселей
   — это секунды работы там, где хватает полутора тысяч точек по длинной стороне. Причём
   лишние точки не помогают: код на них тот же, а шума больше.

   Яркость считаем сами по BT.601 — ZXing ждёт её массивом, а не цветом. Формула не
   произвольная: зелёный человеческий глаз (и камера) видят ярче, и «среднее по трём»
   размыло бы контраст ровно там, где он и решает — на границе чёрного и белого. */
async function черезZXing(файл: Blob): Promise<Прочитанное[]> {
  const { MultiFormatReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource,
    BarcodeFormat, DecodeHintType } = await import('@zxing/library');
  const битмап = await картинка(файл);
  const МАКС = 1600;
  const к = Math.min(1, МАКС / Math.max(битмап.width, битмап.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(битмап.width * к);
  canvas.height = Math.round(битмап.height * к);
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  /* Сначала белый фон, потом картинка.

     Прозрачные пиксели на пустой канве дают чёрный: PNG с прозрачным фоном (а это любой
     скриншот кода и всё, что нарисовано генератором) превращался в сплошную черноту, и
     ни один декодер там ничего не находил. Поймано на своих же тестовых картинках. */
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(битмап, 0, 0, canvas.width, canvas.height);
  битмап.close?.();

  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const яркость = new Uint8ClampedArray(width * height);
  for (let i = 0, п = 0; i < data.length; i += 4, п++) {
    яркость[п] = (data[i] * 306 + data[i + 1] * 601 + data[i + 2] * 117) >> 10;
  }

  const чтец = new MultiFormatReader();
  чтец.setHints(new Map<number, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS,
      [BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.CODE_128]],
    [DecodeHintType.TRY_HARDER, true],
  ]));
  try {
    const r = чтец.decode(new BinaryBitmap(
      new HybridBinarizer(new RGBLuminanceSource(яркость, width, height)),
    ));
    const имя = BarcodeFormat[r.getBarcodeFormat()];
    const тип: ТипКода = имя === 'QR_CODE' ? 'qr'
      : имя === 'DATA_MATRIX' ? 'dataMatrix'
      : имя === 'CODE_128' ? 'code128' : 'иной';
    return [{ текст: r.getText().trim(), тип }];
  } catch {
    return [];   // не нашли — это не ошибка, это ответ
  }
}

/** Прочитать все коды с фотографии. Пусто — значит не нашли, и об этом надо сказать. */
export async function прочитатьИзображение(файл: Blob): Promise<Прочитанное[]> {
  const быстро = await черезБраузер(файл);
  /* Встроенный детектор мог не найти ничего, а ZXing — найти: у них разные пороги на
     смазанном снимке. Поэтому пустой ответ не считаем окончательным и пробуем вторым. */
  if (быстро && быстро.length) return быстро;
  return черезZXing(файл);
}
