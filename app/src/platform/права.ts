import { registerPlugin, Capacitor } from '@capacitor/core';
import { уНатива } from './уНатива';
import type { ПунктНатива } from '@/показ/разрешения';

/* МОСТ К СИСТЕМНЫМ РАЗРЕШЕНИЯМ (SugarLife#538).

   Натив отдаёт коды и состояния, слова живут в `показ/разрешения.ts`. Здесь только дорога.

   В ВЕБЕ ЭТОГО РАЗДЕЛА НЕТ, и это не упущение: у страницы в браузере нет ни Bluetooth-разрешения,
   ни фонового обновления, ни срочных уведомлений — показывать было бы нечего, а пустой раздел
   читается как поломка. */
interface Плагин {
  permissions(): Promise<{ список: ПунктНатива[] }>;
  /* Ответ на системный диалог приходит сюда (#558). Ждать возвращения из фона нельзя: диалог
     разрешений приложение в фон не уводит, и человек, нажавший «Разрешить», не видел никакого
     следа — а дальше либо жмёт «спросить» ещё раз (второго диалога не будет), либо решает, что не
     сработало. */
  addListener(event: 'разрешения', cb: (e: { список: ПунктНатива[] }) => void):
    Promise<{ remove: () => void }>;
  requestPermission(o: { id: string }): Promise<{ список: ПунктНатива[] }>;
  openPermissionSettings(o: { id: string }): Promise<{ ok?: boolean }>;
}
const Native = registerPlugin<Плагин>('SugarLifeBridge');

const праваВозможны = (): boolean => Capacitor.isNativePlatform();

/** null — платформа не та или сборка старше раздела: молчим, а не показываем пустой список. */
export async function прочитатьПрава(): Promise<ПунктНатива[] | null> {
  if (!праваВозможны()) return null;
  return уНатива('permissions', async () => (await Native.permissions()).список ?? [], null);
}

/** Спросить систему. Возвращает свежий список: диалог мог изменить и соседние строки. */
export async function спроситьПраво(id: string): Promise<ПунктНатива[] | null> {
  if (!праваВозможны()) return null;
  return уНатива('requestPermission', async () => (await Native.requestPermission({ id })).список ?? [], null);
}

/** Подписаться на ответы системных диалогов. Возвращает отписку; в вебе — пустышку. */
export function слушатьПрава(ф: (список: ПунктНатива[]) => void): () => void {
  if (!праваВозможны()) return () => {};
  let снять: (() => void) | null = null;
  /* Сборка старше события — тогда остаётся перечитывание по возвращении на экран. Это не поломка,
     о которой надо кричать, — но и не то, о чём стоит молчать: без следа «права не обновляются»
     неотличимо от «система не отвечает». */
  void уНатива('addListener:разрешения',
    async () => { снять = (await Native.addListener('разрешения', (e) => ф(e.список ?? []))).remove; }, undefined);
  return () => { снять?.(); };
}

export async function открытьНастройкиПрава(id: string): Promise<void> {
  if (!праваВозможны()) return;
  await уНатива('openPermissionSettings', () => Native.openPermissionSettings({ id }), undefined);
}
