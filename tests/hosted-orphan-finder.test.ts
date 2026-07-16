import { describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import type { HostedImage } from '../src/types';
import {
    findHostedImageReferenceLines,
    findOrphanHostedImages,
    getHostedImageReferencingNotes,
    normalizeHostedImageUrl,
} from '../src/utils/hosted-orphan-finder';

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

    it('treats an HTML image tag as a hosted image reference', async () => {
        const notes = [{ path: 'one.md' }] as TFile[];
        const app = {
            vault: {
                getMarkdownFiles: () => notes,
                cachedRead: vi.fn(() => Promise.resolve(
                    '<img alt="remote" src="https://cdn.example.com/images/photo.png?width=880&amp;height=440" />'
                )),
            },
        } as unknown as App;
        const image = createImage(
            'images/photo.png',
            'https://cdn.example.com/images/photo.png'
        );

        await expect(findOrphanHostedImages(app, [image])).resolves.toEqual([]);
        await expect(getHostedImageReferencingNotes(app, image)).resolves.toEqual([
            { path: 'one.md', lines: [0] },
        ]);
    });

    it('finds every zero-based line that embeds the hosted image', () => {
        const content = [
            '![first](https://cdn.example.com/images/photo.png?resize=400)',
            '[normal link](https://cdn.example.com/images/photo.png)',
            '![second](<https://cdn.example.com/images/photo.png#preview> "title")',
            '![other](https://cdn.example.com/images/other.png)',
            '![third](https://cdn.example.com/images/photo.png)',
            '<img src="https://cdn.example.com/images/photo.png?width=880" alt="fourth">',
        ].join('\n');

        expect(findHostedImageReferenceLines(
            content,
            'https://cdn.example.com/images/photo.png'
        )).toEqual([0, 2, 4, 5]);
    });

    it('groups hosted image references by note with all matching lines', async () => {
        const notes = [
            { path: 'notes/one.md' },
            { path: 'notes/two.md' },
            { path: 'notes/unused.md' },
        ] as TFile[];
        const contents = new Map([
            ['notes/one.md', [
                '![first](https://cdn.example.com/images/photo.png)',
                '',
                '![second](https://cdn.example.com/images/photo.png?width=200)',
            ].join('\n')],
            ['notes/two.md', '![photo](https://cdn.example.com/images/photo.png#large)'],
            ['notes/unused.md', '![other](https://cdn.example.com/images/other.png)'],
        ]);
        const app = {
            vault: {
                getMarkdownFiles: () => notes,
                cachedRead: vi.fn((file: TFile) => Promise.resolve(contents.get(file.path) ?? '')),
            },
        } as unknown as App;

        await expect(getHostedImageReferencingNotes(
            app,
            createImage('images/photo.png', 'https://cdn.example.com/images/photo.png')
        )).resolves.toEqual([
            { path: 'notes/one.md', lines: [0, 2] },
            { path: 'notes/two.md', lines: [0] },
        ]);
    });
});
