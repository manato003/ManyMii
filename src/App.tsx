import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, MonitorPlay, Settings, Share2, HelpCircle, Languages } from 'lucide-react';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import './index.css';
import './side-panel.css';
import StreamGrid from './components/StreamGrid';
import { useStreamLayout } from './hooks/useStreamLayout';
import { sanitizeStreams } from './utils/validate';
import StreamSidePanel from './components/StreamSidePanel';
import ChatSidePanel from './components/ChatSidePanel';
import AddStreamModal from './components/AddStreamModal';
import ShareModal from './components/ShareModal';
import HelpModal from './components/HelpModal';
import SettingsModal from './components/SettingsModal';
import type { Stream } from './types';
import { isRefreshable } from './types';
import { t } from './i18n';
import type { Locale } from './i18n';
import { useStreamHistory } from './hooks/useStreamHistory';
import type { HistoryEntry } from './hooks/useStreamHistory';
import { useSettings } from './hooks/useSettings';
import { useFavorites, collectChannelsFromFolder } from './hooks/useFavorites';
import { resolveYouTubeChannel, resolveVideoToChannel, resolveTwitchChannelName } from './utils/resolveChannelId';

const HEADER_H = 36;
const HIDE_THRESHOLD = HEADER_H * 5;

const STREAMS_KEY = 'activeStreams';

/** オフライン枠のライブ状態を自動再確認する間隔 */
const AUTO_REFRESH_MS = 5 * 60 * 1000;

// グリッドのDOM順序を固定するための通し番号。単調増加させるだけでよい
let domSeqCounter = 0;
const nextDomSeq = () => ++domSeqCounter;

/** localStorage から配信リストを復元する（他のフックと同じ遅延初期化パターン） */
function loadStreams(): Stream[] {
  try {
    const raw = localStorage.getItem(STREAMS_KEY);
    if (!raw) return [];
    // isResolving は実行時フラグ。旧バージョンが true のまま保存している場合の救済
    // domSeq は永続化していないので、復元時に配列順で振り直す
    // 保存済みでも信用しない。壊れていると描画で落ち、リロードしても直らない
    const list = sanitizeStreams(JSON.parse(raw)).map((s, i) => ({
      ...s,
      id: crypto.randomUUID(),
      isResolving: false,
      domSeq: i + 1,
    }));
    domSeqCounter = list.length;
    return list;
  } catch (e) {
    console.error(e);
    return [];
  }
}

function App() {
  const [locale, setLocale] = useState<Locale>(
    () => (localStorage.getItem('locale') as Locale | null) ?? 'ja',
  );
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isChatPinned, setIsChatPinned] = useState(() => localStorage.getItem('chatPinned') === 'true');
  const [isStreamPinned, setIsStreamPinned] = useState(() => localStorage.getItem('streamPinned') === 'true');
  const [settings, updateSetting] = useSettings();
  const [streams, setStreams] = useState<Stream[]>(loadStreams);
  const [headerVisible, setHeaderVisible] = useState(() => settings.headerAlwaysVisible);
  const headerVisibleRef = useRef(settings.headerAlwaysVisible);
  const { history, addToHistory, removeFromHistory, reorderHistory, importHistory, setDisplayName: setHistoryDisplayName } = useStreamHistory();
  const { tree: favorites, allChannelIds: favoriteChannelIds, getAllFolders: getFavFolders, actions: favoriteActions, importTree } = useFavorites();

  useEffect(() => {
    // 常時表示モードのときはリスナー不要（表示状態は描画時に導出する）
    if (settings.headerAlwaysVisible) {
      headerVisibleRef.current = true;
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

  /**
   * YouTubeチャンネル枠の video ID をバックグラウンドで解決して反映する。
   * 追加・復元・リロード・定期確認のすべてがこの1本を経由する。
   */
  /** 表示名が判明したら履歴・お気に入りにも反映する */
  const propagateDisplayName = useCallback((
    type: 'youtube' | 'twitch',
    sourceId: string,
    displayName: string,
  ) => {
    setHistoryDisplayName(type, sourceId, displayName);
    favoriteActions.setDisplayName(type, sourceId, displayName);
  }, [setHistoryDisplayName, favoriteActions]);

  /**
   * force=true は「ユーザーが再確認を押した」ケース。
   * キャッシュを無視して必ず取り直す。
   */
  const resolveStreamInBackground = useCallback(async (streamId: string, handle: string, force = false) => {
    const result = await resolveYouTubeChannel(handle, { force });

    if (result.status !== 'error' && result.channelName) {
      propagateDisplayName('youtube', handle, result.channelName);
    }

    setStreams(prev => prev.map(s => {
      if (s.id !== streamId) return s;
      const named = result.status === 'error'
        ? s
        : { ...s, channelId: result.channelId ?? s.channelId, displayName: result.channelName ?? s.displayName };
      switch (result.status) {
        case 'live':
          return { ...named, sourceId: result.videoId, inputType: 'video', isLive: true, isResolving: false, resolveError: false };
        case 'offline':
          return { ...named, sourceId: handle, inputType: 'channel', isLive: false, isResolving: false, resolveError: false };
        case 'error':
          // 判定できなかっただけなので現在の video ID は維持し、失敗したことだけ記録する
          return { ...named, isResolving: false, resolveError: true };
      }
    }));
  }, [propagateDisplayName]);

  /** Twitchはライブ判定が不要なので表示名だけを取りに行く */
  const resolveTwitchNameInBackground = useCallback(async (streamId: string, login: string) => {
    const name = await resolveTwitchChannelName(login);
    if (!name) return;
    propagateDisplayName('twitch', login, name);
    setStreams(prev => prev.map(s => s.id === streamId ? { ...s, displayName: name } : s));
  }, [propagateDisplayName]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  // setInterval から最新の streams を読むための参照
  const streamsRef = useRef(streams);
  useEffect(() => { streamsRef.current = streams; }, [streams]);

  /**
   * YouTubeチャンネル枠をまとめて再解決する。プロキシに負荷をかけないよう逐次実行する。
   *
   * `includeLive` で対象が変わる:
   * - **手動（ボタン）は true。** 配信の仕切り直しで video ID が変わり、
   *   古い ID の埋め込みが「配信終了」のサムネイルになるため、ライブ中も対象にする
   * - **定期実行は false。** 1レスポンスが 1.2〜2.7MB あるので、
   *   目的（オフライン枠がライブになったのを拾う）に絞って通信量を抑える
   */
  const refreshStreams = useCallback(async (showSpinner: boolean, includeLive: boolean) => {
    const targets = streamsRef.current.filter(
      s => isRefreshable(s) && (includeLive || s.isLive !== true),
    );
    if (targets.length === 0) return;

    if (showSpinner) {
      const ids = new Set(targets.map(s => s.id));
      setStreams(prev => prev.map(s => ids.has(s.id) ? { ...s, isResolving: true } : s));
    }
    for (const s of targets) {
      // 再確認は明示的な更新要求なのでキャッシュを使わない
      await resolveStreamInBackground(s.id, s.channelHandle!, true);
    }
  }, [resolveStreamInBackground]);

  const handleRefresh = useCallback(() => { void refreshStreams(true, true); }, [refreshStreams]);

  // オフライン枠の定期再確認。タブが見えていないときは何もしない
  useEffect(() => {
    if (!settings.autoRefreshOffline) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      void refreshStreams(false, false);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [settings.autoRefreshOffline, refreshStreams]);

  // 起動時: 復元した YouTubeチャンネル枠の video ID を再取得する。
  // スピナーは出さず、解決できたら差し替える（前回の枠がすぐ再生される）
  const didStartupRefresh = useRef(false);
  useEffect(() => {
    if (didStartupRefresh.current) return;
    didStartupRefresh.current = true;
    streams.forEach(s => {
      if (s.channelHandle) void resolveStreamInBackground(s.id, s.channelHandle);
    });
  }, [streams, resolveStreamInBackground]);

  useEffect(() => {
    // isResolving は実行時のみのフラグ。保存してしまうと解決中にタブを閉じた枠が
    // 次回起動時に「ライブ確認中...」のまま固まるため、永続化時に取り除く
    const persisted = streams.map(s => {
      const copy: Stream = { ...s };
      delete copy.isResolving;
      delete copy.domSeq;
      return copy;
    });
    localStorage.setItem(STREAMS_KEY, JSON.stringify(persisted));
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

  const handleAddStream = useCallback((stream: Stream) => {
    setStreams(prev => [...prev, { ...stream, domSeq: nextDomSeq() }]);
    addToHistory(stream);

    // ── YouTubeチャンネル: ライブ中の video ID を背景で解決 ──
    if (stream.type === 'youtube' && stream.inputType === 'channel' && stream.channelHandle) {
      void resolveStreamInBackground(stream.id, stream.channelHandle);
      return;
    }

    // ── Twitch: 表示名だけ背景で取得 ──
    if (stream.type === 'twitch' && stream.inputType === 'channel') {
      void resolveTwitchNameInBackground(stream.id, stream.sourceId);
      return;
    }

    // ── YouTube動画URL: チャンネルハンドルと表示名を背景で取得 ──
    if (stream.type === 'youtube' && stream.inputType === 'video' && !stream.channelHandle) {
      void resolveVideoToChannel(stream.sourceId)
        .then(info => {
          if (!info || !info.handle) return;
          if (info.channelName) propagateDisplayName('youtube', info.handle, info.channelName);
          setStreams(prev => prev.map(s => s.id === stream.id
            ? {
                ...s,
                title: `YouTube: @${info.handle}`,
                channelHandle: info.handle ?? undefined,
                channelId: info.channelId ?? s.channelId,
                displayName: info.channelName ?? s.displayName,
              }
            : s));
        })
        .catch(err => console.warn('[App] video handle resolve failed:', err));
    }
  }, [addToHistory, resolveStreamInBackground, resolveTwitchNameInBackground, propagateDisplayName]);

  /**
   * 履歴 / お気に入りから配信を追加する。
   * YouTubeチャンネルは即座にローディング枠を出し、video ID は背景で解決する。
   */
  const addStreamFromSource = useCallback((src: {
    type: 'youtube' | 'twitch';
    title: string;
    sourceId: string;
    inputType: 'channel' | 'video' | 'url';
    displayName?: string;
  }) => {
    const streamId = crypto.randomUUID();
    const isYouTubeChannel = src.type === 'youtube' && src.inputType === 'channel';
    const isTwitchChannel = src.type === 'twitch' && src.inputType === 'channel';

    setStreams(prev => [...prev, {
      id: streamId,
      type: src.type,
      title: src.title,
      sourceId: src.sourceId,
      inputType: src.inputType,
      displayName: src.displayName,
      domSeq: nextDomSeq(),
      ...(isYouTubeChannel ? { channelHandle: src.sourceId, isResolving: true } : {}),
    }]);

    if (isYouTubeChannel) void resolveStreamInBackground(streamId, src.sourceId);
    // 表示名が未取得の Twitch チャンネルだけ取りに行く
    else if (isTwitchChannel && !src.displayName) void resolveTwitchNameInBackground(streamId, src.sourceId);
  }, [resolveStreamInBackground, resolveTwitchNameInBackground]);

  const handleAddFromHistory = useCallback(
    (entry: HistoryEntry) => addStreamFromSource(entry),
    [addStreamFromSource],
  );

  // ── お気に入りから配信追加 ──
  const handleAddFromFavorite = useCallback(
    (ch: { type: 'youtube' | 'twitch'; title: string; sourceId: string; inputType: 'channel' | 'video' | 'url'; displayName?: string }) =>
      addStreamFromSource(ch),
    [addStreamFromSource],
  );

  // ── 履歴からお気に入りに追加（フォルダ指定可） ──
  const handleAddToFavorites = useCallback((entry: HistoryEntry, folderId?: string | null) => {
    favoriteActions.addChannel({
      type: entry.type,
      title: entry.title,
      sourceId: entry.sourceId,
      inputType: entry.inputType,
      displayName: entry.displayName,
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

  /** 個別枠のリロードボタンから呼ばれる再解決 */
  const handleRefreshStream = useCallback(
    (id: string, handle: string) => resolveStreamInBackground(id, handle),
    [resolveStreamInBackground],
  );



  // ── Share modal handlers ──
  // 共有コードから復元した YouTube チャンネル枠は video ID が未解決なので、
  // 反映と同時にバックグラウンドで解決する（そのまま埋め込むと再生エラーになる）
  const handleApplyStreams = useCallback((newStreams: Stream[]) => {
    const prepared = newStreams.map((s, i) =>
      s.type === 'youtube' && s.inputType === 'channel'
        ? { ...s, channelHandle: s.channelHandle ?? s.sourceId, isResolving: true, domSeq: i + 1 }
        : { ...s, domSeq: i + 1 }
    );
    domSeqCounter = prepared.length;
    setStreams(prepared);
    prepared.forEach(s => {
      if (s.isResolving && s.channelHandle) resolveStreamInBackground(s.id, s.channelHandle);
    });
  }, [resolveStreamInBackground]);

  // ── Active stream → お気に入り追加 ──
  // YouTube live中はsourceIdがvideo IDになっているため、channelHandleを優先する
  const handleAddStreamToFavorites = useCallback((stream: Stream) => {
    favoriteActions.addChannel({
      type: stream.type,
      title: stream.title,
      sourceId: stream.channelHandle ?? stream.sourceId,
      inputType: stream.channelHandle ? 'channel' : stream.inputType,
      displayName: stream.displayName,
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

  // レイアウトは「見えている枠の数」に紐づける。非表示の枠はグリッドに出ないため
  const { templateId: layoutTemplate, setTemplate: setLayoutTemplate, setTracks: setLayoutTracks, resolveTracks: resolveLayoutTracks } = useStreamLayout(visibleStreams.length);

  // 再確認の対象になる枠（YouTubeチャンネル由来の枠すべて）
  const refreshableCount = useMemo(
    () => streams.filter(isRefreshable).length,
    [streams],
  );

  // 常時表示設定のときは state に依存せず必ず表示する
  const isHeaderVisible = settings.headerAlwaysVisible || headerVisible;

  return (
    <div className="app-root" style={{ '--chat-width': `${settings.chatWidth}px` } as React.CSSProperties}>
      <div className="header-trigger" onMouseEnter={showHeader} />

      <header
        className={`app-header ${isHeaderVisible ? 'visible' : ''}`}
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
          refreshableCount={refreshableCount}
          onRefresh={handleRefresh}
          layoutTemplate={layoutTemplate}
          onLayoutChange={setLayoutTemplate}
          layoutStreamCount={visibleStreams.length}
        />
        <StreamGrid
          streams={visibleStreams}
          setStreams={setStreams}
          locale={locale}
          onHide={handleToggleHidden}
          onRefreshStream={handleRefreshStream}
          panelLayout={settings.panelLayout}
          layoutTemplate={layoutTemplate}
          resolveTracks={resolveLayoutTracks}
          onTracksChange={setLayoutTracks}
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
