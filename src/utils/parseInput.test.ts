import { describe, it, expect } from 'vitest';
import { parseYouTubeInput, parseTwitchInput, isYouTubeChannelId } from './parseInput';

describe('parseYouTubeInput', () => {
    it.each([
        // チャンネルID形式（かつて全分岐をすり抜けてURL全体をvideo IDにしていた）
        ['https://www.youtube.com/channel/UCGCZAYq5Xxojl_tSXcVJhiQ', 'UCGCZAYq5Xxojl_tSXcVJhiQ'],
        ['https://www.youtube.com/channel/UCGCZAYq5Xxojl_tSXcVJhiQ/live', 'UCGCZAYq5Xxojl_tSXcVJhiQ'],
        ['UCGCZAYq5Xxojl_tSXcVJhiQ', 'UCGCZAYq5Xxojl_tSXcVJhiQ'],
        // ハンドル
        ['https://www.youtube.com/@ANNnewsCH', 'ANNnewsCH'],
        ['https://www.youtube.com/@ANNnewsCH/live', 'ANNnewsCH'],
        ['https://www.youtube.com/@ANNnewsCH/videos', 'ANNnewsCH'],
        ['@Popo_Ieiri', 'Popo_Ieiri'],
        // ハンドルにはピリオドや非ASCIIも使える
        ['https://www.youtube.com/@name.official', 'name.official'],
        ['https://www.youtube.com/@%E3%81%BD%E3%81%BD', 'ぽぽ'],
        // 旧形式
        ['https://www.youtube.com/c/SomeLegacy', 'SomeLegacy'],
        ['https://www.youtube.com/user/SomeUser', 'SomeUser'],
    ])('%s をチャンネルとして解釈する', (input, sourceId) => {
        const r = parseYouTubeInput(input);
        expect(r.inputType).toBe('channel');
        expect(r.sourceId).toBe(sourceId);
    });

    it.each([
        ['https://www.youtube.com/watch?v=hWc1A7d0Wd4', 'hWc1A7d0Wd4'],
        ['https://www.youtube.com/watch?feature=share&v=hWc1A7d0Wd4', 'hWc1A7d0Wd4'],
        ['https://youtu.be/hWc1A7d0Wd4', 'hWc1A7d0Wd4'],
        ['https://www.youtube.com/live/hWc1A7d0Wd4', 'hWc1A7d0Wd4'],
        ['https://www.youtube.com/embed/hWc1A7d0Wd4', 'hWc1A7d0Wd4'],
        ['hWc1A7d0Wd4', 'hWc1A7d0Wd4'],
    ])('%s を動画として解釈する', (input, sourceId) => {
        const r = parseYouTubeInput(input);
        expect(r.inputType).toBe('video');
        expect(r.sourceId).toBe(sourceId);
    });

    it('チャンネルURLを埋め込み不能な文字列に落とし込まない', () => {
        // 回帰防止: 以前は sourceId に URL 全体が入り embed/https://... が生成されていた
        for (const url of [
            'https://www.youtube.com/channel/UCGCZAYq5Xxojl_tSXcVJhiQ',
            'https://www.youtube.com/c/SomeLegacy',
            'https://www.youtube.com/user/SomeUser',
        ]) {
            expect(parseYouTubeInput(url).sourceId).not.toContain('/');
        }
    });
});

describe('parseTwitchInput', () => {
    it.each([
        ['https://www.twitch.tv/tototmix', 'channel', 'tototmix'],
        ['https://twitch.tv/tototmix', 'channel', 'tototmix'],
        ['tototmix', 'channel', 'tototmix'],
        ['https://www.twitch.tv/videos/123456', 'video', '123456'],
    ])('%s', (input, inputType, sourceId) => {
        const r = parseTwitchInput(input);
        expect(r.inputType).toBe(inputType);
        expect(r.sourceId).toBe(sourceId);
    });
});

describe('isYouTubeChannelId', () => {
    it('UC + 22文字だけを受け付ける', () => {
        expect(isYouTubeChannelId('UCGCZAYq5Xxojl_tSXcVJhiQ')).toBe(true);
        expect(isYouTubeChannelId('UCshort')).toBe(false);
        expect(isYouTubeChannelId('ANNnewsCH')).toBe(false);
        expect(isYouTubeChannelId('hWc1A7d0Wd4')).toBe(false);
    });
});
