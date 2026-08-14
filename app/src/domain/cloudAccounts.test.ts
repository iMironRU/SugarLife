import { describe, it, expect } from 'vitest';
import {
  нуженВыборСубъекта, активныйСубъект, имяСубъекта, состояниеУчётки,
  чтоДелать, ошибкаРегиона, можноВойти, учёткиПровайдера, КОД_РЕГИОНА,
} from './cloudAccounts';
import type { AccountView, CloudProviderView, Problem, UiSnapshot } from '@/sources/bridge';

const уч = (p: Partial<AccountView>): AccountView => ({
  id: 'a', providerId: 'libre', displayName: 'LibreLinkUp', state: 'Linked', ...p,
});

const беда = (p: Partial<Problem>): Problem => ({
  code: 'cloud.auth.failed', title: 'Не удалось войти', remediation: 'Проверьте адрес',
  severity: 'Error', category: 'Network', retryable: true, ...p,
});

describe('чей это аккаунт и чьи данные читаем', () => {
  it('субъект один — выбирать нечего, движок выбрал сам', () => {
    expect(нуженВыборСубъекта(уч({
      subjects: [{ id: 's1', displayName: 'Я', kind: 'patient' }], activeSubjectId: 's1',
    }))).toBe(false);
  });

  it('субъектов несколько — спрашиваем, чьи данные читать', () => {
    expect(нуженВыборСубъекта(уч({
      subjects: [
        { id: 's1', displayName: 'Я', kind: 'patient' },
        { id: 's2', displayName: 'Сын', kind: 'patient' },
      ],
    }))).toBe(true);
  });

  it('субъектов нет вовсе — тоже нечего спрашивать', () => {
    expect(нуженВыборСубъекта(уч({}))).toBe(false);
  });

  it('активный субъект находится по id, а не по порядку', () => {
    const a = уч({
      subjects: [
        { id: 's1', displayName: 'Я', kind: 'patient' },
        { id: 's2', displayName: 'Сын', kind: 'patient' },
      ],
      activeSubjectId: 's2',
    });
    expect(активныйСубъект(a)?.displayName).toBe('Сын');
  });

  /* Под одной учёткой Sibionics лежит несколько сенсоров, и «Сенсор» без номера не
     различает их вовсе — а выбирать человеку предстоит именно между ними. */
  it('прибор называем с серийником, человека — по имени', () => {
    expect(имяСубъекта({ id: 'd', displayName: 'Сенсор', kind: 'device', serial: 'GS1-2E4F' }))
      .toBe('Сенсор · GS1-2E4F');
    expect(имяСубъекта({ id: 'p', displayName: 'Сын', kind: 'patient' })).toBe('Сын');
  });
});

/* Главное правило экрана: при ошибке говорим словами движка. LibreLinkUp живёт в
   двенадцати регионах, и вход не в тот отвечает не «неверный пароль», а указанием
   региона. Своё «проверьте пароль» отправило бы человека менять верный пароль. */
describe('что говорим про ошибку входа', () => {
  it('remediation отдаётся как есть', () => {
    const a = уч({
      state: 'Error',
      problem: беда({ code: КОД_РЕГИОНА, remediation: 'Учётная запись в регионе EU2 — выберите его в списке.' }),
    });
    expect(чтоДелать(a)).toBe('Учётная запись в регионе EU2 — выберите его в списке.');
    expect(ошибкаРегиона(a)).toBe(true);
  });

  it('движок молчит — молчим и мы, а не придумываем причину', () => {
    expect(чтоДелать(уч({ state: 'Error' }))).toBe(null);
    expect(чтоДелать(уч({ state: 'Error', problem: беда({ remediation: '   ' }) }))).toBe(null);
  });

  it('ошибка не про регион — и не помечаем её как региональную', () => {
    expect(ошибкаРегиона(уч({ state: 'Error', problem: беда({}) }))).toBe(false);
  });

  it('состояния переводим по словарю, незнакомое — «неизвестно»', () => {
    expect(состояниеУчётки(уч({ state: 'Linked' }))).toBe('вошли');
    expect(состояниеУчётки(уч({ state: 'Linking' }))).toBe('входим');
    expect(состояниеУчётки(уч({ state: 'Error' }))).toBe('ошибка');
    expect(состояниеУчётки(уч({ state: 'Что-то новое' }))).toBe('неизвестно');
  });
});

describe('каталог провайдеров', () => {
  const пров = (p: Partial<CloudProviderView>): CloudProviderView => ({
    id: 'libre', displayName: 'LibreLinkUp', settings: { parameters: [] }, available: true, ...p,
  });

  /* Недоступного показываем, но войти не даём: спрятать значило бы соврать про планы,
     показать без пометки — про готовность. */
  it('недоступный провайдер виден, но войти нельзя', () => {
    expect(можноВойти(пров({ available: false }))).toBe(false);
    expect(можноВойти(пров({}))).toBe(true);
  });

  it('учётки разбираются по провайдерам', () => {
    const snap = { accounts: [uch('libre'), uch('dexcom'), uch('libre')] } as unknown as UiSnapshot;
    expect(учёткиПровайдера(snap, 'libre')).toHaveLength(2);
    expect(учёткиПровайдера(null, 'libre')).toEqual([]);
  });
});

function uch(providerId: string): AccountView {
  return уч({ providerId });
}
