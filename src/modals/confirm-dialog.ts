import { App, Modal } from 'obsidian';
import { t } from '../i18n';

export interface ConfirmDialogOptions {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    processingText?: string;
    lockWhileConfirming?: boolean;
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
}

export class ConfirmDialog extends Modal {
    private options: ConfirmDialogOptions;
    private keyHandler: (e: KeyboardEvent) => void;
    private processing = false;
    private confirmBtn: HTMLButtonElement | null = null;
    private cancelBtn: HTMLButtonElement | null = null;

    constructor(app: App, options: ConfirmDialogOptions) {
        super(app);
        this.options = options;

        this.keyHandler = (e: KeyboardEvent) => {
            if (e.isComposing) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                void this.handleConfirm();
            }
        };
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('confirm-dialog');

        contentEl.createEl('h2', { text: this.options.title });

        contentEl.createEl('p', {
            text: this.options.message,
            cls: 'confirm-dialog-message',
        });

        const buttonContainer = contentEl.createDiv({ cls: 'confirm-dialog-buttons' });

        this.cancelBtn = buttonContainer.createEl('button', {
            text: this.options.cancelText ?? t('modal.confirm.cancel'),
        });
        this.cancelBtn.addEventListener('click', () => {
            this.options.onCancel?.();
            this.close();
        });

        this.confirmBtn = buttonContainer.createEl('button', {
            text: this.options.confirmText ?? t('modal.confirm.ok'),
            cls: 'mod-cta',
        });
        this.confirmBtn.addEventListener('click', () => void this.handleConfirm());

        activeDocument.addEventListener('keydown', this.keyHandler);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        activeDocument.removeEventListener('keydown', this.keyHandler);
    }

    private async handleConfirm() {
        if (this.processing) return;
        this.processing = true;
        if (this.options.lockWhileConfirming) {
            if (this.confirmBtn) {
                this.confirmBtn.disabled = true;
                this.confirmBtn.setText(this.options.processingText ?? t('modal.confirm.processing'));
            }
            this.cancelBtn?.addClass('confirm-dialog-hidden');
        }
        try {
            await this.options.onConfirm();
            this.close();
        } catch (error) {
            if (this.options.lockWhileConfirming) {
                if (this.confirmBtn) {
                    this.confirmBtn.disabled = false;
                    this.confirmBtn.setText(this.options.confirmText ?? t('modal.confirm.ok'));
                }
                this.cancelBtn?.removeClass('confirm-dialog-hidden');
            }
            throw error;
        } finally {
            this.processing = false;
        }
    }
}
