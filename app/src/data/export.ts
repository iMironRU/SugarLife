/* Экспорт локальной истории глюкозы (IndexedDB) в CSV — данные пользователя,
   выгружаются на его устройство одним файлом. */
import { getSince } from './db';

function csvName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `sugarlife-glucose-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.csv`;
}

// Возвращает число выгруженных записей (0 — данных нет).
export async function exportGlucoseCsv(days = 90): Promise<number> {
  const entries = await getSince(Date.now() - days * 86400e3);
  if (!entries.length) return 0;
  entries.sort((a, b) => a.t - b.t);

  const head = 'datetime_iso,epoch_ms,mmol_l,mg_dl,direction';
  const rows = entries.map((e) =>
    `${new Date(e.t).toISOString()},${e.t},${e.mmol.toFixed(1)},${e.mgdl},${e.dir}`
  );
  const csv = '﻿' + [head, ...rows].join('\r\n'); // BOM — чтобы Excel понял UTF-8

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = csvName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return entries.length;
}
