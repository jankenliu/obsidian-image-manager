import { describe, expect, it, vi } from 'vitest';
import type { Vault } from 'obsidian';
import { EmptyFolderCleaner } from '../src/utils/empty-folder-cleaner';

interface FolderEntries {
    files: string[];
    folders: string[];
}

function createVault(entries: Map<string, FolderEntries>): {
    vault: Vault;
    list: ReturnType<typeof vi.fn>;
    rmdir: ReturnType<typeof vi.fn>;
} {
    const list = vi.fn((path: string) => Promise.resolve(entries.get(path) ?? {
        files: [],
        folders: [],
    }));
    const rmdir = vi.fn((path: string) => {
        entries.delete(path);
        return Promise.resolve();
    });
    const vault = { adapter: { list, rmdir } } as unknown as Vault;
    return { vault, list, rmdir };
}

describe('EmptyFolderCleaner', () => {
    it('permanently removes tracked empty folders from deepest to shallowest', async () => {
        const entries = new Map<string, FolderEntries>([
            ['notes/[noteName}', { files: [], folders: [] }],
            ['notes', { files: ['notes/article.md'], folders: ['notes/[noteName}'] }],
        ]);
        const { vault, rmdir } = createVault(entries);
        const cleaner = new EmptyFolderCleaner(vault);
        cleaner.trackCreatedFolder('notes/[noteName}');

        await cleaner.cleanupFrom('notes/[noteName}');

        expect(rmdir).toHaveBeenCalledOnce();
        expect(rmdir).toHaveBeenCalledWith('notes/[noteName}', false);
    });

    it('does not delete an existing parent folder that was not created by the paste flow', async () => {
        const entries = new Map<string, FolderEntries>([
            ['notes/images/nested', { files: [], folders: [] }],
            ['notes/images', { files: [], folders: [] }],
        ]);
        const { vault, rmdir } = createVault(entries);
        const cleaner = new EmptyFolderCleaner(vault);
        cleaner.trackCreatedFolder('notes/images/nested');

        await cleaner.cleanupFrom('notes/images/nested');

        expect(rmdir).toHaveBeenCalledTimes(1);
        expect(rmdir).not.toHaveBeenCalledWith('notes/images', false);
    });

    it('keeps a tracked folder when it still contains another pasted image', async () => {
        const entries = new Map<string, FolderEntries>([
            ['notes/images', { files: ['notes/images/second.png'], folders: [] }],
        ]);
        const { vault, rmdir } = createVault(entries);
        const cleaner = new EmptyFolderCleaner(vault);
        cleaner.trackCreatedFolder('notes/images');

        await cleaner.cleanupFrom('notes/images');

        expect(rmdir).not.toHaveBeenCalled();
    });

    it('removes a shared tracked folder after the last pasted image is gone', async () => {
        const entries = new Map<string, FolderEntries>([
            ['notes/images', { files: ['notes/images/second.png'], folders: [] }],
        ]);
        const { vault, rmdir } = createVault(entries);
        const cleaner = new EmptyFolderCleaner(vault);
        cleaner.trackCreatedFolder('notes/images');

        await cleaner.cleanupFrom('notes/images');
        entries.set('notes/images', { files: [], folders: [] });
        await cleaner.cleanupFrom('notes/images');

        expect(rmdir).toHaveBeenCalledOnce();
        expect(rmdir).toHaveBeenCalledWith('notes/images', false);
    });

    it('keeps a folder when a file appears before non-recursive deletion', async () => {
        const list = vi.fn(() => Promise.resolve({ files: [], folders: [] }));
        const rmdir = vi.fn(() => Promise.reject(new Error('Directory is not empty')));
        const vault = { adapter: { list, rmdir } } as unknown as Vault;
        const cleaner = new EmptyFolderCleaner(vault);
        cleaner.trackCreatedFolder('notes/images');

        await expect(cleaner.cleanupFrom('notes/images')).resolves.toBeUndefined();
        expect(rmdir).toHaveBeenCalledWith('notes/images', false);
    });
});
