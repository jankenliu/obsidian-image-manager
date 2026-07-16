export type ImageBrowserBatchSource = 'local' | 'hosting';

export interface BatchDeleteFailure<T> {
    item: T;
    error: unknown;
}

export interface BatchDeleteResult<T> {
    deleted: T[];
    failed: BatchDeleteFailure<T>[];
}

/** Keep local and hosted selections independent while the user switches browser sources. */
export class ImageBrowserBatchSelection {
    private readonly selections = new Map<ImageBrowserBatchSource, Set<string>>();

    isSelected(source: ImageBrowserBatchSource, key: string): boolean {
        return this.getSelection(source).has(key);
    }

    setSelected(source: ImageBrowserBatchSource, key: string, selected: boolean): void {
        const selection = this.getSelection(source);
        if (selected) selection.add(key);
        else selection.delete(key);
    }

    selectAll(source: ImageBrowserBatchSource, keys: Iterable<string>): void {
        const selection = this.getSelection(source);
        for (const key of keys) selection.add(key);
    }

    clear(source: ImageBrowserBatchSource): void {
        this.getSelection(source).clear();
    }

    remove(source: ImageBrowserBatchSource, keys: Iterable<string>): void {
        const selection = this.getSelection(source);
        for (const key of keys) selection.delete(key);
    }

    retain(source: ImageBrowserBatchSource, validKeys: Iterable<string>): void {
        const valid = new Set(validKeys);
        const selection = this.getSelection(source);
        for (const key of selection) {
            if (!valid.has(key)) selection.delete(key);
        }
    }

    getKeys(source: ImageBrowserBatchSource): string[] {
        return Array.from(this.getSelection(source));
    }

    getCount(source: ImageBrowserBatchSource): number {
        return this.getSelection(source).size;
    }

    private getSelection(source: ImageBrowserBatchSource): Set<string> {
        let selection = this.selections.get(source);
        if (!selection) {
            selection = new Set<string>();
            this.selections.set(source, selection);
        }
        return selection;
    }
}

/** Delete every selected item and report partial failures without aborting the remaining work. */
export async function deleteBatchItems<T>(
    items: T[],
    deleteItem: (item: T) => Promise<void>
): Promise<BatchDeleteResult<T>> {
    const result: BatchDeleteResult<T> = { deleted: [], failed: [] };
    for (const item of items) {
        try {
            await deleteItem(item);
            result.deleted.push(item);
        } catch (error) {
            result.failed.push({ item, error });
        }
    }
    return result;
}
