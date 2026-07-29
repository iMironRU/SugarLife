/* Реалтайм Nightscout через Socket.IO. Слушает событие dataUpdate и отдаёт
   нормализованные дельты. Профиль по сокету не приходит — берётся из REST. */
import { io, type Socket } from 'socket.io-client';
import { normSgv, normDeviceDoc, normTreatment, type Entry, type Device, type Treatment } from './nightscout';

export interface SocketData {
  entries?: Entry[];
  treatments?: Treatment[];
  device?: Device | null;
  delta: boolean;
}

let socket: Socket | null = null;

export function connectSocket(
  base: string,
  token: string | undefined,
  onData: (d: SocketData) => void,
  onStatus?: (connected: boolean) => void,
) {
  disconnectSocket();
  socket = io(base.replace(/\/+$/, ''), {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 15000,
  });

  socket.on('connect', () => {
    onStatus?.(true);
    socket?.emit('authorize', { client: 'web', history: 48, token: token || undefined });
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
    if (Array.isArray(data.devicestatus) && data.devicestatus.length) {
      const latest = data.devicestatus.reduce((a: any, b: any) => ((b.mills || 0) > (a.mills || 0) ? b : a));
      device = normDeviceDoc(latest);
    }
    onData({ entries, treatments, device, delta: !!data.delta });
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
