/** Allow destructive image actions only after a successful scan confirms no references. */
export function canDeleteImageFromPreview(
    referenceScanSucceeded: boolean,
    referencingNoteCount: number,
    deletionSupported = true
): boolean {
    return referenceScanSucceeded && referencingNoteCount === 0 && deletionSupported;
}
