import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, MonitorPlay, Settings, Share2, HelpCircle, Languages } from 'lucide-react';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import './index.css';
import './side-panel.css';
import StreamGrid from './components/StreamGrid';
import StreamSidePanel from './components/StreamSidePanel';
import ChatSidePanel from './components/ChatSidePanel';
import AddStreamModal from './components/AddStreamModal';
import ShareModal from './components/ShareModal';
import HelpModal from './components/HelpModal';
import SettingsModal from './components/SettingsModal';
import type { Stream } from './types';
import { t } from './i18n';
import type { Locale } from './i18n';
import { useStreamHistory } from './hooks/useStreamHistory';
import type { HistoryEntry } from './hooks/useStreamHistory';
import { useSettings } from './hooks/useSettings';
import { useFavorites, collectChannelsFromFolder } from './hooks/useFavorites';
import { resolveYouTubeChannel, resolveVideoToChannel } from './utils/resolveChannelId';

const HEADER_H = 36;
const HIDE_THRESHOLD = HEADER_H * 5;

function App() {
  const [locale, setLocale] = useState<Locale>('ja');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isChatPinned, setIsChatPinned] = useState(() => localStorage.getItem('chatPinned') === 'true');
  const [isStreamPinned, setIsStreamPinned] = useState(() => localStorage.getItem('streamPinned') === 'true');
  const [settings, updateSetting] = useSettings();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [headerVisible, setHeaderVisible] = useState(() => settings.headerAlwaysVisible);
  const headerVisibleRef = useRef(settings.headerAlwaysVisible);
  const { history, addToHistory, removeFromHistory, reorderHistory, importHistory } = useStreamHistory();
  const { tree: favorites, allChannelIds: favoriteChannelIds, getAllFolders: getFavFolders, actions: favoriteActions, importTree } = useFavorites();

  useEffect(() => {
    // 常時表示モードのときはリスナー不要
    if (settings.headerAlwaysVisible) {
      headerVisibleRef.current = true;
      setHeaderVisible(true);
      return;
    }

    const IDLE_MS = 3000;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const clearIdle = () => {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    };

    const hide = () => {
      headerVisibleRef.current = false;
      setHeaderVisible(false);
      clearIdle();
    };

    const resetIdle = () => {
      clearIdle();
      if (headerVisibleRef.current) {
        idleTimer = setTimeout(hide, IDLE_MS);
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (headerVisibleRef.current && e.clientY > HIDE_THRESHOLD) { hide(); return; }
      if (headerVisibleRef.current) resetIdle();
    };

    const onMouseLeave = (e: MouseEvent) => {
      if (!e.relatedTarget) hide();
    };

    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseleave', onMouseLeave);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);
      clearIdle();
    };
  }, [settings.headerAlwaysVisible]);

  const showHeader = useCallback(() => {
    headerVisibleRef.current = true;
    setHeaderVisible(true);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const savedLocale = localStorage.getItem('locale') as Locale | null;
    if (savedLocale) setLocale(savedLocale);
    const savedStreams = localStorage.getItem('activeStreams');
    if (savedStreams) {
      try {
        // 旧バージョンが isResolving: true を保存している可能性があるため必ず落とす
        const parsed = JSON.parse(savedStreams) as Stream[];
        setStreams(parsed.map(s => ({ ...s, isResolving: false })));
      } catch (e) { console.error(e); }
    }
  }, []);

  useEffect(() => {
    // isResolving は実行時のみのフラグ。保存してしまうと解決中にタブを閉じた枠が
    // 次回起動時に「ライブ確認中...」のまま固まるため、永続化時に取り除く
    const persisted = streams.map(s => {
      const copy: Stream = { ...s };
      delete copy.isResolving;
      return copy;
    });
    localStorage.setItem('activeStreams', JSON.stringify(persisted));
  }, [streams]);

  useEffect(() => {
    localStorage.setItem('chatPinned', String(isChatPinned));
  }, [isChatPinned]);

  useEffect(() => {
    localStorage.setItem('streamPinned', String(isStreamPinned));
  }, [isStreamPinned]);

  const handleLocaleChange = useCallback(() => {
    const next: Locale = locale === 'ja' ? 'en' : 'ja';
    setLocale(next);
    localStorage.setItem('locale', next);
  }, [locale]);

  const handleAddStream = async (stream: Stream) => {
    setStreams(prev => [...prev, stream]);
    addToHistory(stream);

    // ── YouTube channel: resolve live video ID in background ────────────
    if (stream.type === 'youtube' && stream.inputType === 'channel' && stream.channelHandle) {
      try {
        const { videoId, isLive } = await resolveYouTubeChannel(stream.channelHandle);
        setStreams(prev => prev.map(s => s.id === stream.id ? {
          ...s,
          sourceId: isLive ? videoId : stream.channelHandle!,
          inputType: isLive ? 'video' : 'channel',
          isLive,
          isResolving: false,
        } : s));
      } catch (err) {
        console.warn('[App] handleAddStream channel resolve failed:', err);
        setStreams(prev => prev.map(s => s.id === stream.id ? { ...s, isResolving: false } : s));
      }
      return;
    }

    // ── YouTube video URL: resolve channel handle in background (title update) ──
    if (stream.type === 'youtube' && stream.inputType === 'video' && !stream.channelHandle) {
      try {
        const handle = await resolveVideoToChannel(stream.sourceId);
        if (handle) {
          setStreams(prev => prev.map(s => s.id === stream.id ? {
            ...s,
            title: `YouTube: @${handle}`,
            channelHandle: handle,
          } : s));
        }
      } catch (err) {
        console.warn('[App] handleAddStream video handle resolve failed:', err);
      }
    }
  };

  const handleAddFromHistory = useCallback(async (entry: HistoryEntry) => {
    const streamId = crypto.randomUUID();

    if (entry.type === 'youtube' && entry.inputType === 'channel') {
      // 即時追加（ローディング状態）→ バックグラウンドで解決
      setStreams(prev => [...prev, {
        id: streamId,
        type: 'youtube',
        title: entry.title,
        sourceId: entry.sourceId,
        inputType: 'channel',
        channelHandle: entry.sourceId,
        isResolving: true,
      }]);
      try {
        const result = await resolveYouTubeChannel(entry.sourceId);
        setStreams(prev => prev.map(s => s.id === streamId ? {
          ...s,
          sourceId: result.isLive ? result.videoId : entry.sourceId,
          inputType: result.isLive ? 'video' : 'channel',
          isLive: result.isLive,
          isResolving: false,
        } : s));
      } catch (err) {
        console.warn('[App] history add resolve failed:', err);
        setStreams(prev => prev.map(s => s.id === streamId ? { ...s, isResolving: false } : s));
      }
    } else {
      setStreams(prev => [...prev, {
        id: streamId,
        type: entry.type,
        title: entry.title,
        sourceId: entry.sourceId,
        inputType: entry.inputType,
      }]);
    }
  }, []);

  // ── お気に入りから配信追加 ──
  const handleAddFromFavorite = useCallback(async (ch: { type: 'youtube' | 'twitch'; title: string; sourceId: string; inputType: 'channel' | 'video' | 'url' }) => {
    const streamId = crypto.randomUUID();

    if (ch.type === 'youtube' && ch.inputType === 'channel') {
      setStreams(prev => [...prev, {
        id: streamId,
        type: 'youtube',
        title: ch.title,
        sourceId: ch.sourceId,
        inputType: 'channel',
        channelHandle: ch.sourceId,
        isResolving: true,
      }]);
      try {
        const result = await resolveYouTubeChannel(ch.sourceId);
        setStreams(prev => prev.map(s => s.id === streamId ? {
          ...s,
          sourceId: result.isLive ? result.videoId : ch.sourceId,
          inputType: result.isLive ? 'video' : 'channel',
          isLive: result.isLive,
          isResolving: false,
        } : s));
      } catch (err) {
        console.warn('[App] favorite add resolve failed:', err);
        setStreams(prev => prev.map(s => s.id === streamId ? { ...s, isResolving: false } : s));
      }
    } else {
      setStreams(prev => [...prev, {
        id: streamId,
        type: ch.type,
        title: ch.title,
        sourceId: ch.sourceId,
        inputType: ch.inputType,
      }]);
    }
  }, []);

  // ── 履歴からお気に入りに追加（フォルダ指定可） ──
  const handleAddToFavorites = useCallback((entry: HistoryEntry, folderId?: string | null) => {
    favoriteActions.addChannel({
      type: entry.type,
      title: entry.title,
      sourceId: entry.sourceId,
      inputType: entry.inputType,
    }, folderId ?? null);
  }, [favoriteActions]);

  // ── フォルダ内の全チャンネルを一括追加 ──
  const handleBulkAddFromFolder = useCallback((folderId: string) => {
    const channels = collectChannelsFromFolder(favorites, folderId);
    channels.forEach(ch => {
      const key = `${ch.type}:${ch.sourceId}`;
      const isAlreadyActive = streams.some(s => `${s.type}:${s.sourceId}` === key);
      if (!isAlreadyActive) {
        handleAddFromFavorite({
          type: ch.type,
          title: ch.title,
          sourceId: ch.sourceId,
          inputType: ch.inputType,
        });
      }
    });
  }, [favorites, streams, handleAddFromFavorite]);

  const handleReorder = useCallback((fromId: string, toId: string) => {
    setStreams(prev => {
      const arr = [...prev];
      const fi = arr.findIndex(s => s.id === fromId);
      const ti = arr.findIndex(s => s.id === toId);
      if (fi === -1 || ti === -1) return prev;
      [arr[fi], arr[ti]] = [arr[ti], arr[fi]];
      return arr;
    });
  }, []);

  const handleToggleHidden = useCallback((id: string) => {
    setStreams(prev => prev.map(s => s.id === id ? { ...s, hidden: !s.hidden } : s));
  }, []);

  const handleRemoveStream = useCallback((id: string) => {
    setStreams(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleUpdateSourceId = useCallback((id: string, newSourceId: string, isLive: boolean) => {
    setStreams(prev => prev.map(s =>
      s.id === id
        ? { ...s, sourceId: isLive ? newSourceId : s.channelHandle ?? s.sourceId, inputType: isLive ? 'video' : 'channel', isLive }
        : s
    ));
  }, []);

  // 起動時：全YouTubeチャンネル枠のvideo IDをバックグラウンドで再取得
  useEffect(() => {
    const refreshAll = async () => {
      setStreams(prev => {
        const youtubeChannels = prev.filter(s => s.type === 'youtube' && s.channelHandle);
        if (youtubeChannels.length === 0) return prev;
        youtubeChannels.forEach(async (stream) => {
          try {
            const handle = stream.channelHandle!;
            const { videoId, isLive } = await resolveYouTubeChannel(handle);
            setStreams(cur => cur.map(s =>
              s.id === stream.id
                ? { ...s, sourceId: isLive ? videoId : handle, inputType: isLive ? 'video' : 'channel', isLive }
                : s
            ));
          } catch (err) {
            console.warn(`[App] startup refresh failed for ${stream.channelHandle}:`, err);
          }
        });
        return prev;
      });
    };
    refreshAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Share modal handlers ──
  const handleApplyStreams = useCallback((newStreams: Stream[]) => {
    setStreams(newStreams);
  }, []);

  // ── Active stream → お気に入り追加 ──
  // YouTube live中はsourceIdがvideo IDになっているため、channelHandleを優先する
  const handleAddStreamToFavorites = useCallback((stream: Stream) => {
    favoriteActions.addChannel({
      type: stream.type,
      title: stream.title,
      sourceId: stream.channelHandle ?? stream.sourceId,
      inputType: stream.channelHandle ? 'channel' : stream.inputType,
    });
  }, [favoriteActions]);

  // panelSensitivity → hideDelay (ms)
  const panelHideDelay = settings.panelSensitivity === 'slow' ? 1000
                       : settings.panelSensitivity === 'fast' ? 200
                       : 500;

  // 開いているモーダルを1つ閉じる（Esc ショートカット用）
  const onCloseModal = useCallback(() => {
    if (isAddModalOpen) { setIsAddModalOpen(false); return; }
    if (isSettingsModalOpen) { setIsSettingsModalOpen(false); return; }
    if (isHelpModalOpen) { setIsHelpModalOpen(false); return; }
    if (isShareModalOpen) { setIsShareModalOpen(false); return; }
  }, [isAddModalOpen, isSettingsModalOpen, isHelpModalOpen, isShareModalOpen]);

  useKeyboardShortcuts({
    onAddStream: useCallback(() => setIsAddModalOpen(true), []),
    onOpenSettings: useCallback(() => setIsSettingsModalOpen(true), []),
    onOpenHelp: useCallback(() => setIsHelpModalOpen(true), []),
    onToggleChatPin: useCallback(() => setIsChatPinned(p => !p), []),
    onCloseModal,
  });

  const visibleStreams = useMemo(() => streams.filter(s => !s.hidden), [streams]);

  return (
    <div className="app-root" style={{ '--chat-width': `${settings.chatWidth}px` } as React.CSSProperties}>
      <div className="header-trigger" onMouseEnter={showHeader} />

      <header
        className={`app-header ${headerVisible ? 'visible' : ''}`}
        onMouseEnter={showHeader}
      >
        {/* Left: title (クリックでリロード) */}
        <div className="app-title" onClick={() => window.location.reload()} style={{ cursor: 'pointer' }}>
          <MonitorPlay size={16} color="var(--accent)" />
          <span>{t(locale, 'appTitle')}</span>
        </div>

        {/* Center: add stream */}
        <div className="header-center">
          <button className="header-add-btn-center" onClick={() => setIsAddModalOpen(true)}>
            <Plus size={15} />
            <span>{t(locale, 'addStream')}</span>
          </button>
        </div>

        {/* Right: controls */}
        <div className="header-controls">
          <button className="header-btn" onClick={() => setIsShareModalOpen(true)} title={t(locale, 'shareLayout')}>
            <Share2 size={14} />
          </button>

          <button className="header-btn" onClick={() => setIsHelpModalOpen(true)} title={t(locale, 'help')}>
            <HelpCircle size={14} />
          </button>

          <button className="header-btn" onClick={handleLocaleChange} title={t(locale, 'language')}>
            <Languages size={14} />
            <span>{locale === 'ja' ? 'EN' : 'JA'}</span>
          </button>

          <button
            className={`header-btn ${isSettingsModalOpen ? 'active' : ''}`}
            onClick={() => setIsSettingsModalOpen(true)}
            title={locale === 'ja' ? '設定' : 'Settings'}
          >
            <Settings size={14} />
          </button>
        </div>
      </header>

      <main className={`app-main${isChatPinned ? ' chat-pinned' : ''}${isStreamPinned ? ' stream-pinned' : ''}${settings.panelLayout === 'swapped' ? ' panels-swapped' : ''}`}>
        <StreamSidePanel
          streams={streams}
          onToggleHidden={handleToggleHidden}
          onRemove={handleRemoveStream}
          onReorder={handleReorder}
          history={history}
          onAddFromHistory={handleAddFromHistory}
          onRemoveFromHistory={removeFromHistory}
          onReorderHistory={reorderHistory}
          locale={locale}
          swapped={settings.panelLayout === 'swapped'}
          hideDelay={panelHideDelay}
          onOpenAddModal={() => setIsAddModalOpen(true)}
          favorites={favorites}
          favoriteChannelIds={favoriteChannelIds}
          onFavoriteAction={favoriteActions}
          onAddFromFavorite={handleAddFromFavorite}
          onAddToFavorites={handleAddToFavorites}
          onBulkAddFromFolder={handleBulkAddFromFolder}
          isPinned={isStreamPinned}
          onPinChange={setIsStreamPinned}
          getFavFolders={getFavFolders}
          onAddStreamToFavorites={handleAddStreamToFavorites}
        />
        <StreamGrid
          streams={visibleStreams}
          setStreams={setStreams}
          isArchiveMode={false}
          globalTime={0}
          locale={locale}
          onHide={handleToggleHidden}
          onUpdateSourceId={handleUpdateSourceId}
          panelLayout={settings.panelLayout}
        />
        <ChatSidePanel
            streams={streams}
            locale={locale}
            isPinned={isChatPinned}
            onPinChange={setIsChatPinned}
            swapped={settings.panelLayout === 'swapped'}
            hideDelay={panelHideDelay}
          />
      </main>

      {isAddModalOpen && (
        <AddStreamModal
          onClose={() => setIsAddModalOpen(false)}
          onAdd={handleAddStream}
          locale={locale}
          addedStreams={streams}
          onRemove={(id) => setStreams(prev => prev.filter(s => s.id !== id))}
        />
      )}

      {isShareModalOpen && (
        <ShareModal
          onClose={() => setIsShareModalOpen(false)}
          streams={streams}
          favorites={favorites}
          history={history}
          onApplyStreams={handleApplyStreams}
          onApplyFavorites={importTree}
          onApplyHistory={importHistory}
          locale={locale}
        />
      )}

      {isHelpModalOpen && (
        <HelpModal
          onClose={() => setIsHelpModalOpen(false)}
          locale={locale}
        />
      )}

      {isSettingsModalOpen && (
        <SettingsModal
          onClose={() => setIsSettingsModalOpen(false)}
          locale={locale}
          settings={settings}
          onUpdateSetting={updateSetting}
        />
      )}
    </div>
  );
}

export default App;
