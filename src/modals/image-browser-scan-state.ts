export type ImageBrowserScanSource = 'local' | 'hosting';

export const MINIMUM_SCAN_FEEDBACK_MS = 400;

/** Calculate how long scan feedback should remain visible without delaying slow scans. */
export function getRemainingScanFeedbackDuration(
    startedAt: number,
    currentTime: number,
    minimumDuration = MINIMUM_SCAN_FEEDBACK_MS
): number {
    return Math.max(0, minimumDuration - (currentTime - startedAt));
}

/** Track the latest orphan scan so stale asynchronous results can be ignored. */
export class ImageBrowserScanState {
    private sequence = 0;
    private activeSource: ImageBrowserScanSource | null = null;

    start(source: ImageBrowserScanSource): number {
        this.activeSource = source;
        return ++this.sequence;
    }

    isCurrent(token: number, source: ImageBrowserScanSource): boolean {
        return token === this.sequence && this.activeSource === source;
    }

    finish(token: number, source: ImageBrowserScanSource): boolean {
        if (!this.isCurrent(token, source)) return false;
        this.activeSource = null;
        return true;
    }

    cancel(): void {
        this.sequence++;
        this.activeSource = null;
    }

    isScanning(source: ImageBrowserScanSource): boolean {
        return this.activeSource === source;
    }
}
