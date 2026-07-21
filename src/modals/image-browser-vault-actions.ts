export type ImageBrowserVaultActionSource = 'local' | 'hosting';

/** Keep actions local-only and prevent duplicate clicks within this modal. */
export class ImageBrowserVaultActionState {
    private running = false;

    isVisible(source: ImageBrowserVaultActionSource): boolean {
        return source === 'local';
    }

    isRunning(): boolean {
        return this.running;
    }

    start(): boolean {
        if (this.running) return false;
        this.running = true;
        return true;
    }

    finish(): void {
        this.running = false;
    }
}
