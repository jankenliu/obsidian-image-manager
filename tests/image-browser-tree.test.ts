import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ setIcon: vi.fn() }));

import { buildImageTree } from '../src/modals/image-browser-tree';

interface TestImage {
    path: string;
}

describe('Image browser tree', () => {
    it('groups local and hosted paths into nested folders', () => {
        const images: TestImage[] = [
            { path: 'root.png' },
            { path: 'notes/blog/cover.png' },
            { path: 'notes/avatar.png' },
            { path: 'assets/photo.jpg' },
        ];

        const tree = buildImageTree(images, (image) => image.path);

        expect(tree.items).toEqual([{ path: 'root.png' }]);
        expect(tree.folders.map((folder) => folder.name)).toEqual(['assets', 'notes']);
        expect(tree.itemCount).toBe(4);
        const notes = tree.folders[1]!;
        expect(notes.itemCount).toBe(2);
        expect(notes.items).toEqual([{ path: 'notes/avatar.png' }]);
        expect(notes.folders[0]).toMatchObject({
            name: 'blog',
            path: 'notes/blog',
            itemCount: 1,
        });
    });

    it('preserves item order within each folder while sorting folders by name', () => {
        const images: TestImage[] = [
            { path: 'z-folder/large.png' },
            { path: 'a-folder/only.png' },
            { path: 'z-folder/small.png' },
        ];

        const tree = buildImageTree(images, (image) => image.path);

        expect(tree.folders.map((folder) => folder.name)).toEqual(['a-folder', 'z-folder']);
        expect(tree.folders[1]!.items.map((image) => image.path)).toEqual([
            'z-folder/large.png',
            'z-folder/small.png',
        ]);
    });

    it('ignores duplicate and leading path separators', () => {
        const tree = buildImageTree(
            [{ path: '/images//nested/photo.png' }],
            (image) => image.path
        );

        expect(tree.folders[0]).toMatchObject({ name: 'images', path: 'images' });
        expect(tree.folders[0]!.folders[0]).toMatchObject({
            name: 'nested',
            path: 'images/nested',
            itemCount: 1,
        });
    });
});
