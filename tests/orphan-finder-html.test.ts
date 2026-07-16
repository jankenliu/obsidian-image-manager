import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';

vi.mock('obsidian', () => ({
    TFile: class {},
    normalizePath: (path: string) => {
        const parts: string[] = [];
        for (const part of path.replace(/\\/g, '/').split('/')) {
            if (!part || part === '.') continue;
            if (part === '..') parts.pop();
            else parts.push(part);
        }
        return parts.join('/');
    },
}));

import { OrphanFinder } from '../src/utils/orphan-finder';
import { TFile } from 'obsidian';

function createFile(path: string): TFile {
    const name = path.split('/').pop() ?? path;
    const file = new TFile();
    file.path = path;
    file.name = name;
    file.extension = name.split('.').pop() ?? '';
    file.stat = { size: 0, mtime: 0, ctime: 0 };
    return file;
}

describe('Orphan finder HTML image references', () => {
    it('does not mark a Markdown image path containing parentheses as orphaned', async () => {
        const image = createFile('linux/assets/内存问题(内存够用但报oom)-1.png');
        const note = createFile('linux/内存问题.md');
        const content = '![内存问题](assets/内存问题(内存够用但报oom)-1.png)';
        const app = {
            vault: {
                getFiles: () => [image, note],
                getMarkdownFiles: () => [note],
                cachedRead: vi.fn(() => Promise.resolve(content)),
            },
            metadataCache: {
                getFirstLinkpathDest: vi.fn(() => null),
            },
        } as unknown as App;
        const finder = new OrphanFinder(app, ['png']);

        await expect(finder.findOrphans()).resolves.toMatchObject({ orphans: [] });
        await expect(finder.getReferencingNotes(image)).resolves.toEqual([
            { path: 'linux/内存问题.md', lines: [0] },
        ]);
    });

    it('does not mark an image referenced by a relative HTML img tag as orphaned', async () => {
        const image = createFile('assets/tencentdb/logo.png');
        const note = createFile('tencentdb/README.md');
        const content = '<img src="../assets/tencentdb/logo.png" alt="TencentDB Agent Memory" width="880" />';
        const app = {
            vault: {
                getFiles: () => [image, note],
                getMarkdownFiles: () => [note],
                cachedRead: vi.fn(() => Promise.resolve(content)),
            },
            metadataCache: {
                getFirstLinkpathDest: vi.fn(() => null),
            },
        } as unknown as App;
        const finder = new OrphanFinder(app, ['png']);

        await expect(finder.findOrphans()).resolves.toMatchObject({
            orphans: [],
            total: 1,
            referenced: 1,
        });
        await expect(finder.getReferencingNotes(image)).resolves.toEqual([
            { path: 'tencentdb/README.md', lines: [0] },
        ]);
    });

    it('keeps detail references aligned with orphan detection for imported paths', async () => {
        const image = createFile('assets/tencentdb/logo.png');
        const note = createFile('projects/tencentdb/README.md');
        const content = '<img src="../assets/tencentdb/logo.png" alt="TencentDB Agent Memory" width="880" />';
        const app = {
            vault: {
                getFiles: () => [image, note],
                getMarkdownFiles: () => [note],
                cachedRead: vi.fn(() => Promise.resolve(content)),
            },
            metadataCache: {
                getFirstLinkpathDest: vi.fn(() => null),
            },
        } as unknown as App;
        const finder = new OrphanFinder(app, ['png']);

        await expect(finder.findOrphans()).resolves.toMatchObject({ orphans: [] });
        await expect(finder.getReferencingNotes(image)).resolves.toEqual([
            { path: 'projects/tencentdb/README.md', lines: [0] },
        ]);
    });

    it('uses Obsidian link resolution before path fallbacks', async () => {
        const image = createFile('resolved/by-obsidian/logo.png');
        const note = createFile('notes/README.md');
        const content = '<img src="../assets/tencentdb/logo.png" />';
        const getFirstLinkpathDest = vi.fn(() => image);
        const app = {
            vault: {
                getFiles: () => [image, note],
                getMarkdownFiles: () => [note],
                cachedRead: vi.fn(() => Promise.resolve(content)),
            },
            metadataCache: { getFirstLinkpathDest },
        } as unknown as App;
        const finder = new OrphanFinder(app, ['png']);

        await expect(finder.getReferencingNotes(image)).resolves.toEqual([
            { path: 'notes/README.md', lines: [0] },
        ]);
        expect(getFirstLinkpathDest).toHaveBeenCalledWith(
            '../assets/tencentdb/logo.png',
            'notes/README.md'
        );
    });

    it('does not resolve an explicit wrong path by filename alone', async () => {
        const image = createFile('unrelated/logo.png');
        const note = createFile('notes/README.md');
        const content = '<img src="../missing/logo.png" />';
        const app = {
            vault: {
                getFiles: () => [image, note],
                getMarkdownFiles: () => [note],
                cachedRead: vi.fn(() => Promise.resolve(content)),
            },
            metadataCache: {
                getFirstLinkpathDest: vi.fn(() => null),
            },
        } as unknown as App;
        const finder = new OrphanFinder(app, ['png']);

        await expect(finder.getReferencingNotes(image)).resolves.toEqual([]);
        await expect(finder.findOrphans()).resolves.toMatchObject({ orphans: [image] });
    });

    it('does not treat an uppercase remote URL as a local image reference', async () => {
        const image = createFile('assets/logo.png');
        const note = createFile('notes/README.md');
        const content = '<img src="HTTPS://cdn.example.com/assets/logo.png" />';
        const app = {
            vault: {
                getFiles: () => [image, note],
                getMarkdownFiles: () => [note],
                cachedRead: vi.fn(() => Promise.resolve(content)),
            },
            metadataCache: {
                getFirstLinkpathDest: vi.fn(() => null),
            },
        } as unknown as App;
        const finder = new OrphanFinder(app, ['png']);

        await expect(finder.getReferencingNotes(image)).resolves.toEqual([]);
    });
});
