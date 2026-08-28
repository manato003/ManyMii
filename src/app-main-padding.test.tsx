// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
// node:fs ではなく Vite の ?raw で読む。tsconfig.app.json は types を
// vite/client に絞っており、アプリ側に Node の型を持ち込みたくないため
import indexCss from './index.css?raw';

/**
 * `.app-main` の余白は CSS のカスケードだけで決まっている。
 *
 * **両方のパネルをピン留めすると片側の余白しか効かない**という不具合があった。
 * 入れ替え用の2つのルールが反対側を 0 でリセットし合い、詳細度が同じなので
 * 後に書かれた方が勝っていた。ロジックが一切絡まないので、コンポーネントの
 * テストでも純粋関数のテストでも検出できない。実際のスタイルシートを読ませて
 * 計算値を見るのがほぼ唯一の防ぎ方。
 *
 * jsdom は var() を解決しないので、値そのものではなく
 * 「どちらの変数が使われているか」で判定する。
 */

const CHAT = '--chat-width';
const STREAM = '--stream-panel-width';

beforeAll(() => {
    const style = document.createElement('style');
    style.textContent = indexCss;
    document.head.appendChild(style);
});

function padding(classes: string) {
    const el = document.createElement('div');
    el.className = classes;
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    return { left: cs.paddingLeft, right: cs.paddingRight };
}

const NONE = /^(0px|0|)$/;

describe('通常配置', () => {
    it('コメントパネルだけピン留め → 右だけ空ける', () => {
        const { left, right } = padding('app-main chat-pinned');
        expect(left).toMatch(NONE);
        expect(right).toContain(CHAT);
    });

    it('配信管理パネルだけピン留め → 左だけ空ける', () => {
        const { left, right } = padding('app-main stream-pinned');
        expect(left).toContain(STREAM);
        expect(right).toMatch(NONE);
    });

    // 回帰防止の本命
    it('両方ピン留め → 左右とも空ける', () => {
        const { left, right } = padding('app-main chat-pinned stream-pinned');
        expect(left).toContain(STREAM);
        expect(right).toContain(CHAT);
    });
});

describe('パネル入れ替え', () => {
    it('コメントパネルだけピン留め → 左だけ空ける', () => {
        const { left, right } = padding('app-main chat-pinned panels-swapped');
        expect(left).toContain(CHAT);
        expect(right).toMatch(NONE);
    });

    it('配信管理パネルだけピン留め → 右だけ空ける', () => {
        const { left, right } = padding('app-main stream-pinned panels-swapped');
        expect(left).toMatch(NONE);
        expect(right).toContain(STREAM);
    });

    // 実際に壊れていたのはこのケース
    it('両方ピン留め → 左右とも空け、通常配置と左右が入れ替わる', () => {
        const { left, right } = padding('app-main chat-pinned stream-pinned panels-swapped');
        expect(left).toContain(CHAT);
        expect(right).toContain(STREAM);
    });
});

describe('ピン留めなし', () => {
    it('余白は付かない', () => {
        const { left, right } = padding('app-main');
        expect(left).toMatch(NONE);
        expect(right).toMatch(NONE);
    });
});
