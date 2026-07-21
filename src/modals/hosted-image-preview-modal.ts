import { App, MarkdownView, Modal, Notice } from 'obsidian';
import type { HostedImage } from '../types';
import { t } from '../i18n';
import { formatFileSize } from '../utils/path-utils';
import { makePublicUrlReadable } from '../utils/public-url';
import {
    getHostedImageReferencingNotes,
    type HostedImageReferencingNote,
} from '../utils/hosted-orphan-finder';
import { ConfirmDialog } from './confirm-dialog';
import { canDeleteImageFromPreview } from './image-preview-delete-visibility';

export class HostedImagePreviewModal extends Modal {
    constructor(
        app: App,
        private readonly image: HostedImage,
        private readonly onDelete?: () => Promise<void>,
        private readonly browserModal?: Modal
    ) {
        super(app);
    }

    async onOpen() {
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

        const referenceContainer = infoEl.createDiv({ cls: 'image-preview-reference-container' });
        referenceContainer.createDiv({
            cls: 'image-preview-meta',
            text: t('modal.preview.scanningReferences'),
        });
        let referenceScanSucceeded = false;
        let referencingNoteCount = 0;
        try {
            const notes = await getHostedImageReferencingNotes(this.app, this.image);
            referenceScanSucceeded = true;
            referencingNoteCount = notes.length;
            referenceContainer.empty();
            this.renderReferences(referenceContainer, notes);
        } catch (error) {
            referenceContainer.empty();
            referenceContainer.createDiv({
                cls: 'image-preview-reference-error',
                text: t('modal.preview.referenceScanFailed', {
                    error: error instanceof Error
                        ? error.message
                        : t('modal.imageBrowser.unknownError'),
                }),
            });
        }

        const buttons = contentEl.createDiv({ cls: 'image-preview-buttons' });
        const copyButton = buttons.createEl('button', {
            cls: 'mod-cta',
            text: t('modal.preview.copyRef'),
        });
        copyButton.addEventListener('click', () => void this.copyReference());

        const insertButton = buttons.createEl('button', { text: t('modal.preview.insert') });
        insertButton.addEventListener('click', () => this.insertImage());

        if (canDeleteImageFromPreview(
            referenceScanSucceeded,
            referencingNoteCount,
            this.onDelete !== undefined
        )) {
            const deleteButton = buttons.createEl('button', {
                cls: 'mod-warning',
                text: t('modal.preview.deleteHosted'),
            });
            deleteButton.addEventListener('click', () => this.confirmDelete());
        }

        const closeButton = buttons.createEl('button', { text: t('modal.preview.close') });
        closeButton.addEventListener('click', () => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }

    private buildReference(): string {
        return `![${this.image.name}](${makePublicUrlReadable(this.image.url)})`;
    }

    private renderReferences(
        containerEl: HTMLElement,
        notes: HostedImageReferencingNote[]
    ) {
        const totalRefs = notes.reduce((sum, note) => sum + note.lines.length, 0);
        const refRow = containerEl.createDiv({ cls: 'image-preview-meta' });
        refRow.createSpan({ cls: 'image-preview-label', text: t('modal.preview.references') });
        if (notes.length === 0) {
            refRow.createSpan({ cls: 'image-preview-orphan', text: t('modal.preview.orphan') });
            return;
        }

        refRow.createSpan({
            text: t('modal.preview.refCount', {
                total: String(totalRefs),
                notes: String(notes.length),
            }),
        });
        const notesList = containerEl.createDiv({ cls: 'image-preview-notes' });

        for (const note of notes) {
            const noteRow = notesList.createDiv({ cls: 'image-preview-note-item' });
            noteRow.createSpan({ cls: 'image-preview-note-path', text: note.path });
            const linesSpan = noteRow.createSpan({ cls: 'image-preview-note-lines' });
            for (const line of note.lines) {
                const lineButton = linesSpan.createEl('button', {
                    cls: 'image-preview-note-line-link',
                    text: `:${line + 1}`,
                    attr: {
                        type: 'button',
                        'aria-label': t('modal.preview.openReference', {
                            path: note.path,
                            line: String(line + 1),
                        }),
                    },
                });
                lineButton.addEventListener('click', () => {
                    this.openReference(note.path, line);
                });
            }
        }
    }

    private openReference(notePath: string, line: number) {
        this.close();
        this.browserModal?.close();
        void this.app.workspace.openLinkText(notePath, notePath, true).then(() => {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView) return;
            activeView.editor.setCursor(line);
            activeView.editor.scrollIntoView(
                { from: { line, ch: 0 }, to: { line, ch: 0 } },
                true
            );
        });
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

    private confirmDelete() {
        if (!this.onDelete) return;
        new ConfirmDialog(this.app, {
            title: t('modal.preview.deleteHostedTitle'),
            message: t('modal.preview.deleteHostedMessage', { name: this.image.name }),
            confirmText: t('modal.preview.deleteHosted'),
            onConfirm: async () => {
                try {
                    await this.onDelete?.();
                    new Notice(t('modal.preview.deleteHostedSuccess'));
                    this.close();
                } catch (error) {
                    new Notice(t('modal.preview.deleteHostedFailed', {
                        error: error instanceof Error ? error.message : t('modal.imageBrowser.unknownError'),
                    }));
                }
            },
        }).open();
    }
}
