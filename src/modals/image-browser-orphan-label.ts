/** Return the orphan badge text only after the item is known to be orphaned. */
export function getOrphanBadgeLabel<T>(
    item: T,
    getKey: (item: T) => string,
    orphanKeys: ReadonlySet<string> | null,
    label: string
): string | null {
    return orphanKeys?.has(getKey(item)) ? label : null;
}
