import React from 'react';
import { X, Settings } from 'lucide-react';
import type { Locale } from '../i18n';
import type { AppSettings } from '../hooks/useSettings';

interface SettingsModalProps {
    onClose: () => void;
    locale: Locale;
    settings: AppSettings;
    onUpdateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, locale, settings, onUpdateSetting }) => {
    const label = (ja: string, en: string) => locale === 'ja' ? ja : en;
    const isSwapped = settings.panelLayout === 'swapped';

    const SHORTCUTS = [
        { key: 'A',   action: label('配信追加モーダルを開く', 'Open add stream modal') },
        { key: ',',   action: label('設定を開く',             'Open settings') },
        { key: '?',   action: label('ヘルプを開く',           'Open help') },
        { key: 'P',   action: label('チャットピン留め切替',   'Toggle chat pin') },
        { key: 'Esc', action: label('モーダルを閉じる',       'Close modal') },
    ];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Settings size={16} color="var(--accent)" />
                        <h2 className="modal-title">{label('設定', 'Settings')}</h2>
                    </div>
                    <button className="icon-button" onClick={onClose} aria-label={label('閉じる', 'Close')}>
                        <X size={18} />
                    </button>
                </div>

                {/* ── レイアウト ── */}
                <div className="settings-section">
                    <div className="settings-section-title">
                        {label('レイアウト', 'Layout')}
                    </div>
                    <div className="settings-row">
                        <div className="settings-row-label">
                            <span className="settings-label">
                                {label('パネルの左右を入れ替え', 'Swap panel sides')}
                            </span>
                            <span className="settings-description">
                                {label(
                                    '配信管理パネルを右側、コメントパネルを左側に移動',
                                    'Move stream panel to right, chat panel to left',
                                )}
                            </span>
                        </div>
                        <button
                            className={`settings-toggle${isSwapped ? ' on' : ''}`}
                            onClick={() => onUpdateSetting('panelLayout', isSwapped ? 'default' : 'swapped')}
                            role="switch"
                            aria-checked={isSwapped}
                            aria-label={label('パネルの左右を入れ替え', 'Swap panel sides')}
                        />
                    </div>
                    <div className="settings-row">
                        <div className="settings-row-label">
                            <span className="settings-label">
                                {label('チャットパネルの幅', 'Chat panel width')}
                            </span>
                            <span className="settings-description">
                                {label('狭め / 標準 / 広め', 'Narrow / Default / Wide')}
                            </span>
                        </div>
                        <div className="settings-toggle-group">
                            {([240, 280, 340] as const).map((w, i) => (
                                <button
                                    key={w}
                                    className={`settings-toggle-btn${settings.chatWidth === w ? ' active' : ''}`}
                                    onClick={() => onUpdateSetting('chatWidth', w)}
                                    aria-label={label(
                                        ['狭め', '標準', '広め'][i],
                                        ['Narrow', 'Default', 'Wide'][i],
                                    )}
                                >
                                    {label(['狭め', '標準', '広め'][i], ['Narrow', 'Default', 'Wide'][i])}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ── 表示 ── */}
                <div className="settings-section">
                    <div className="settings-section-title">
                        {label('表示', 'Display')}
                    </div>
                    <div className="settings-row">
                        <div className="settings-row-label">
                            <span className="settings-label">
                                {label('ヘッダーを常時表示', 'Always show header')}
                            </span>
                            <span className="settings-description">
                                {label(
                                    'OFF のとき画面上端にホバーすると表示',
                                    'When OFF, hover the top edge to reveal',
                                )}
                            </span>
                        </div>
                        <button
                            className={`settings-toggle${settings.headerAlwaysVisible ? ' on' : ''}`}
                            onClick={() => onUpdateSetting('headerAlwaysVisible', !settings.headerAlwaysVisible)}
                            role="switch"
                            aria-checked={settings.headerAlwaysVisible}
                            aria-label={label('ヘッダーを常時表示', 'Always show header')}
                        />
                    </div>
                    <div className="settings-row">
                        <div className="settings-row-label">
                            <span className="settings-label">
                                {label('オフライン枠を自動で再確認', 'Auto re-check offline streams')}
                            </span>
                            <span className="settings-description">
                                {label(
                                    'ライブ中でない枠だけ5分ごとに確認（タブ非表示中は停止）',
                                    'Checks only non-live streams every 5 min (paused when tab is hidden)',
                                )}
                            </span>
                        </div>
                        <button
                            className={`settings-toggle${settings.autoRefreshOffline ? ' on' : ''}`}
                            onClick={() => onUpdateSetting('autoRefreshOffline', !settings.autoRefreshOffline)}
                            role="switch"
                            aria-checked={settings.autoRefreshOffline}
                            aria-label={label('オフライン枠を自動で再確認', 'Auto re-check offline streams')}
                        />
                    </div>
                </div>

                {/* ── パネル ── */}
                <div className="settings-section">
                    <div className="settings-section-title">
                        {label('パネル', 'Panels')}
                    </div>
                    <div className="settings-row">
                        <div className="settings-row-label">
                            <span className="settings-label">
                                {label('パネルの感度', 'Panel sensitivity')}
                            </span>
                            <span className="settings-description">
                                {label(
                                    'マウスを離してからパネルが閉じるまでの速さ',
                                    'How quickly panels hide after mouse leaves',
                                )}
                            </span>
                        </div>
                        <div className="settings-toggle-group">
                            {(['slow', 'normal', 'fast'] as const).map((s, i) => (
                                <button
                                    key={s}
                                    className={`settings-toggle-btn${settings.panelSensitivity === s ? ' active' : ''}`}
                                    onClick={() => onUpdateSetting('panelSensitivity', s)}
                                    aria-label={label(
                                        ['遅め', '標準', '速め'][i],
                                        ['Slow', 'Normal', 'Fast'][i],
                                    )}
                                >
                                    {label(['遅め', '標準', '速め'][i], ['Slow', 'Normal', 'Fast'][i])}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ── キーボードショートカット ── */}
                <div className="settings-section">
                    <div className="settings-section-title">
                        {label('キーボードショートカット', 'Keyboard Shortcuts')}
                    </div>
                    <table className="shortcut-table">
                        <tbody>
                            {SHORTCUTS.map(({ key, action }) => (
                                <tr key={key}>
                                    <td><kbd className="shortcut-kbd">{key}</kbd></td>
                                    <td className="shortcut-action">{action}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
