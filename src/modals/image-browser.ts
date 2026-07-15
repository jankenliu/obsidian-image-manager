import { App, Modal, Notice, TFile } from 'obsidian';
import type ImageManagerPlugin from '../main';
import type { HostedImage, ImageHostingConfig } from '../types';
import { ImageScanner } from '../utils/image-scanner';
import { OrphanFinder } from '../utils/orphan-finder';
import { findOrphanHostedImages } from '../utils/hosted-orphan-finder';
import { formatFileSize } from '../utils/path-utils';
import { createUploader } from '../uploaders/uploader-factory';
import { t } from '../i18n';
import { HostedImagePreviewModal } from './hosted-image-preview-modal';
import { ImagePreviewModal } from './image-preview-modal';

type BrowserSource = 'local' | 'hosting';
type BrowserSort = 'name' | 'size' | 'modified' | 'created';

export class ImageBrowserModal extends Modal {
    private plugin: ImageManagerPlugin;
    private scanner: ImageScanner;
    private allImages: TFile[] = [];
    private filteredImages: TFile[] = [];
    private hostedImages: HostedImage[] = [];
    private filteredHostedImages: HostedImage[] = [];
    private orphanPaths: Set<string> | null = null;
    private hostedOrphanKeys: Set<string> | null = null;
    private gridEl: HTMLDivElement | null = null;
    private countEl: HTMLSpanElement | null = null;
    private searchInput: HTMLInputElement | null = null;
    private sortSelect: HTMLSelectElement | null = null;
    private orphanBtn: HTMLButtonElement | null = null;
    private hostingSelect: HTMLSelectElement | null = null;
    private localBtn: HTMLButtonElement | null = null;
    private hostingBtn: HTMLButtonElement | null = null;
    private source: BrowserSource = 'local';
    private showLocalOrphansOnly = false;
    private showHostedOrphansOnly = false;
    private debounceTimer: number | null = null;
    private loadSequence = 0;
    private loadingHosting = false;
    private hostingError = '';

    constructor(app: App, plugin: ImageManagerPlugin) {
        super(app);
        this.plugin = plugin;
        this.scanner = new ImageScanner(app, plugin.settings.supportedExtensions);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('image-browser');

        const header = contentEl.createDiv({ cls: 'image-browser-header' });
        header.createEl('h2', { text: t('modal.imageBrowser.title'), cls: 'image-browser-title' });
        const sourceSwitch = header.createDiv({ cls: 'image-browser-source-switch' });
        this.localBtn = sourceSwitch.createEl('button', {
            cls: 'image-browser-source-btn is-active',
            text: t('modal.imageBrowser.local'),
        });
        this.hostingBtn = sourceSwitch.createEl('button', {
            cls: 'image-browser-source-btn',
            text: t('modal.imageBrowser.hosting'),
        });
        this.localBtn.addEventListener('click', () => this.switchSource('local'));
        this.hostingBtn.addEventListener('click', () => this.switchSource('hosting'));

        const controls = contentEl.createDiv({ cls: 'image-browser-controls' });
        this.searchInput = controls.createEl('input', {
            cls: 'image-browser-search',
            attr: {
                type: 'text',
                placeholder: t('modal.imageBrowser.searchPlaceholder'),
            },
        });
        this.searchInput.addEventListener('input', () => this.onSearchInput());

        this.hostingSelect = controls.createEl('select', {
            cls: 'image-browser-hosting-select image-browser-hidden',
            attr: { 'aria-label': t('modal.imageBrowser.hostingSelect') },
        });
        this.populateHostingSelect();
        this.hostingSelect.addEventListener('change', () => void this.loadHostedImages());

        this.sortSelect = controls.createEl('select', { cls: 'image-browser-sort' });
        const sortOptions: Array<{ value: BrowserSort; labelKey: string }> = [
            { value: 'name', labelKey: 'modal.imageBrowser.sortName' },
            { value: 'modified', labelKey: 'modal.imageBrowser.sortModified' },
            { value: 'size', labelKey: 'modal.imageBrowser.sortSize' },
            { value: 'created', labelKey: 'modal.imageBrowser.sortCreated' },
        ];
        for (const opt of sortOptions) {
            this.sortSelect.createEl('option', { value: opt.value, text: t(opt.labelKey) });
        }
        this.sortSelect.addEventListener('change', () => this.applyFilterAndSort());

        this.orphanBtn = controls.createEl('button', {
            cls: 'image-browser-orphan-btn',
            text: t('modal.imageBrowser.orphanFilter'),
        });
        this.orphanBtn.addEventListener('click', () => void this.toggleOrphanFilter());

        this.countEl = controls.createEl('span', { cls: 'image-browser-count' });
        this.gridEl = contentEl.createDiv({ cls: 'image-browser-grid' });
        this.loadLocalImages();
    }

    onClose() {
        this.loadSequence++;
        if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
        this.contentEl.empty();
    }

    private populateHostingSelect() {
        if (!this.hostingSelect) return;
        this.hostingSelect.empty();
        const configs = this.getEnabledHostingConfigs();
        for (const config of configs) {
            this.hostingSelect.createEl('option', {
                value: config.id,
                text: config.name,
            });
        }

        const preferredId = this.plugin.settings.defaultHostingId;
        if (preferredId && configs.some((config) => config.id === preferredId)) {
            this.hostingSelect.value = preferredId;
        }
    }

    private getEnabledHostingConfigs(): ImageHostingConfig[] {
        return this.plugin.settings.hostingConfigs.filter((config) => config.enabled);
    }

    private switchSource(source: BrowserSource) {
        if (source === this.source) return;
        this.source = source;
        this.localBtn?.toggleClass('is-active', source === 'local');
        this.hostingBtn?.toggleClass('is-active', source === 'hosting');
        this.hostingSelect?.toggleClass('image-browser-hidden', source !== 'hosting');
        this.updateOrphanButton();
        this.sortSelect?.querySelector<HTMLOptionElement>('option[value="created"]')
            ?.toggleClass('image-browser-hidden', source === 'hosting');

        if (source === 'local') {
            this.loadingHosting = false;
            this.loadSequence++;
            this.applyFilterAndSort();
        } else {
            if (this.sortSelect?.value === 'created') this.sortSelect.value = 'name';
            void this.loadHostedImages();
        }
    }

    private loadLocalImages() {
        this.allImages = this.scanner.getAllImages();
        this.applyFilterAndSort();
    }

    private async loadHostedImages() {
        const requestSequence = ++this.loadSequence;
        const config = this.getEnabledHostingConfigs().find(
            (item) => item.id === this.hostingSelect?.value
        );
        this.hostedImages = [];
        this.hostedOrphanKeys = null;
        this.hostingError = '';

        if (!config) {
            this.loadingHosting = false;
            this.hostingError = t('modal.imageBrowser.noHosting');
            this.applyFilterAndSort();
            return;
        }

        const uploader = createUploader(config, this.plugin.settings.uploadPathTemplate);
        if (!uploader.supportsListing) {
            this.loadingHosting = false;
            this.hostingError = t('modal.imageBrowser.listUnsupported');
            this.applyFilterAndSort();
            return;
        }

        this.loadingHosting = true;
        this.updateOrphanButton();
        this.applyFilterAndSort();
        try {
            const images = await uploader.listImages();
            if (requestSequence !== this.loadSequence || this.source !== 'hosting') return;
            this.hostedImages = images.filter((image) => this.isSupportedImage(image.name));
            if (this.showHostedOrphansOnly) {
                const orphans = await findOrphanHostedImages(this.app, this.hostedImages);
                if (requestSequence !== this.loadSequence || this.source !== 'hosting') return;
                this.hostedOrphanKeys = new Set(orphans.map((image) => image.key));
            }
        } catch (error) {
            if (requestSequence !== this.loadSequence || this.source !== 'hosting') return;
            this.hostingError = t('modal.imageBrowser.loadFailed', {
                error: error instanceof Error ? error.message : t('modal.imageBrowser.unknownError'),
            });
        } finally {
            if (requestSequence === this.loadSequence && this.source === 'hosting') {
                this.loadingHosting = false;
                this.updateOrphanButton();
                this.applyFilterAndSort();
            }
        }
    }

    private isSupportedImage(name: string): boolean {
        const extension = name.split('.').pop()?.toLowerCase();
        return extension !== undefined && this.plugin.settings.supportedExtensions.includes(extension);
    }

    private onSearchInput() {
        if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
        this.debounceTimer = window.setTimeout(() => this.applyFilterAndSort(), 300);
    }

    private async toggleOrphanFilter() {
        if (this.source === 'hosting') {
            await this.toggleHostedOrphanFilter();
            return;
        }

        this.showLocalOrphansOnly = !this.showLocalOrphansOnly;
        this.updateOrphanButton();

        if (this.showLocalOrphansOnly) {
            new Notice(t('modal.imageBrowser.orphanScanning'));
            const finder = new OrphanFinder(this.app, this.plugin.settings.supportedExtensions);
            const result = await finder.findOrphans();
            this.orphanPaths = new Set(result.orphans.map((file) => file.path));
        } else {
            this.orphanPaths = null;
        }

        this.applyFilterAndSort();
    }

    private async toggleHostedOrphanFilter() {
        this.showHostedOrphansOnly = !this.showHostedOrphansOnly;
        this.updateOrphanButton();
        if (this.showHostedOrphansOnly) {
            new Notice(t('modal.imageBrowser.hostedOrphanScanning'));
            const orphans = await findOrphanHostedImages(this.app, this.hostedImages);
            if (this.source !== 'hosting' || !this.showHostedOrphansOnly) return;
            this.hostedOrphanKeys = new Set(orphans.map((image) => image.key));
        } else {
            this.hostedOrphanKeys = null;
        }
        this.applyFilterAndSort();
    }

    private updateOrphanButton() {
        if (!this.orphanBtn) return;
        const isActive = this.source === 'local'
            ? this.showLocalOrphansOnly
            : this.showHostedOrphansOnly;
        this.orphanBtn.toggleClass('is-active', isActive);
        this.orphanBtn.disabled = this.source === 'hosting' && this.loadingHosting;
    }

    private applyFilterAndSort() {
        if (this.source === 'hosting') {
            this.applyHostedFilterAndSort();
            return;
        }

        const keyword = this.searchInput?.value ?? '';
        let images = this.scanner.filterImages(this.allImages, { keyword });
        if (this.showLocalOrphansOnly && this.orphanPaths) {
            images = images.filter((file) => this.orphanPaths!.has(file.path));
        }

        const sortBy = (this.sortSelect?.value ?? 'name') as BrowserSort;
        this.filteredImages = this.scanner.sortImages(images, sortBy, 'asc');
        this.renderGrid();
    }

    private applyHostedFilterAndSort() {
        const keyword = (this.searchInput?.value ?? '').trim().toLowerCase();
        this.filteredHostedImages = this.hostedImages.filter((image) =>
            (!keyword || image.key.toLowerCase().includes(keyword))
            && (!this.showHostedOrphansOnly || this.hostedOrphanKeys?.has(image.key))
        );
        const sortBy = (this.sortSelect?.value ?? 'name') as BrowserSort;
        this.filteredHostedImages.sort((left, right) => {
            if (sortBy === 'size') return left.size - right.size;
            if (sortBy === 'modified') return left.modified - right.modified;
            return left.name.localeCompare(right.name);
        });
        this.renderGrid();
    }

    private renderGrid() {
        if (!this.gridEl) return;
        this.gridEl.empty();
        if (this.source === 'hosting') {
            this.renderHostedGrid();
        } else {
            this.renderLocalGrid();
        }
    }

    private renderLocalGrid() {
        if (!this.gridEl) return;
        this.updateCount(this.filteredImages.length, this.allImages.length);
        if (this.filteredImages.length === 0) {
            this.renderEmpty(t('modal.imageBrowser.noImages'));
            return;
        }

        for (const file of this.filteredImages) {
            const card = this.createCard(file.name, file.path, file.stat.size);
            const img = card.imageContainer.createEl('img', {
                attr: { src: this.app.vault.getResourcePath(file) },
            });
            const thumbSize = String(this.plugin.settings.thumbnailSize);
            img.setAttribute('width', thumbSize);
            img.setAttribute('height', thumbSize);
            card.cardEl.addEventListener('click', () => {
                new ImagePreviewModal(this.app, this.plugin, file, this).open();
            });
        }
    }

    private renderHostedGrid() {
        if (!this.gridEl) return;
        this.updateCount(this.filteredHostedImages.length, this.hostedImages.length);
        if (this.loadingHosting) {
            this.renderEmpty(t('modal.imageBrowser.loadingHosting'));
            return;
        }
        if (this.hostingError) {
            this.renderEmpty(this.hostingError);
            return;
        }
        if (this.filteredHostedImages.length === 0) {
            this.renderEmpty(this.showHostedOrphansOnly
                ? t('modal.imageBrowser.noHostedOrphans')
                : t('modal.imageBrowser.noHostedImages'));
            return;
        }

        const config = this.getSelectedHostingConfig();
        const uploader = config
            ? createUploader(config, this.plugin.settings.uploadPathTemplate)
            : null;
        for (const image of this.filteredHostedImages) {
            const card = this.createCard(image.name, image.key, image.size);
            const img = card.imageContainer.createEl('img', { attr: { src: image.url } });
            const thumbSize = String(this.plugin.settings.thumbnailSize);
            img.setAttribute('width', thumbSize);
            img.setAttribute('height', thumbSize);
            card.cardEl.addEventListener('click', () => {
                new HostedImagePreviewModal(
                    this.app,
                    image,
                    uploader?.supportsDeletion && config
                        ? () => this.deleteHostedImage(image, config)
                        : undefined
                ).open();
            });
        }
    }

    private getSelectedHostingConfig(): ImageHostingConfig | null {
        return this.getEnabledHostingConfigs().find(
            (config) => config.id === this.hostingSelect?.value
        ) ?? null;
    }

    private async deleteHostedImage(image: HostedImage, config: ImageHostingConfig) {
        const uploader = createUploader(config, this.plugin.settings.uploadPathTemplate);
        await uploader.deleteImage(image.key);
        this.hostedImages = this.hostedImages.filter((item) => item.key !== image.key);
        this.hostedOrphanKeys?.delete(image.key);
        this.applyFilterAndSort();
    }

    private createCard(name: string, path: string, size: number): {
        cardEl: HTMLDivElement;
        imageContainer: HTMLDivElement;
    } {
        const cardEl = this.gridEl!.createDiv({ cls: 'image-browser-card' });
        cardEl.setAttribute('title', `${path}\n${t('modal.imageBrowser.insertTooltip')}`);
        const imageContainer = cardEl.createDiv({ cls: 'image-browser-card-img' });
        const nameEl = cardEl.createDiv({ cls: 'image-browser-card-name', text: name });
        nameEl.setAttribute('title', name);
        cardEl.createDiv({ cls: 'image-browser-card-meta', text: formatFileSize(size) });
        return { cardEl, imageContainer };
    }

    private updateCount(count: number, total: number) {
        if (!this.countEl) return;
        this.countEl.textContent = t('modal.imageBrowser.showing', {
            count: String(count),
            total: String(total),
        });
    }

    private renderEmpty(message: string) {
        this.gridEl?.createDiv({ cls: 'image-browser-empty', text: message });
    }
}
