import { App, Modal, Notice } from 'obsidian';
import type { HostedImage } from '../types';
import { t } from '../i18n';
import { formatFileSize } from '../utils/path-utils';
import { makePublicUrlReadable } from '../utils/public-url';

export class HostedImagePreviewModal extends Modal {
    constructor(app: App, private readonly image: HostedImage) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('image-preview');
        contentEl.createEl('img', {
            cls: 'image-preview-img',
            attr: { src: this.image.url },
        });

        const infoEl = contentEl.createDiv({ cls: 'image-preview-info' });
        const pathRow = infoEl.createDiv({ cls: 'image-preview-path' });
        pathRow.createSpan({ cls: 'image-preview-label', text: t('modal.preview.path') });
        pathRow.createSpan({ text: this.image.key });

        const sizeRow = infoEl.createDiv({ cls: 'image-preview-meta' });
        sizeRow.createSpan({ cls: 'image-preview-label', text: t('modal.preview.size') });
        sizeRow.createSpan({ text: formatFileSize(this.image.size) });

        const buttons = contentEl.createDiv({ cls: 'image-preview-buttons' });
        const copyButton = buttons.createEl('button', {
            cls: 'mod-cta',
            text: t('modal.preview.copyRef'),
        });
        copyButton.addEventListener('click', () => void this.copyReference());

        const insertButton = buttons.createEl('button', { text: t('modal.preview.insert') });
        insertButton.addEventListener('click', () => this.insertImage());

        const closeButton = buttons.createEl('button', { text: t('modal.preview.close') });
        closeButton.addEventListener('click', () => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }

    private buildReference(): string {
        return `![${this.image.name}](${makePublicUrlReadable(this.image.url)})`;
    }

    private async copyReference() {
        await navigator.clipboard.writeText(this.buildReference());
        new Notice(t('notice.refCopied'));
    }

    private insertImage() {
        const editor = this.app.workspace.activeEditor?.editor;
        if (!editor) {
            new Notice(t('notice.noActiveEditor'));
            return;
        }
        editor.replaceSelection(this.buildReference());
        new Notice(t('notice.imageInserted'));
        this.close();
    }
}
