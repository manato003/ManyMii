import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import StreamFrame from './StreamFrame';
import type { Stream } from '../types';
import type { Locale } from '../i18n';
import { t } from '../i18n';

interface StreamGridProps {
    streams: Stream[];
    setStreams: React.Dispatch<React.SetStateAction<Stream[]>>;
    locale: Locale;
    onHide: (id: string) => void;
    onRefreshStream: (id: string, handle: string) => Promise<void>;
    panelLayout?: 'default' | 'swapped';
}

function calcOptimalGrid(count: number, vpW: number, vpH: number) {
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

const StreamGrid: React.FC<StreamGridProps> = ({ streams, setStreams, locale, onHide, onRefreshStream, panelLayout }) => {
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
    const { cols, rows } = useMemo(
        () => calcOptimalGrid(streams.length, vpSize.w, vpSize.h),
        [streams.length, vpSize]
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

    if (expandedId) {
        const expanded = streams.find(s => s.id === expandedId);
        if (expanded) {
            return (
                <div className="stream-grid-container expanded-mode">
                    <div className="stream-grid-cell expanded-cell">
                        <StreamFrame
                            key={expanded.id}
                            stream={expanded}
                            onRemove={removeStream}
                            locale={locale}
                            onToggleExpand={toggleExpand}
                            onDragHandleMouseDown={handleDragHandleMouseDown}
                            isDragging={false}
                            isDragTarget={false}
                            onHide={onHide}
                            onRefreshStream={onRefreshStream}
                        />
                    </div>
                </div>
            );
        }
    }

    const isDraggingAny = draggingId !== null;

    return (
        <div className={`stream-grid-container${isDraggingAny ? ' is-dragging' : ''}`}>
            <div
                ref={gridRef}
                className="stream-grid"
                style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${cols}, 1fr)`,
                    gridTemplateRows: `repeat(${rows}, 1fr)`,
                    width: '100%',
                    height: '100%',
                    gap: '3px',
                }}
            >
                {streams.map(stream => (
                    <div
                        key={stream.id}
                        className={`stream-grid-cell${dragOverId === stream.id && draggingId !== stream.id ? ' drag-over' : ''}`}
                        data-stream-id={stream.id}
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
