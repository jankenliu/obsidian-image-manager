import { TFolder } from 'obsidian';
import type { App } from 'obsidian';

export interface EmptyDirectoryCleanupResult {
    trashed: string[];
    failed: number;
}

/** Move empty affected directories and their empty ancestors to the configured trash destination. */
export async function trashEmptyDirectories(
    app: App,
    affectedParentPaths: readonly string[]
): Promise<EmptyDirectoryCleanupResult> {
    const folders = new Map<string, TFolder>();

    for (const path of affectedParentPaths) {
        const abstractFile = app.vault.getAbstractFileByPath(path);
        if (!(abstractFile instanceof TFolder)) continue;

        let folder: TFolder | null = abstractFile;
        while (folder && folder.path) {
            folders.set(folder.path, folder);
            folder = folder.parent instanceof TFolder ? folder.parent : null;
        }
    }

    const orderedFolders = [...folders.values()].sort((a, b) => {
        const depthDifference = b.path.split('/').length - a.path.split('/').length;
        return depthDifference || a.path.localeCompare(b.path);
    });
    const result: EmptyDirectoryCleanupResult = { trashed: [], failed: 0 };

    for (const folder of orderedFolders) {
        if (!folder.path || folder.children.length > 0) continue;

        try {
            await app.fileManager.trashFile(folder);
            result.trashed.push(folder.path);
        } catch {
            result.failed++;
        }
    }

    return result;
}
