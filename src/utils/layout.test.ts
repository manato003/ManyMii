import { describe, it, expect } from 'vitest';
import {
    buildLayout,
    availableTemplates,
    calcOptimalGrid,
    toTemplate,
    toGridArea,
    parseLayoutStore,
    getTemplateFor,
    setTemplateFor,
    setTracksFor,
    tracksFor,
    resizeTracks,
    trackOffsets,
    MAIN_RATIO,
    MIN_FR,
    type TemplateId,
    type Slot,
} from './layout';

const VP_W = 1920;
const VP_H = 1080;

const ALL: TemplateId[] = ['auto', 'main-left', 'main-right', 'main-top'];

/** 区画が占めるマスの集合。重なりと範囲の検証に使う */
function cellsOf(slot: Slot): string[] {
    const out: string[] = [];
    for (let c = slot.col; c < slot.col + slot.colSpan; c++) {
        for (let r = slot.row; r < slot.row + slot.rowSpan; r++) {
            out.push(`${c},${r}`);
        }
    }
    return out;
}

describe('availableTemplates', () => {
    it('1枠では auto しか選べない（メイン+サブが成立しない）', () => {
        expect(availableTemplates(1)).toEqual(['auto']);
    });

    it('0枠でも auto は返す', () => {
        expect(availableTemplates(0)).toEqual(['auto']);
    });

    it('2枠以上なら全テンプレートが選べる', () => {
        expect(availableTemplates(2)).toEqual(ALL);
        expect(availableTemplates(9)).toEqual(ALL);
    });
});

describe('buildLayout の不変条件', () => {
    // 「slots.length === count」を破ると、セルが自動配置に落ちて別の場所に飛ぶ
    it.each(ALL)('%s: 区画の数が枠数と一致する（1〜12枠）', (id) => {
        for (let count = 1; count <= 12; count++) {
            const layout = buildLayout(id, count, VP_W, VP_H);
            expect(layout.slots).toHaveLength(count);
        }
    });

    it.each(ALL)('%s: 区画がグリッドの範囲を出ない（1〜12枠）', (id) => {
        for (let count = 1; count <= 12; count++) {
            const { colTracks, rowTracks, slots } = buildLayout(id, count, VP_W, VP_H);
            for (const s of slots) {
                expect(s.col).toBeGreaterThanOrEqual(1);
                expect(s.row).toBeGreaterThanOrEqual(1);
                expect(s.col + s.colSpan - 1).toBeLessThanOrEqual(colTracks.length);
                expect(s.row + s.rowSpan - 1).toBeLessThanOrEqual(rowTracks.length);
            }
        }
    });

    it.each(ALL)('%s: 区画同士が重ならない（1〜12枠）', (id) => {
        for (let count = 1; count <= 12; count++) {
            const { slots } = buildLayout(id, count, VP_W, VP_H);
            const seen = new Set<string>();
            for (const s of slots) {
                for (const cell of cellsOf(s)) {
                    expect(seen.has(cell)).toBe(false);
                    seen.add(cell);
                }
            }
        }
    });

    it('0枠でも壊れない', () => {
        const layout = buildLayout('main-left', 0, VP_W, VP_H);
        expect(layout.slots).toEqual([]);
    });
});

describe('buildLayout のフォールバック', () => {
    // 枠を減らして main-* が成立しなくなったときに壊れないこと
    it('1枠に main-left を指定すると auto に落ちる', () => {
        const layout = buildLayout('main-left', 1, VP_W, VP_H);
        expect(layout.colTracks).toEqual([1]);
        expect(layout.rowTracks).toEqual([1]);
        expect(layout.slots).toEqual([{ col: 1, row: 1, colSpan: 1, rowSpan: 1 }]);
    });
});

describe('main-left / main-right', () => {
    it('メインは1列を占め、サブは縦に積まれる', () => {
        const { colTracks, rowTracks, slots } = buildLayout('main-left', 4, VP_W, VP_H);
        expect(colTracks).toEqual([MAIN_RATIO, 1]);
        expect(rowTracks).toEqual([1, 1, 1]);            // サブ3枚ぶんの行
        expect(slots[0]).toEqual({ col: 1, row: 1, colSpan: 1, rowSpan: 3 });
        expect(slots.slice(1)).toEqual([
            { col: 2, row: 1, colSpan: 1, rowSpan: 1 },
            { col: 2, row: 2, colSpan: 1, rowSpan: 1 },
            { col: 2, row: 3, colSpan: 1, rowSpan: 1 },
        ]);
    });

    it('main-right は左右が反転する', () => {
        const { colTracks, slots } = buildLayout('main-right', 3, VP_W, VP_H);
        expect(colTracks).toEqual([1, MAIN_RATIO]);
        expect(slots[0].col).toBe(2);                     // メインが右
        expect(slots[1].col).toBe(1);                     // サブが左
        expect(slots[2].col).toBe(1);
    });

    it('メインは常にサブより広い比率を持つ', () => {
        const left = buildLayout('main-left', 5, VP_W, VP_H);
        expect(left.colTracks[0]).toBeGreaterThan(left.colTracks[1]);
        const right = buildLayout('main-right', 5, VP_W, VP_H);
        expect(right.colTracks[1]).toBeGreaterThan(right.colTracks[0]);
    });

    it('2枠なら1行になる', () => {
        const { rowTracks, slots } = buildLayout('main-left', 2, VP_W, VP_H);
        expect(rowTracks).toEqual([1]);
        expect(slots[0].rowSpan).toBe(1);
    });

    it('サブが増えても行数が追従する', () => {
        expect(buildLayout('main-left', 7, VP_W, VP_H).rowTracks).toHaveLength(6);
        expect(buildLayout('main-left', 7, VP_W, VP_H).slots[0].rowSpan).toBe(6);
    });
});

describe('main-top', () => {
    it('メインが上段を横断し、サブが下段に並ぶ', () => {
        const { colTracks, rowTracks, slots } = buildLayout('main-top', 4, VP_W, VP_H);
        expect(colTracks).toEqual([1, 1, 1]);
        expect(rowTracks).toEqual([MAIN_RATIO, 1]);
        expect(slots[0]).toEqual({ col: 1, row: 1, colSpan: 3, rowSpan: 1 });
        expect(slots.slice(1).every(s => s.row === 2)).toBe(true);
    });

    it('メインは常にサブ行より高い比率を持つ', () => {
        const { rowTracks } = buildLayout('main-top', 5, VP_W, VP_H);
        expect(rowTracks[0]).toBeGreaterThan(rowTracks[1]);
    });
});

describe('auto', () => {
    it('左上から行優先で敷き詰める', () => {
        // 4枠・16:9 のビューポートなら 2x2
        const { colTracks, rowTracks, slots } = buildLayout('auto', 4, VP_W, VP_H);
        expect(colTracks).toHaveLength(2);
        expect(rowTracks).toHaveLength(2);
        expect(slots).toEqual([
            { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
            { col: 2, row: 1, colSpan: 1, rowSpan: 1 },
            { col: 1, row: 2, colSpan: 1, rowSpan: 1 },
            { col: 2, row: 2, colSpan: 1, rowSpan: 1 },
        ]);
    });

    it('すべての区画が1マスで、トラックはすべて等分', () => {
        const { colTracks, rowTracks, slots } = buildLayout('auto', 7, VP_W, VP_H);
        expect(slots.every(s => s.colSpan === 1 && s.rowSpan === 1)).toBe(true);
        expect(colTracks.every(f => f === 1)).toBe(true);
        expect(rowTracks.every(f => f === 1)).toBe(true);
    });

    it('縦長のビューポートでは列より行が増える', () => {
        const tall = buildLayout('auto', 4, 600, 1600);
        expect(tall.rowTracks.length).toBeGreaterThan(tall.colTracks.length);
    });
});

describe('calcOptimalGrid', () => {
    it('0枠でも 1x1 を返す', () => {
        expect(calcOptimalGrid(0, VP_W, VP_H)).toEqual({ cols: 1, rows: 1 });
    });

    it('1枠は 1x1', () => {
        expect(calcOptimalGrid(1, VP_W, VP_H)).toEqual({ cols: 1, rows: 1 });
    });

    it('横長画面で4枠なら 2x2', () => {
        expect(calcOptimalGrid(4, VP_W, VP_H)).toEqual({ cols: 2, rows: 2 });
    });

    it('行数は必ず全枠を収容できる', () => {
        for (let n = 1; n <= 16; n++) {
            const { cols, rows } = calcOptimalGrid(n, VP_W, VP_H);
            expect(cols * rows).toBeGreaterThanOrEqual(n);
        }
    });
});

describe('resizeTracks', () => {
    it('境界を動かすと片方が増え、もう片方が同じだけ減る', () => {
        expect(resizeTracks([1, 1], 0, 0.5)).toEqual([1.5, 0.5]);
    });

    it('総和は変わらない', () => {
        const before = [2, 1, 1];
        const after = resizeTracks(before, 1, 0.4);
        const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
        expect(sum(after)).toBeCloseTo(sum(before));
    });

    it('隣り合うトラックだけが変わる', () => {
        expect(resizeTracks([1, 1, 1], 1, 0.3)).toEqual([1, 1.3, 0.7]);
    });

    it('MIN_FR を下回らないところで止まる', () => {
        // 右を 0 以下にしようとしても MIN_FR で止まる
        const after = resizeTracks([1, 1], 0, 999);
        expect(after[1]).toBeCloseTo(MIN_FR);
        expect(after[0]).toBeCloseTo(2 - MIN_FR);
    });

    it('逆向きでも MIN_FR を下回らない', () => {
        const after = resizeTracks([1, 1], 0, -999);
        expect(after[0]).toBeCloseTo(MIN_FR);
        expect(after[1]).toBeCloseTo(2 - MIN_FR);
    });

    it('範囲外の index では何もしない', () => {
        const tracks = [1, 1];
        expect(resizeTracks(tracks, -1, 0.5)).toBe(tracks);
        expect(resizeTracks(tracks, 1, 0.5)).toBe(tracks);   // 右隣が無い
        expect(resizeTracks(tracks, 5, 0.5)).toBe(tracks);
    });

    it('元の配列を変更しない', () => {
        const tracks = [1, 1];
        resizeTracks(tracks, 0, 0.5);
        expect(tracks).toEqual([1, 1]);
    });
});

describe('trackOffsets', () => {
    it('境界の数はトラック数より1つ少ない', () => {
        expect(trackOffsets([1, 1, 1])).toHaveLength(2);
        expect(trackOffsets([1])).toHaveLength(0);
    });

    it('等分なら等間隔', () => {
        const offsets = trackOffsets([1, 1, 1]);
        expect(offsets[0]).toBeCloseTo(1 / 3);
        expect(offsets[1]).toBeCloseTo(2 / 3);
    });

    it('比率に応じた位置になる', () => {
        expect(trackOffsets([2, 1])[0]).toBeCloseTo(2 / 3);
        expect(trackOffsets([1, 2])[0]).toBeCloseTo(1 / 3);
    });

    it('0 や空でも壊れない', () => {
        expect(trackOffsets([])).toEqual([]);
        expect(trackOffsets([0, 0])).toEqual([]);
    });
});

describe('tracksFor', () => {
    const base = buildLayout('main-left', 4, VP_W, VP_H);   // cols 2本 / rows 3本

    it('保存が無ければ null', () => {
        expect(tracksFor({}, 4, base)).toBeNull();
    });

    it('本数が一致すれば返す', () => {
        const saved = { cols: [2.5, 0.5], rows: [1, 1, 1] };
        const store = { 4: { templateId: 'main-left' as const, tracks: saved } };
        expect(tracksFor(store, 4, base)).toEqual(saved);
    });

    // 本数が違うものを当てると区画とトラックがずれてレイアウトが崩れる
    it('列の本数が違えば使わない', () => {
        const store = { 4: { templateId: 'main-left' as const, tracks: { cols: [1, 1, 1], rows: [1, 1, 1] } } };
        expect(tracksFor(store, 4, base)).toBeNull();
    });

    it('行の本数が違えば使わない', () => {
        const store = { 4: { templateId: 'main-left' as const, tracks: { cols: [2, 1], rows: [1, 1] } } };
        expect(tracksFor(store, 4, base)).toBeNull();
    });
});

describe('setTracksFor', () => {
    it('テンプレートを維持したまま幅を保存する', () => {
        const store = setTemplateFor({}, 4, 'main-top');
        const next = setTracksFor(store, 4, { cols: [1, 1, 1], rows: [3, 1] });
        expect(next[4].templateId).toBe('main-top');
        expect(next[4].tracks).toEqual({ cols: [1, 1, 1], rows: [3, 1] });
    });

    // テンプレートを変えると列数・行数が変わるので、古い幅は残してはいけない
    it('テンプレートを変えると保存済みの幅が破棄される', () => {
        const withTracks = setTracksFor(setTemplateFor({}, 4, 'main-top'), 4, { cols: [1, 1, 1], rows: [3, 1] });
        const switched = setTemplateFor(withTracks, 4, 'main-left');
        expect(switched[4].tracks).toBeUndefined();
    });

    it('元のストアを変更しない', () => {
        const store = setTemplateFor({}, 4, 'auto');
        setTracksFor(store, 4, { cols: [1, 1], rows: [1, 1] });
        expect(store[4].tracks).toBeUndefined();
    });
});

describe('parseLayoutStore', () => {
    it('正常な JSON を復元する', () => {
        const raw = JSON.stringify({ 4: { templateId: 'main-left' } });
        expect(parseLayoutStore(raw)).toEqual({ 4: { templateId: 'main-left' } });
    });

    it('null なら空', () => {
        expect(parseLayoutStore(null)).toEqual({});
    });

    it('壊れた JSON でも例外を投げずに空を返す', () => {
        expect(parseLayoutStore('{{{')).toEqual({});
    });

    it('配列や非オブジェクトは空として扱う', () => {
        expect(parseLayoutStore('[1,2,3]')).toEqual({});
        expect(parseLayoutStore('"hello"')).toEqual({});
        expect(parseLayoutStore('null')).toEqual({});
    });

    it('未知のテンプレート名を持つエントリは捨てる', () => {
        const raw = JSON.stringify({ 3: { templateId: 'diagonal' }, 4: { templateId: 'auto' } });
        expect(parseLayoutStore(raw)).toEqual({ 4: { templateId: 'auto' } });
    });

    it('保存された tracks を復元する', () => {
        const raw = JSON.stringify({ 4: { templateId: 'main-left', tracks: { cols: [2.5, 0.5], rows: [1, 1, 1] } } });
        expect(parseLayoutStore(raw)[4].tracks).toEqual({ cols: [2.5, 0.5], rows: [1, 1, 1] });
    });

    // 片方だけ当てると区画とトラックがずれる。中途半端に適用しない
    it('cols と rows の片方だけが壊れていたら tracks ごと捨てる', () => {
        const raw = JSON.stringify({ 4: { templateId: 'auto', tracks: { cols: [1, 1], rows: 'broken' } } });
        const parsed = parseLayoutStore(raw);
        expect(parsed[4].templateId).toBe('auto');       // テンプレートは残す
        expect(parsed[4].tracks).toBeUndefined();
    });

    it('MIN_FR を下回る値を含む tracks は捨てる', () => {
        const raw = JSON.stringify({ 4: { templateId: 'auto', tracks: { cols: [0, 2], rows: [1, 1] } } });
        expect(parseLayoutStore(raw)[4].tracks).toBeUndefined();
    });

    it('数値でない値を含む tracks は捨てる', () => {
        const raw = JSON.stringify({ 4: { templateId: 'auto', tracks: { cols: [1, null], rows: [1, 1] } } });
        expect(parseLayoutStore(raw)[4].tracks).toBeUndefined();
    });

    it('空配列の tracks は捨てる', () => {
        const raw = JSON.stringify({ 4: { templateId: 'auto', tracks: { cols: [], rows: [] } } });
        expect(parseLayoutStore(raw)[4].tracks).toBeUndefined();
    });

    it('枠数として不正なキーは捨てる', () => {
        const raw = JSON.stringify({ abc: { templateId: 'auto' }, 0: { templateId: 'auto' }, 2: { templateId: 'auto' } });
        expect(parseLayoutStore(raw)).toEqual({ 2: { templateId: 'auto' } });
    });
});

describe('getTemplateFor / setTemplateFor', () => {
    it('未設定の枠数では auto', () => {
        expect(getTemplateFor({}, 4)).toBe('auto');
    });

    it('保存された値を返す', () => {
        expect(getTemplateFor({ 4: { templateId: 'main-top' } }, 4)).toBe('main-top');
    });

    it('枠数が減ってテンプレートが成立しなくなったら auto に落ちる', () => {
        // 4枠のときに main-left を選び、その後1枠になったケース
        expect(getTemplateFor({ 1: { templateId: 'main-left' } }, 1)).toBe('auto');
    });

    it('枠数ごとに独立している', () => {
        const store = setTemplateFor(setTemplateFor({}, 4, 'main-left'), 2, 'main-top');
        expect(getTemplateFor(store, 4)).toBe('main-left');
        expect(getTemplateFor(store, 2)).toBe('main-top');
        expect(getTemplateFor(store, 3)).toBe('auto');
    });

    it('setTemplateFor は元のストアを変更しない', () => {
        const store = {};
        setTemplateFor(store, 4, 'main-left');
        expect(store).toEqual({});
    });
});

describe('CSS への変換', () => {
    it('toTemplate は fr 値の並びにする', () => {
        expect(toTemplate([2, 1])).toBe('2fr 1fr');
        expect(toTemplate([1, 1, 1])).toBe('1fr 1fr 1fr');
    });

    it('toGridArea は span 記法にする', () => {
        expect(toGridArea({ col: 2, row: 1, colSpan: 1, rowSpan: 3 })).toEqual({
            gridColumn: '2 / span 1',
            gridRow: '1 / span 3',
        });
    });
});
