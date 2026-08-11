/* Реалтайм Nightscout через Socket.IO. Слушает событие dataUpdate и отдаёт
   нормализованные дельты. Профиль по сокету не приходит — берётся из REST.
   Несколько облаков — несколько сокетов одновременно, ключ id — это CloudConfig.id. */
import { io, type Socket } from 'socket.io-client';
import { normSgv, normDeviceDocs, normTreatment, type Entry, type Device, type Treatment } from './nightscout';

export interface SocketData {
  entries?: Entry[];
  treatments?: Treatment[];
  device?: Device | null;
  delta: boolean;
}

const sockets = new Map<string, Socket>();

export function connectSocket(
  id: string,
  base: string,
  token: string | undefined,
  onData: (d: SocketData) => void,
  onStatus?: (connected: boolean) => void,
) {
  disconnectSocket(id);
  const socket = io(base.replace(/\/+$/, ''), {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 15000,
  });
  sockets.set(id, socket);

  socket.on('connect', () => {
    onStatus?.(true);
    socket.emit('authorize', { client: 'web', history: 48, token: token || undefined });
  });
  socket.on('disconnect', () => onStatus?.(false));
  socket.on('connect_error', () => onStatus?.(false));

  socket.on('dataUpdate', (data: any) => {
    if (!data) return;
    const entries = Array.isArray(data.sgvs)
      ? (data.sgvs.map(normSgv).filter(Boolean) as Entry[]) : undefined;
    const treatments = Array.isArray(data.treatments)
      ? (data.treatments.map(normTreatment).filter(Boolean) as Treatment[]) : undefined;
    let device: Device | null | undefined;
    /* Не «самый свежий документ», а сборка по всем пришедшим: короткий документ от
       помпы не должен стирать активный инсулин, посчитанный циклом (см. mergeDevice).
       Дельта обычно содержит один документ — остальное дособирает стор, подмешивая
       это в уже известное состояние. */
    if (Array.isArray(data.devicestatus) && data.devicestatus.length) {
      device = normDeviceDocs([...data.devicestatus].sort((a: any, b: any) => (b.mills || 0) - (a.mills || 0)));
    }
    onData({ entries, treatments, device, delta: !!data.delta });
  });

  return socket;
}

export function disconnectSocket(id: string) {
  const socket = sockets.get(id);
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    sockets.delete(id);
  }
}
