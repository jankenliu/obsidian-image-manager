export type ImageBrowserVaultActionSource = 'local' | 'hosting';

/** Keep vault-wide actions local-only and prevent concurrent execution. */
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
