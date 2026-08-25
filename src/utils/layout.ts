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

export type TemplateId = 'auto' | 'main-left' | 'main-right' | 'main-top' | 'l-shape';

/** 動画の縦横比。黒帯を最小にするための目標値 */
const TARGET_ASPECT = 16 / 9;

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
 * l-shape は右列と下段の両方にサブが要り、かつメインが2マス以上を占める必要があるので5枠から。
 */
export function availableTemplates(count: number): TemplateId[] {
    if (count < 2) return ['auto'];
    // l-shape は 4枠だとメインが1マスになりサブと同じ大きさになってしまうので5枠から
    if (count < 5) return ['auto', 'main-left', 'main-right', 'main-top'];
    return ['auto', 'main-left', 'main-right', 'main-top', 'l-shape'];
}

/**
 * L字レイアウトの列数・行数を選ぶ。
 *
 * 左上にメインを置き、右の列と下の段にサブを L 字に並べる。
 * トラックをすべて等分にすると、C 列 R 行のとき
 *
 *   サブ1枚の縦横比  = (W/C) / (H/R)        = A · R/C
 *   メインの縦横比   = (W(C-1)/C) / (H(R-1)/R) = A · R/C · (C-1)/(R-1)
 *
 * となる（A はビューポートの縦横比）。**C = R のときメインとサブの
 * 縦横比が一致する**ので、16:9 の画面なら両方とも 16:9 に揃い、黒帯が消える。
 *
 * サブの枚数は「右列 R-1 枚 + 下段 C 枚」なので、枠数 n との関係は
 *
 *   n = 1 + (R - 1) + C = C + R
 *
 * つまり**枠数を縦横に振り分けるだけ**で決まる。定数は持たず、
 * C + R = n を満たす組み合わせを総当たりして、メインとサブの縦横比が
 * もっとも 16:9 に近くなるものを選ぶ。
 */
export function pickLShapeGrid(count: number, vpW: number, vpH: number): { cols: number; rows: number } {
    const aspect = vpH > 0 ? vpW / vpH : TARGET_ASPECT;
    let best = { cols: 2, rows: count - 2 };
    let bestCost = Infinity;

    // C も R も 2 以上（メインが 1 マス以上、サブが両辺に必要）
    for (let cols = 2; cols <= count - 2; cols++) {
        const rows = count - cols;
        if (rows < 2) continue;
        const sub = aspect * rows / cols;
        const main = sub * (cols - 1) / (rows - 1);
        // 対数で測ると「2倍細長い」と「2倍平たい」を同じ距離として扱える
        const cost = Math.abs(Math.log(sub / TARGET_ASPECT)) + Math.abs(Math.log(main / TARGET_ASPECT));
        if (cost < bestCost) {
            bestCost = cost;
            best = { cols, rows };
        }
    }
    return best;
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

        case 'l-shape': {
            // 左上にメイン、右列と下段にサブを L 字に並べる
            const { cols, rows } = pickLShapeGrid(count, vpW, vpH);
            const slots: Slot[] = [
                { col: 1, row: 1, colSpan: cols - 1, rowSpan: rows - 1 },
            ];
            // 右の列を上から
            for (let r = 1; r <= rows - 1; r++) {
                slots.push({ col: cols, row: r, colSpan: 1, rowSpan: 1 });
            }
            // 下の段を左から
            for (let c = 1; c <= cols; c++) {
                slots.push({ col: c, row: rows, colSpan: 1, rowSpan: 1 });
            }
            return {
                colTracks: Array<number>(cols).fill(1),
                rowTracks: Array<number>(rows).fill(1),
                slots,
            };
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

// ── 境界ドラッグ ─────────────────────────────────────────────────────────────

/**
 * 1トラックの最小 fr。0 まで縮められると枠が消えて掴み直せなくなる。
 */
export const MIN_FR = 0.3;

/**
 * `index` 番目と `index + 1` 番目の境界を動かす。
 * 総和は変えない（片方に足した分をもう片方から引く）ので、
 * グリッド全体の大きさは変わらない。
 *
 * 最小値に張り付いたらそれ以上は動かさない。元の配列は変更しない。
 */
export function resizeTracks(tracks: number[], index: number, deltaFr: number): number[] {
    if (index < 0 || index + 1 >= tracks.length) return tracks;
    const a = tracks[index];
    const b = tracks[index + 1];
    // 両側が MIN_FR を下回らない範囲に delta を丸める
    const clamped = Math.max(MIN_FR - a, Math.min(b - MIN_FR, deltaFr));
    if (clamped === 0) return tracks;
    const next = [...tracks];
    next[index] = a + clamped;
    next[index + 1] = b - clamped;
    return next;
}

/**
 * 各境界の位置を 0〜1 の比率で返す。長さは `tracks.length - 1`。
 * ハンドルを置く座標に使う。
 */
export function trackOffsets(tracks: number[]): number[] {
    const total = tracks.reduce((sum, f) => sum + f, 0);
    if (total <= 0) return [];
    const out: number[] = [];
    let acc = 0;
    for (let i = 0; i < tracks.length - 1; i++) {
        acc += tracks[i];
        out.push(acc / total);
    }
    return out;
}

// ── 永続化する状態 ───────────────────────────────────────────────────────────

/**
 * **テンプレートはアプリ全体で1つ、トラック幅だけ枠数ごとに持つ。**
 *
 * 当初はテンプレートも枠数ごとに持っていたが、枠を1つ非表示にしただけで
 * 「その枠数の設定は未保存」となり auto に戻ってしまった。
 * main-* は枠数によらず成立するので、枠数ごとに持つ意味がない。
 *
 * 一方トラック幅（fr 値）は列数・行数に依存するため、枠数ごとに持つ必要がある。
 *
 * 共有コードには含めない（v2 の互換を壊さない）。
 */
export interface LayoutStore {
    templateId: TemplateId;
    /** キーは枠数 */
    tracks: Record<number, { cols: number[]; rows: number[] }>;
}

export const EMPTY_LAYOUT_STORE: LayoutStore = { templateId: 'auto', tracks: {} };

const TEMPLATE_IDS: TemplateId[] = ['auto', 'main-left', 'main-right', 'main-top', 'l-shape'];

function isTemplateId(v: unknown): v is TemplateId {
    return typeof v === 'string' && (TEMPLATE_IDS as string[]).includes(v);
}

function parseTrackArray(v: unknown): number[] | null {
    if (!Array.isArray(v) || v.length === 0) return null;
    if (!v.every(n => typeof n === 'number' && Number.isFinite(n) && n >= MIN_FR)) return null;
    return v as number[];
}

function parseTrackPair(v: unknown): { cols: number[]; rows: number[] } | null {
    const t = v as { cols?: unknown; rows?: unknown } | null | undefined;
    const cols = parseTrackArray(t?.cols);
    const rows = parseTrackArray(t?.rows);
    // 片方だけ壊れているものは丸ごと捨てる。中途半端に適用しない
    return cols && rows ? { cols, rows } : null;
}

/**
 * localStorage の生文字列から復元する。
 * 壊れていたら握りつぶして既定に落とす（レイアウトは無くても動く）。
 *
 * 旧形式（枠数ごとに templateId を持っていた頃）も読めるようにしてある。
 * 最初に見つかった有効なテンプレートを全体の設定として引き継ぐ。
 */
export function parseLayoutStore(raw: string | null): LayoutStore {
    if (!raw) return EMPTY_LAYOUT_STORE;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_LAYOUT_STORE;
        const obj = parsed as Record<string, unknown>;

        // 現行形式
        if ('templateId' in obj || 'tracks' in obj) {
            const templateId = isTemplateId(obj.templateId) ? obj.templateId : 'auto';
            const tracks: LayoutStore['tracks'] = {};
            const rawTracks = obj.tracks;
            if (rawTracks && typeof rawTracks === 'object' && !Array.isArray(rawTracks)) {
                for (const [key, value] of Object.entries(rawTracks as Record<string, unknown>)) {
                    const count = Number(key);
                    if (!Number.isInteger(count) || count < 1) continue;
                    const pair = parseTrackPair(value);
                    if (pair) tracks[count] = pair;
                }
            }
            return { templateId, tracks };
        }

        // 旧形式: { [count]: { templateId, tracks? } }
        let templateId: TemplateId = 'auto';
        const tracks: LayoutStore['tracks'] = {};
        for (const [key, value] of Object.entries(obj)) {
            const count = Number(key);
            if (!Number.isInteger(count) || count < 1) continue;
            const entry = value as { templateId?: unknown; tracks?: unknown } | null;
            if (!isTemplateId(entry?.templateId)) continue;
            if (templateId === 'auto') templateId = entry.templateId;
            const pair = parseTrackPair(entry.tracks);
            if (pair) tracks[count] = pair;
        }
        return { templateId, tracks };
    } catch {
        return EMPTY_LAYOUT_STORE;
    }
}

/**
 * 保存されたトラックを、いま表示しようとしているレイアウトに適用してよいか判定する。
 *
 * **本数が一致しないものは使わない。** テンプレートを変えたり枠数が変わったりすると
 * 列数・行数が変わるため、そのまま当てると区画とトラックがずれて崩れる。
 */
export function tracksFor(
    store: LayoutStore,
    count: number,
    base: ResolvedLayout,
): { cols: number[]; rows: number[] } | null {
    const saved = store.tracks[count];
    if (!saved) return null;
    if (saved.cols.length !== base.colTracks.length) return null;
    if (saved.rows.length !== base.rowTracks.length) return null;
    return saved;
}

/** 選択中のテンプレート。その枠数で成立しないなら auto に落とす */
export function getTemplateFor(store: LayoutStore, count: number): TemplateId {
    return isAvailable(store.templateId, count) ? store.templateId : 'auto';
}

/**
 * 元のストアは変更せず、新しいストアを返す。
 * **テンプレートを変えたら調整済みの幅はすべて破棄する**（列数・行数が変わるため）。
 */
export function setTemplateFor(store: LayoutStore, templateId: TemplateId): LayoutStore {
    return { templateId, tracks: {} };
}

/** 境界ドラッグの結果を保存する。テンプレートは維持する */
export function setTracksFor(
    store: LayoutStore,
    count: number,
    tracks: { cols: number[]; rows: number[] },
): LayoutStore {
    return { templateId: store.templateId, tracks: { ...store.tracks, [count]: tracks } };
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
