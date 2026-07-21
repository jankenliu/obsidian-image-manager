import { describe, expect, it, vi } from 'vitest';
import type { App, TAbstractFile } from 'obsidian';

vi.mock('obsidian', () => {
    class MockTFolder {
        path: string;
        parent: MockTFolder | null = null;
        children: unknown[] = [];

        constructor(path = '') {
            this.path = path;
        }
    }

    return { TFolder: MockTFolder };
});

import { TFolder } from 'obsidian';
import { trashEmptyDirectories } from '../src/utils/empty-directory-cleanup';

function createFolder(path: string, parent: TFolder | null): TFolder {
    const folder = new TFolder();
    folder.path = path;
    folder.parent = parent;
    parent?.children.push(folder);
    return folder;
}

function createApp(folders: TFolder[], onTrash?: (folder: TFolder) => void) {
    const byPath = new Map(folders.map((folder) => [folder.path, folder]));
    const trashFile = vi.fn(async (folder: TFolder) => onTrash?.(folder));

    return {
        app: {
            vault: {
                getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
            },
            fileManager: { trashFile },
        } as unknown as App,
        trashFile,
    };
}

describe('Empty directory cleanup', () => {
    it('trashes empty affected directories from deepest to shallowest without trashing the vault root', async () => {
        const root = createFolder('', null);
        const attachments = createFolder('attachments', root);
        const nested = createFolder('attachments/2026', attachments);
        const { app, trashFile } = createApp([root, attachments, nested], (folder) => {
            folder.parent!.children = folder.parent!.children.filter((child) => child !== folder);
        });

        const result = await trashEmptyDirectories(app, ['attachments/2026']);

        expect(result).toEqual({ trashed: ['attachments/2026', 'attachments'], failed: 0 });
        expect(trashFile).toHaveBeenNthCalledWith(1, nested);
        expect(trashFile).toHaveBeenNthCalledWith(2, attachments);
        expect(trashFile).not.toHaveBeenCalledWith(root);
    });

    it('leaves directories that contain files or child items untouched', async () => {
        const root = createFolder('', null);
        const withFile = createFolder('with-file', root);
        withFile.children.push({ path: 'with-file/photo.png' } as unknown as TAbstractFile);
        const withChild = createFolder('with-child', root);
        createFolder('with-child/nested', withChild);
        const { app, trashFile } = createApp([root, withFile, withChild]);

        const result = await trashEmptyDirectories(app, ['with-file', 'with-child']);

        expect(result).toEqual({ trashed: [], failed: 0 });
        expect(trashFile).not.toHaveBeenCalled();
    });

    it('continues cleaning other directories after one directory cannot be moved to trash', async () => {
        const root = createFolder('', null);
        const failing = createFolder('failing', root);
        const successful = createFolder('successful', root);
        const { app, trashFile } = createApp([root, failing, successful]);
        trashFile.mockImplementation(async (folder) => {
            if (folder === failing) throw new Error('Trash is unavailable');
        });

        const result = await trashEmptyDirectories(app, ['failing', 'successful']);

        expect(result).toEqual({ trashed: ['successful'], failed: 1 });
        expect(trashFile).toHaveBeenCalledWith(failing);
        expect(trashFile).toHaveBeenCalledWith(successful);
    });
});
