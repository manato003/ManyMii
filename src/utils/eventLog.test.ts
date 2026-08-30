import { describe, it, expect } from 'vitest';
import { appendEvent, parseEventLog, formatEventLog, MAX_EVENTS, type LoggedEvent } from './eventLog';

const ev = (t: number, kind = 'yt-state'): LoggedEvent => ({ t, kind });

describe('appendEvent', () => {
    it('末尾に足す', () => {
        expect(appendEvent([ev(1)], ev(2)).map(e => e.t)).toEqual([1, 2]);
    });

    it('元の配列を変更しない', () => {
        const list = [ev(1)];
        appendEvent(list, ev(2));
        expect(list).toHaveLength(1);
    });

    // 上限が効かないと localStorage を際限なく食う
    it('上限を超えたら古いものから捨てる', () => {
        let list: LoggedEvent[] = [];
        for (let i = 0; i < 10; i++) list = appendEvent(list, ev(i), 3);
        expect(list.map(e => e.t)).toEqual([7, 8, 9]);
    });

    it('既定の上限は MAX_EVENTS', () => {
        let list: LoggedEvent[] = [];
        for (let i = 0; i < MAX_EVENTS + 50; i++) list = appendEvent(list, ev(i));
        expect(list).toHaveLength(MAX_EVENTS);
        expect(list[list.length - 1].t).toBe(MAX_EVENTS + 49);
    });
});

describe('parseEventLog', () => {
    it('正常な JSON を復元する', () => {
        expect(parseEventLog(JSON.stringify([ev(1)]))).toEqual([ev(1)]);
    });

    it('null / 壊れた JSON / 非配列は空', () => {
        for (const v of [null, '{{{', '{"a":1}', '"x"']) {
            expect(parseEventLog(v)).toEqual([]);
        }
    });

    it('形の合わない要素は捨てる', () => {
        const raw = JSON.stringify([{ t: 1, kind: 'ok' }, { t: 'bad', kind: 'x' }, { kind: 'no-time' }, null]);
        expect(parseEventLog(raw)).toEqual([{ t: 1, kind: 'ok' }]);
    });
});

describe('formatEventLog', () => {
    it('時刻・種類・ID・詳細を1行にする', () => {
        const line = formatEventLog([{ t: Date.UTC(2026, 0, 1, 12, 34, 56, 789), kind: 'yt-state', id: 'abcdefgh-1234', detail: 'ended' }]);
        expect(line).toBe('12:34:56.789 yt-state abcdefgh ended');
    });

    it('ID や詳細が無くても崩れない', () => {
        const line = formatEventLog([{ t: Date.UTC(2026, 0, 1, 0, 0, 0, 0), kind: 'expand' }]);
        expect(line).toBe('00:00:00.000 expand');
    });

    it('複数行を改行でつなぐ', () => {
        expect(formatEventLog([ev(0), ev(0)]).split('\n')).toHaveLength(2);
    });

    it('空なら空文字', () => {
        expect(formatEventLog([])).toBe('');
    });
});
