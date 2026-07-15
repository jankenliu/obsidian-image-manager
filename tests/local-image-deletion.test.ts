import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';

vi.mock('obsidian', () => ({
    TFile: class {
        path = 'images/photo.png';
        name = 'photo.png';
    },
}));

import { TFile } from 'obsidian';
import { trashLocalImage } from '../src/utils/local-image-deletion';

function createFile(): TFile {
    return new TFile();
}

describe('Local image deletion', () => {
    it('uses the Obsidian trash preference and notifies the browser after success', async () => {
        const trashFile = vi.fn(() => Promise.resolve());
        const app = { fileManager: { trashFile } } as unknown as App;
        const file = createFile();
        const onDeleted = vi.fn();

        await trashLocalImage(app, file, onDeleted);

        expect(trashFile).toHaveBeenCalledWith(file);
        expect(onDeleted).toHaveBeenCalledWith(file);
    });

    it('does not notify the browser when moving the file to trash fails', async () => {
        const error = new Error('Trash is unavailable');
        const trashFile = vi.fn(() => Promise.reject(error));
        const app = { fileManager: { trashFile } } as unknown as App;
        const onDeleted = vi.fn();

        await expect(trashLocalImage(app, createFile(), onDeleted)).rejects.toBe(error);
        expect(onDeleted).not.toHaveBeenCalled();
    });
});
