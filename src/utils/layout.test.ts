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
    buildHandleSegments,
    pickLShapeGrid,
    EMPTY_LAYOUT_STORE,
    MAIN_RATIO,
    MIN_FR,
    type TemplateId,
    type LayoutStore,
    type Slot,
} from './layout';

const VP_W = 1920;
const VP_H = 1080;

const ALL: TemplateId[] = ['auto', 'main-left', 'main-right', 'main-top', 'l-shape', 'l-shape-right'];

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

    it('2〜4枠では l-shape 以外が選べる', () => {
        // 4枠だと L 字のメインが1マスになり、サブと同じ大きさで意味がない
        expect(availableTemplates(2)).toEqual(['auto', 'main-left', 'main-right', 'main-top']);
        expect(availableTemplates(4)).toEqual(['auto', 'main-left', 'main-right', 'main-top']);
    });

    it('5枠以上なら全テンプレートが選べる', () => {
        expect(availableTemplates(5)).toEqual(ALL);
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

    // 以前は隣り合う2本だけを変えていたが、それだと片側が極端に潰れる。
    // いまは境界の左右それぞれの全トラックに比例配分する
    it('境界の両側すべてに配分される', () => {
        const after = resizeTracks([1, 1, 1], 1, 0.3);
        expect(after[0]).toBeCloseTo(1.15);
        expect(after[1]).toBeCloseTo(1.15);
        expect(after[2]).toBeCloseTo(0.7);
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

describe('resizeTracks の比例配分', () => {
    // 隣の1本だけで delta を吸収させると、そこだけが極端に潰れる
    it('右側が複数あるとき、負担を全体で分け合う', () => {
        const after = resizeTracks([1, 1, 1], 0, 0.6);
        expect(after[0]).toBeCloseTo(1.6);
        expect(after[1]).toBeCloseTo(0.7);
        expect(after[2]).toBeCloseTo(0.7);
    });

    it('左側が複数あるとき、増分を全体で分け合う', () => {
        const after = resizeTracks([1, 1, 1], 1, 0.6);
        expect(after[0]).toBeCloseTo(1.3);
        expect(after[1]).toBeCloseTo(1.3);
        expect(after[2]).toBeCloseTo(0.4);
    });

    it('元の比率を保ったまま伸縮する', () => {
        const after = resizeTracks([1, 2, 1], 0, 0.5);
        // 右側は 2:1 の比率を保つ
        expect(after[1] / after[2]).toBeCloseTo(2);
    });

    it('どのトラックも MIN_FR を下回らない', () => {
        const after = resizeTracks([1, 1, 1], 0, 999);
        for (const f of after) expect(f).toBeGreaterThanOrEqual(MIN_FR - 1e-9);
    });

    it('逆向きに振り切っても MIN_FR を下回らない', () => {
        const after = resizeTracks([1, 1, 1], 1, -999);
        for (const f of after) expect(f).toBeGreaterThanOrEqual(MIN_FR - 1e-9);
    });

    // 限界は「平均」ではなく「一番小さいトラック」で決めないと、
    // 幅がばらついているときに小さい方だけが MIN_FR を割る
    it('幅がばらついていても、一番小さいトラックが MIN_FR を守る', () => {
        for (const tracks of [[2, 0.5, 1], [1, 3, 0.4], [0.5, 0.5, 4]]) {
            for (const index of [0, 1]) {
                for (const delta of [999, -999]) {
                    const after = resizeTracks(tracks, index, delta);
                    for (const f of after) expect(f).toBeGreaterThanOrEqual(MIN_FR - 1e-9);
                }
            }
        }
    });
});

describe('buildHandleSegments', () => {
    const l = buildLayout('l-shape', 8, VP_W, VP_H);   // 4x4、メインは 3x3

    it('等分レイアウトでは境界が全長にわたる', () => {
        const a = buildLayout('auto', 4, VP_W, VP_H);
        const segs = buildHandleSegments(a.slots, a.colTracks, a.rowTracks, 'col');
        expect(segs).toHaveLength(1);
        expect(segs[0].start).toBeCloseTo(0);
        expect(segs[0].length).toBeCloseTo(1);
    });

    // メインの内側を通る境界に全長のハンドルを引くと、映像の上を線が縦断し、
    // 掴んでも下段の枠しか動かないので意図と結果がずれる
    it('L字ではメイン内側の境界が下段の区間だけになる', () => {
        const segs = buildHandleSegments(l.slots, l.colTracks, l.rowTracks, 'col');
        const inner = segs.filter(s => s.index < 2);
        expect(inner).toHaveLength(2);
        for (const s of inner) {
            expect(s.start).toBeCloseTo(0.75);   // 下段の開始位置
            expect(s.length).toBeCloseTo(0.25);  // 下段1行ぶん
        }
    });

    it('L字のメインとサブ列の境界は全高にわたる', () => {
        const segs = buildHandleSegments(l.slots, l.colTracks, l.rowTracks, 'col');
        const outer = segs.find(s => s.index === 2);
        expect(outer?.start).toBeCloseTo(0);
        expect(outer?.length).toBeCloseTo(1);
    });

    it('行方向も同じ規則になる', () => {
        const segs = buildHandleSegments(l.slots, l.colTracks, l.rowTracks, 'row');
        expect(segs.filter(s => s.index < 2).every(s => Math.abs(s.length - 0.25) < 1e-9)).toBe(true);
        expect(segs.find(s => s.index === 2)?.length).toBeCloseTo(1);
    });

    it('区間はグリッドの範囲に収まる', () => {
        for (const id of ALL) {
            for (let n = 2; n <= 12; n++) {
                const layout = buildLayout(id, n, VP_W, VP_H);
                for (const axis of ['col', 'row'] as const) {
                    for (const s of buildHandleSegments(layout.slots, layout.colTracks, layout.rowTracks, axis)) {
                        expect(s.position).toBeGreaterThan(0);
                        expect(s.position).toBeLessThan(1);
                        expect(s.start).toBeGreaterThanOrEqual(-1e-9);
                        expect(s.start + s.length).toBeLessThanOrEqual(1 + 1e-9);
                        expect(s.length).toBeGreaterThan(0);
                    }
                }
            }
        }
    });

    it('1本しかないトラックには境界が無い', () => {
        const one = buildLayout('auto', 1, VP_W, VP_H);
        expect(buildHandleSegments(one.slots, one.colTracks, one.rowTracks, 'col')).toEqual([]);
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
        expect(tracksFor(EMPTY_LAYOUT_STORE, 4, base)).toBeNull();
    });

    it('本数が一致すれば返す', () => {
        const saved = { cols: [2.5, 0.5], rows: [1, 1, 1] };
        const store: LayoutStore = { templateId: 'main-left', tracks: { 4: saved } };
        expect(tracksFor(store, 4, base)).toEqual(saved);
    });

    // 本数が違うものを当てると区画とトラックがずれてレイアウトが崩れる
    it('列の本数が違えば使わない', () => {
        const store: LayoutStore = { templateId: 'main-left', tracks: { 4: { cols: [1, 1, 1], rows: [1, 1, 1] } } };
        expect(tracksFor(store, 4, base)).toBeNull();
    });

    it('行の本数が違えば使わない', () => {
        const store: LayoutStore = { templateId: 'main-left', tracks: { 4: { cols: [2, 1], rows: [1, 1] } } };
        expect(tracksFor(store, 4, base)).toBeNull();
    });

    it('別の枠数で保存された幅は使わない', () => {
        const store: LayoutStore = { templateId: 'main-left', tracks: { 5: { cols: [2, 1], rows: [1, 1, 1] } } };
        expect(tracksFor(store, 4, base)).toBeNull();
    });
});

describe('setTracksFor', () => {
    it('テンプレートを維持したまま幅を保存する', () => {
        const store = setTemplateFor(EMPTY_LAYOUT_STORE, 'main-top');
        const next = setTracksFor(store, 4, { cols: [1, 1, 1], rows: [3, 1] });
        expect(next.templateId).toBe('main-top');
        expect(next.tracks[4]).toEqual({ cols: [1, 1, 1], rows: [3, 1] });
    });

    it('枠数ごとに独立して幅を持てる', () => {
        let store = setTracksFor(EMPTY_LAYOUT_STORE, 4, { cols: [2, 1], rows: [1, 1, 1] });
        store = setTracksFor(store, 6, { cols: [3, 1], rows: [1, 1, 1, 1, 1] });
        expect(store.tracks[4]).toEqual({ cols: [2, 1], rows: [1, 1, 1] });
        expect(store.tracks[6]).toEqual({ cols: [3, 1], rows: [1, 1, 1, 1, 1] });
    });

    // テンプレートを変えると列数・行数が変わるので、古い幅は残してはいけない
    it('テンプレートを変えると保存済みの幅がすべて破棄される', () => {
        const withTracks = setTracksFor(setTemplateFor(EMPTY_LAYOUT_STORE, 'main-top'), 4, { cols: [1, 1, 1], rows: [3, 1] });
        const switched = setTemplateFor(withTracks, 'main-left');
        expect(switched.tracks).toEqual({});
    });

    it('元のストアを変更しない', () => {
        const store = setTemplateFor(EMPTY_LAYOUT_STORE, 'auto');
        setTracksFor(store, 4, { cols: [1, 1], rows: [1, 1] });
        expect(store.tracks).toEqual({});
    });
});

describe('getTemplateFor', () => {
    it('未設定なら auto', () => {
        expect(getTemplateFor(EMPTY_LAYOUT_STORE, 4)).toBe('auto');
    });

    it('保存された値を返す', () => {
        expect(getTemplateFor({ templateId: 'main-top', tracks: {} }, 4)).toBe('main-top');
    });

    // 枠を1つ非表示にしただけでレイアウトが auto に戻る不具合があった。
    // テンプレートは枠数ごとではなく全体で1つ持つ
    it('枠数が変わってもテンプレートは維持される', () => {
        const store = setTemplateFor(EMPTY_LAYOUT_STORE, 'main-top');
        expect(getTemplateFor(store, 6)).toBe('main-top');
        expect(getTemplateFor(store, 5)).toBe('main-top');   // 1枠 非表示にした
        expect(getTemplateFor(store, 2)).toBe('main-top');
    });

    it('その枠数で成立しないテンプレートは auto に落ちる', () => {
        expect(getTemplateFor({ templateId: 'main-left', tracks: {} }, 1)).toBe('auto');
        expect(getTemplateFor({ templateId: 'l-shape', tracks: {} }, 3)).toBe('auto');
    });
});

describe('parseLayoutStore', () => {
    it('現行形式を復元する', () => {
        const raw = JSON.stringify({ templateId: 'main-left', tracks: { 4: { cols: [2, 1], rows: [1, 1, 1] } } });
        expect(parseLayoutStore(raw)).toEqual({
            templateId: 'main-left',
            tracks: { 4: { cols: [2, 1], rows: [1, 1, 1] } },
        });
    });

    it('null なら既定', () => {
        expect(parseLayoutStore(null)).toEqual(EMPTY_LAYOUT_STORE);
    });

    it('壊れた JSON でも例外を投げずに既定を返す', () => {
        expect(parseLayoutStore('{{{')).toEqual(EMPTY_LAYOUT_STORE);
    });

    it('配列や非オブジェクトは既定として扱う', () => {
        expect(parseLayoutStore('[1,2,3]')).toEqual(EMPTY_LAYOUT_STORE);
        expect(parseLayoutStore('"hello"')).toEqual(EMPTY_LAYOUT_STORE);
        expect(parseLayoutStore('null')).toEqual(EMPTY_LAYOUT_STORE);
    });

    it('未知のテンプレート名は auto に落とす', () => {
        const raw = JSON.stringify({ templateId: 'diagonal', tracks: {} });
        expect(parseLayoutStore(raw).templateId).toBe('auto');
    });

    // 旧形式は「枠数ごとに templateId」を持っていた
    it('旧形式からテンプレートを引き継ぐ', () => {
        const raw = JSON.stringify({ 4: { templateId: 'main-top' }, 6: { templateId: 'main-top' } });
        expect(parseLayoutStore(raw).templateId).toBe('main-top');
    });

    it('旧形式の tracks も引き継ぐ', () => {
        const raw = JSON.stringify({ 4: { templateId: 'main-left', tracks: { cols: [2, 1], rows: [1, 1, 1] } } });
        expect(parseLayoutStore(raw).tracks[4]).toEqual({ cols: [2, 1], rows: [1, 1, 1] });
    });

    it('cols と rows の片方だけが壊れていたら tracks ごと捨てる', () => {
        const raw = JSON.stringify({ templateId: 'auto', tracks: { 4: { cols: [1, 1], rows: 'broken' } } });
        expect(parseLayoutStore(raw).tracks[4]).toBeUndefined();
    });

    it('MIN_FR を下回る値を含む tracks は捨てる', () => {
        const raw = JSON.stringify({ templateId: 'auto', tracks: { 4: { cols: [0, 2], rows: [1, 1] } } });
        expect(parseLayoutStore(raw).tracks[4]).toBeUndefined();
    });

    it('数値でない値を含む tracks は捨てる', () => {
        const raw = JSON.stringify({ templateId: 'auto', tracks: { 4: { cols: [1, null], rows: [1, 1] } } });
        expect(parseLayoutStore(raw).tracks[4]).toBeUndefined();
    });

    it('空配列の tracks は捨てる', () => {
        const raw = JSON.stringify({ templateId: 'auto', tracks: { 4: { cols: [], rows: [] } } });
        expect(parseLayoutStore(raw).tracks[4]).toBeUndefined();
    });

    it('枠数として不正なキーは捨てる', () => {
        const raw = JSON.stringify({ templateId: 'auto', tracks: { abc: { cols: [1, 1], rows: [1, 1] }, 2: { cols: [1, 1], rows: [1, 1] } } });
        expect(Object.keys(parseLayoutStore(raw).tracks)).toEqual(['2']);
    });
});

describe('l-shape', () => {
    // 左上メイン + 右列 + 下段。枠数 n は「列数 + 行数」に振り分けられる
    it('枠数が 列数 + 行数 に一致する', () => {
        for (let n = 4; n <= 14; n++) {
            const { cols, rows } = pickLShapeGrid(n, VP_W, VP_H);
            expect(cols + rows).toBe(n);
        }
    });

    it('16:9 の画面では列数と行数が一致し、メインとサブの縦横比が揃う', () => {
        // C = R のとき メイン と サブ の縦横比が等しくなる（黒帯が最小）
        const { cols, rows } = pickLShapeGrid(8, VP_W, VP_H);
        expect(cols).toBe(rows);
        expect(cols).toBe(4);
    });

    it('ユーザー要望どおり 8枠で 縦3 + 横4 の L 字になる', () => {
        const { slots } = buildLayout('l-shape', 8, VP_W, VP_H);
        const main = slots[0];
        expect(main).toEqual({ col: 1, row: 1, colSpan: 3, rowSpan: 3 });
        // 右の列が3枚
        expect(slots.slice(1, 4).every(s => s.col === 4)).toBe(true);
        // 下の段が4枚
        expect(slots.slice(4).every(s => s.row === 4)).toBe(true);
        expect(slots.slice(4)).toHaveLength(4);
    });

    it('メインは必ず2マス以上を占める', () => {
        for (let n = 5; n <= 14; n++) {
            const main = buildLayout('l-shape', n, VP_W, VP_H).slots[0];
            expect(main.colSpan * main.rowSpan).toBeGreaterThanOrEqual(2);
        }
    });

    it('縦長の画面では行数が増える', () => {
        const wide = pickLShapeGrid(10, 1920, 1080);
        const tall = pickLShapeGrid(10, 1080, 1920);
        expect(tall.rows).toBeGreaterThan(wide.rows);
    });

    it('ウルトラワイドでは列数が増える', () => {
        const normal = pickLShapeGrid(10, 1920, 1080);
        const ultra = pickLShapeGrid(10, 2560, 1080);
        expect(ultra.cols).toBeGreaterThan(normal.cols);
    });

    // メインとサブの両方の縦横比を見ていないと、16:9 でない画面で
    // メインが極端に細長い選択をしてしまう
    it('16:9 でない画面ではメインの縦横比も考慮して選ぶ', () => {
        // サブの縦横比だけを最適化すると 2x8 が選ばれるが、
        // それだとメインが 1x7 になって極端に縦長になる
        expect(pickLShapeGrid(10, 1080, 1920)).toEqual({ cols: 3, rows: 7 });
    });

    // 横長の画面（このアプリは PC 専用なので実質こちら）ではメインが極端にならない。
    // 縦長モニタでは枠数が少ないと L 字自体が成立しにくく、どう選んでも
    // メインが細長くなる。そこは許容する
    it('横長の画面ではメインの縦横比が 16:9 の 2.5倍以内に収まる', () => {
        for (const [w, h] of [[1920, 1080], [2560, 1080], [3440, 1440]]) {
            for (let n = 6; n <= 12; n++) {
                const { cols, rows } = pickLShapeGrid(n, w, h);
                const main = (w * (cols - 1) / cols) / (h * (rows - 1) / rows);
                const ratio = main / (16 / 9);
                expect(Math.max(ratio, 1 / ratio)).toBeLessThan(2.5);
            }
        }
    });

    it('5枠未満では選べない', () => {
        expect(availableTemplates(4)).not.toContain('l-shape');
        expect(availableTemplates(5)).toContain('l-shape');
    });

    it('右上版はメインとサブ列が左右反転する', () => {
        const left = buildLayout('l-shape', 8, VP_W, VP_H);
        const right = buildLayout('l-shape-right', 8, VP_W, VP_H);
        // 左上版: メインが col1、サブ列が col4（右端）
        expect(left.slots[0].col).toBe(1);
        expect(left.slots[1].col).toBe(4);
        // 右上版: メインが col2、サブ列が col1（左端）
        expect(right.slots[0].col).toBe(2);
        expect(right.slots[1].col).toBe(1);
        // グリッドの大きさとメインの占有マス数は同じ
        expect(right.colTracks).toEqual(left.colTracks);
        expect(right.slots[0].colSpan).toBe(left.slots[0].colSpan);
        expect(right.slots[0].rowSpan).toBe(left.slots[0].rowSpan);
    });

    it('右上版でも下段は左端から並ぶ', () => {
        const { slots } = buildLayout('l-shape-right', 8, VP_W, VP_H);
        expect(slots.slice(4).map(s => s.col)).toEqual([1, 2, 3, 4]);
        expect(slots.slice(4).every(s => s.row === 4)).toBe(true);
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
