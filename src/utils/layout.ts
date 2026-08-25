/**
 * 配信枠のレイアウト計算。
 *
 * 要件と制約は tasks/layout-requirements.md を参照。要約すると:
 *
 * **DOM の構造と順序を変えず、CSS のプロパティだけで表現できる範囲に収める。**
 * DOM ノードが物理的に動くとブラウザが iframe を再読み込みするため
 * （docs/SPEC.md 4章）。したがってレイアウトは「フラットな CSS Grid 1枚」に
 * 収まるものだけを扱い、入れ子の領域分割は行わない。
 *
 * ここは純粋関数だけを置く。React にも DOM にも依存しない。
 */

export type TemplateId = 'auto' | 'main-left' | 'main-right' | 'main-top';

/** グリッド上の1区画。col / row は 1-based のグリッド線番号 */
export interface Slot {
    col: number;
    row: number;
    colSpan: number;
    rowSpan: number;
}

export interface ResolvedLayout {
    /** 列トラックの fr 値。境界ドラッグはこの配列を書き換える */
    colTracks: number[];
    rowTracks: number[];
    /** visualIndex 番目の配信が入る区画。長さは必ず枠数と一致する */
    slots: Slot[];
}

/** メイン枠がサブ列の何倍の幅（高さ）を占めるかの既定値 */
export const MAIN_RATIO = 2;

/**
 * 枠数とビューポートから、セルが最大面積になる列数・行数を選ぶ。
 * 16:9 を保ったときのセル面積を総当たりで比較する。
 */
export function calcOptimalGrid(count: number, vpW: number, vpH: number): { cols: number; rows: number } {
    if (count <= 0) return { cols: 1, rows: 1 };
    let bestCols = 1;
    let bestScore = 0;
    for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        let cellW = vpW / cols;
        let cellH = cellW * 9 / 16;
        if (cellH * rows > vpH) {
            cellH = vpH / rows;
            cellW = cellH * 16 / 9;
        }
        const score = cellW * cellH * count;
        if (score > bestScore) {
            bestScore = score;
            bestCols = cols;
        }
    }
    return { cols: bestCols, rows: Math.ceil(count / bestCols) };
}

/**
 * その枠数で選べるテンプレート。
 * main-* は「メイン1 + 残り」なので2枠以上でないと成立しない。
 */
export function availableTemplates(count: number): TemplateId[] {
    if (count < 2) return ['auto'];
    return ['auto', 'main-left', 'main-right', 'main-top'];
}

function isAvailable(id: TemplateId, count: number): boolean {
    return availableTemplates(count).includes(id);
}

/**
 * テンプレートと枠数から実際の配置を組み立てる。
 *
 * **事後条件: slots.length === count。** 足りないとセルが自動配置に落ちて
 * 意図しない位置に飛び、多いと使われない区画が残る。
 *
 * 適用できないテンプレートが渡されたら auto に落とす（枠を減らして
 * main-* が成立しなくなったときに壊れないように）。
 */
export function buildLayout(
    templateId: TemplateId,
    count: number,
    vpW: number,
    vpH: number,
): ResolvedLayout {
    if (count <= 0) return { colTracks: [1], rowTracks: [1], slots: [] };

    const id = isAvailable(templateId, count) ? templateId : 'auto';
    const subs = count - 1;

    switch (id) {
        case 'main-left':
        case 'main-right': {
            // 縦1列に積んだサブの横にメインを置く
            const mainFirst = id === 'main-left';
            const colTracks = mainFirst ? [MAIN_RATIO, 1] : [1, MAIN_RATIO];
            const mainCol = mainFirst ? 1 : 2;
            const subCol = mainFirst ? 2 : 1;
            const slots: Slot[] = [
                { col: mainCol, row: 1, colSpan: 1, rowSpan: subs },
            ];
            for (let i = 0; i < subs; i++) {
                slots.push({ col: subCol, row: i + 1, colSpan: 1, rowSpan: 1 });
            }
            return { colTracks, rowTracks: Array<number>(subs).fill(1), slots };
        }

        case 'main-top': {
            // 横1列に並べたサブの上にメインを置く
            const slots: Slot[] = [
                { col: 1, row: 1, colSpan: subs, rowSpan: 1 },
            ];
            for (let i = 0; i < subs; i++) {
                slots.push({ col: i + 1, row: 2, colSpan: 1, rowSpan: 1 });
            }
            return { colTracks: Array<number>(subs).fill(1), rowTracks: [MAIN_RATIO, 1], slots };
        }

        case 'auto':
        default: {
            const { cols, rows } = calcOptimalGrid(count, vpW, vpH);
            const slots: Slot[] = [];
            for (let i = 0; i < count; i++) {
                slots.push({
                    col: (i % cols) + 1,
                    row: Math.floor(i / cols) + 1,
                    colSpan: 1,
                    rowSpan: 1,
                });
            }
            return {
                colTracks: Array<number>(cols).fill(1),
                rowTracks: Array<number>(rows).fill(1),
                slots,
            };
        }
    }
}

// ── 永続化する状態 ───────────────────────────────────────────────────────────

export interface LayoutState {
    templateId: TemplateId;
    /** 境界ドラッグの結果（未実装）。テンプレートを変えたら破棄する */
    tracks?: { cols: number[]; rows: number[] };
}

/**
 * 枠数ごとに独立して持つ。4枠→5枠→4枠と戻ったときに設定が復元されるため。
 * 共有コードには含めない（v2 の互換を壊さない）。
 */
export type LayoutStore = Record<number, LayoutState>;

const TEMPLATE_IDS: TemplateId[] = ['auto', 'main-left', 'main-right', 'main-top'];

function isTemplateId(v: unknown): v is TemplateId {
    return typeof v === 'string' && (TEMPLATE_IDS as string[]).includes(v);
}

/**
 * localStorage の生文字列から復元する。
 * 壊れていたら握りつぶして空にする（レイアウトは無くても動く）。
 */
export function parseLayoutStore(raw: string | null): LayoutStore {
    if (!raw) return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out: LayoutStore = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            const count = Number(key);
            if (!Number.isInteger(count) || count < 1) continue;
            const id = (value as { templateId?: unknown } | null)?.templateId;
            if (!isTemplateId(id)) continue;
            out[count] = { templateId: id };
        }
        return out;
    } catch {
        return {};
    }
}

/** その枠数で選ばれているテンプレート。未設定・適用不可なら auto */
export function getTemplateFor(store: LayoutStore, count: number): TemplateId {
    const id = store[count]?.templateId;
    if (!id || !isAvailable(id, count)) return 'auto';
    return id;
}

/** 元のストアは変更せず、新しいストアを返す */
export function setTemplateFor(store: LayoutStore, count: number, templateId: TemplateId): LayoutStore {
    return { ...store, [count]: { templateId } };
}

/** fr の配列を CSS の grid-template 値にする */
export function toTemplate(tracks: number[]): string {
    return tracks.map(f => `${f}fr`).join(' ');
}

/** 区画を CSS の grid-column / grid-row の値にする */
export function toGridArea(slot: Slot): { gridColumn: string; gridRow: string } {
    return {
        gridColumn: `${slot.col} / span ${slot.colSpan}`,
        gridRow: `${slot.row} / span ${slot.rowSpan}`,
    };
}
