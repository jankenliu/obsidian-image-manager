import type { Vault } from 'obsidian';

/**
 * Track folders created for a pasted image so they can be removed after the
 * local image is deleted following a successful automatic upload.
 */
export class EmptyFolderCleaner {
    private readonly createdFolders = new Set<string>();

    constructor(private readonly vault: Vault) {}

    trackCreatedFolder(path: string): void {
        if (path) this.createdFolders.add(path);
    }

    /** Permanently remove tracked empty folders, starting at the deepest path. */
    async cleanupFrom(path: string): Promise<void> {
        let current = path;

        while (current && this.createdFolders.has(current)) {
            try {
                const entries = await this.vault.adapter.list(current);
                if (entries.files.length > 0 || entries.folders.length > 0) return;

                // Non-recursive deletion is an additional race-condition guard:
                // if anything appears after list(), rmdir fails without deleting it.
                await this.vault.adapter.rmdir(current, false);
                this.createdFolders.delete(current);
                current = this.getParentPath(current);
            } catch (error) {
                console.debug(`[ImageManager] Empty folder cleanup skipped for ${current}:`, error);
                return;
            }
        }
    }

    private getParentPath(path: string): string {
        const separatorIndex = path.lastIndexOf('/');
        return separatorIndex === -1 ? '' : path.slice(0, separatorIndex);
    }
}
