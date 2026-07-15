import { describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import type { HostedImage } from '../src/types';
import { findOrphanHostedImages, normalizeHostedImageUrl } from '../src/utils/hosted-orphan-finder';

function createImage(key: string, url: string): HostedImage {
    return {
        key,
        name: key.split('/').pop() ?? key,
        url,
        size: 1024,
        modified: 0,
    };
}

describe('Hosted orphan finder', () => {
    it('normalizes Unicode, percent encoding, query parameters, and fragments', () => {
        expect(normalizeHostedImageUrl(
            'https://CDN.example.com/images/中文%20图.png?imageView2/1#welcome'
        )).toBe('https://cdn.example.com/images/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png');
        expect(normalizeHostedImageUrl(
            '<https://cdn.example.com/images/%e4%b8%ad%e6%96%87%20%e5%9b%be.png>'
        )).toBe('https://cdn.example.com/images/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png');
    });

    it('returns only hosted images that are not referenced by Markdown images', async () => {
        const notes = [{ path: 'one.md' }, { path: 'two.md' }] as TFile[];
        const contents = new Map([
            ['one.md', '![photo](https://cdn.example.com/images/中文%20图.png?resize=400)'],
            ['two.md', '[normal link](https://cdn.example.com/images/orphan.png)'],
        ]);
        const app = {
            vault: {
                getMarkdownFiles: () => notes,
                cachedRead: vi.fn((file: TFile) => Promise.resolve(contents.get(file.path) ?? '')),
            },
        } as unknown as App;
        const used = createImage('images/中文 图.png', 'https://cdn.example.com/images/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png');
        const orphan = createImage('images/orphan.png', 'https://cdn.example.com/images/orphan.png');

        await expect(findOrphanHostedImages(app, [used, orphan])).resolves.toEqual([orphan]);
    });
});
