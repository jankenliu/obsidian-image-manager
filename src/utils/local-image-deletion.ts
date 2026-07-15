import type { App, TFile } from 'obsidian';

/** Move a local image to the configured trash destination, then notify the caller. */
export async function trashLocalImage(
    app: App,
    file: TFile,
    onDeleted?: (file: TFile) => void
): Promise<void> {
    await app.fileManager.trashFile(file);
    onDeleted?.(file);
}
