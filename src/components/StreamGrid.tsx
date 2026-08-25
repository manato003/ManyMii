import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import StreamFrame from './StreamFrame';
import type { Stream } from '../types';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { buildLayout, toTemplate, toGridArea, type TemplateId } from '../utils/layout';

interface StreamGridProps {
    streams: Stream[];
    setStreams: React.Dispatch<React.SetStateAction<Stream[]>>;
    locale: Locale;
    onHide: (id: string) => void;
    onRefreshStream: (id: string, handle: string) => Promise<void>;
    panelLayout?: 'default' | 'swapped';
    layoutTemplate?: TemplateId;
}

const StreamGrid: React.FC<StreamGridProps> = ({ streams, setStreams, locale, onHide, onRefreshStream, panelLayout, layoutTemplate = 'auto' }) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [vpSize, setVpSize] = useState({ w: window.innerWidth, h: window.innerHeight });

    // Refs that don't need to trigger re-renders
    const isDragActiveRef = useRef(false);
    const draggingIdRef = useRef<string | null>(null);
    const dragOverIdRef = useRef<string | null>(null);
    const gridRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = () => setVpSize({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
    }, []);

    const removeStream = useCallback((id: string) => {
        setStreams(prev => prev.filter(s => s.id !== id));
        setExpandedId(prev => prev === id ? null : prev);
    }, [setStreams]);

    const toggleExpand = useCallback((id: string) => {
        setExpandedId(prev => prev === id ? null : id);
    }, []);

    // ── Drag: mouse-based, with elementFromPoint detection ──────────────────
    const handleDragHandleMouseDown = useCallback((e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startY = e.clientY;
        isDragActiveRef.current = false;

        const onMouseMove = (me: MouseEvent) => {
            // Activate drag after moving 5px
            if (!isDragActiveRef.current) {
                const d = Math.hypot(me.clientX - startX, me.clientY - startY);
                if (d < 5) return;
                isDragActiveRef.current = true;
                draggingIdRef.current = id;
                setDraggingId(id);
            }

            // Find which cell is under the cursor using elementFromPoint
            // We must temporarily hide the overlay to probe underneath
            const overlay = document.getElementById('drag-global-overlay');
            if (overlay) overlay.style.display = 'none';

            const el = document.elementFromPoint(me.clientX, me.clientY);

            if (overlay) overlay.style.display = '';

            // Walk up DOM to find stream-grid-cell with data-stream-id
            let target: Element | null = el;
            let targetId: string | null = null;
            while (target && target !== gridRef.current) {
                const sid = (target as HTMLElement).dataset?.streamId;
                if (sid) { targetId = sid; break; }
                target = target.parentElement;
            }

            if (targetId !== dragOverIdRef.current) {
                dragOverIdRef.current = targetId;
                setDragOverId(targetId);
            }
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);

            const fromId = draggingIdRef.current;
            const toId = dragOverIdRef.current;

            // Swap if valid and different
            if (fromId && toId && fromId !== toId) {
                setStreams(prev => {
                    const arr = [...prev];
                    const fi = arr.findIndex(s => s.id === fromId);
                    const ti = arr.findIndex(s => s.id === toId);
                    if (fi === -1 || ti === -1) return prev;
                    [arr[fi], arr[ti]] = [arr[ti], arr[fi]];
                    return arr;
                });
            }

            isDragActiveRef.current = false;
            draggingIdRef.current = null;
            dragOverIdRef.current = null;
            setDraggingId(null);
            setDragOverId(null);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, [setStreams]);

    // ── Grid calculation ─────────────────────────────────────────────────────
    const layout = useMemo(
        () => buildLayout(layoutTemplate, streams.length, vpSize.w, vpSize.h),
        [layoutTemplate, streams.length, vpSize],
    );

    /**
     * DOM上の並び順は domSeq（追加順）で固定し、視覚的な位置は CSS の order で表現する。
     *
     * streams 配列の順序をそのまま DOM に反映すると、並べ替えのたびに React が
     * キー付き子要素を insertBefore で physically 移動させ、移動したすべての
     * iframe がブラウザによってリロードされる。
     * （9枠で1枠目を9枠目にドロップすると、Reactの再配置アルゴリズムの性質上
     *   最後尾に来た1つを除く8枠が移動＝リロードされていた）
     */
    const domOrdered = useMemo(
        () => streams
            .map((stream, visualIndex) => ({ stream, visualIndex }))
            .sort((a, b) => (a.stream.domSeq ?? a.visualIndex) - (b.stream.domSeq ?? b.visualIndex)),
        [streams],
    );

    // ── Render ───────────────────────────────────────────────────────────────
    if (streams.length === 0) {
        const isSwapped = panelLayout === 'swapped';
        // Both panels are edge-hover: ← for left edge, → for right edge
        const leftArrow  = '←';
        const rightArrow = '→';
        const leftLabel  = isSwapped
            ? (locale === 'ja' ? 'コメント' : 'Chat')
            : (locale === 'ja' ? '配信管理' : 'Streams');
        const rightLabel = isSwapped
            ? (locale === 'ja' ? '配信管理' : 'Streams')
            : (locale === 'ja' ? 'コメント' : 'Chat');
        return (
            <div className="stream-grid-empty">
                <div className="empty-hint-side">
                    <span className="empty-hint-arrow">{leftArrow}</span>
                    <span className="empty-hint-label">{leftLabel}</span>
                </div>
                <p className="empty-hint-center">{t(locale, 'noStreams')}</p>
                <div className="empty-hint-side">
                    <span className="empty-hint-arrow">{rightArrow}</span>
                    <span className="empty-hint-label">{rightLabel}</span>
                </div>
            </div>
        );
    }

    const isDraggingAny = draggingId !== null;

    // 拡大は「別のツリー」ではなく「1枠が全マスを占めるレイアウト」として扱う。
    // 別ツリーを返すと対象以外の StreamFrame がアンマウントされ、復帰時に
    // 全枠がリロードされる。ここは CSS だけで切り替えること。
    // 隠した枠は display:none にするだけなので iframe は生きたまま＝音は鳴り続ける
    // （tasks/layout-requirements.md の決定事項）。
    const isExpanded = expandedId !== null && streams.some(s => s.id === expandedId);

    /** その枠に与えるグリッド上の位置。拡大中は対象が全面、他は非表示 */
    const cellPlacement = (streamId: string, visualIndex: number): React.CSSProperties => {
        if (isExpanded) {
            return streamId === expandedId
                ? { gridArea: '1 / 1 / -1 / -1' }
                : { display: 'none' };
        }
        return toGridArea(layout.slots[visualIndex] ?? { col: 1, row: 1, colSpan: 1, rowSpan: 1 });
    };

    return (
        <div className={`stream-grid-container${isDraggingAny ? ' is-dragging' : ''}${isExpanded ? ' is-expanded' : ''}`}>
            <div
                ref={gridRef}
                className="stream-grid"
                style={{
                    display: 'grid',
                    gridTemplateColumns: toTemplate(layout.colTracks),
                    gridTemplateRows: toTemplate(layout.rowTracks),
                    width: '100%',
                    height: '100%',
                    gap: isExpanded ? '0' : '3px',
                }}
            >
                {domOrdered.map(({ stream, visualIndex }) => (
                    <div
                        key={stream.id}
                        className={`stream-grid-cell${dragOverId === stream.id && draggingId !== stream.id ? ' drag-over' : ''}`}
                        data-stream-id={stream.id}
                        style={cellPlacement(stream.id, visualIndex)}
                    >
                        <StreamFrame
                            key={stream.id}
                            stream={stream}
                            onRemove={removeStream}
                            locale={locale}
                            onToggleExpand={toggleExpand}
                            onDragHandleMouseDown={handleDragHandleMouseDown}
                            isDragging={draggingId === stream.id}
                            isDragTarget={dragOverId === stream.id && draggingId !== stream.id}
                            onHide={onHide}
                            onRefreshStream={onRefreshStream}
                        />
                    </div>
                ))}
            </div>

            {/* Full-screen overlay during drag: blocks all iframes */}
            {isDraggingAny && (
                <div id="drag-global-overlay" className="drag-global-overlay" />
            )}
        </div>
    );
};

export default StreamGrid;
