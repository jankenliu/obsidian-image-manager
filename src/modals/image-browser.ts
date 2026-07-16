import { App, Modal, TFile } from 'obsidian';
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
import { renderImageTree } from './image-browser-tree';
import {
    getRemainingScanFeedbackDuration,
    ImageBrowserScanState,
} from './image-browser-scan-state';

type BrowserSource = 'local' | 'hosting';
type BrowserSort = 'name' | 'size' | 'modified' | 'created';
type BrowserView = 'grid' | 'tree';

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
    private orphanStatusEl: HTMLDivElement | null = null;
    private hostingSelect: HTMLSelectElement | null = null;
    private localBtn: HTMLButtonElement | null = null;
    private hostingBtn: HTMLButtonElement | null = null;
    private gridViewBtn: HTMLButtonElement | null = null;
    private treeViewBtn: HTMLButtonElement | null = null;
    private source: BrowserSource = 'local';
    private view: BrowserView = 'grid';
    private readonly localExpandedPaths = new Set<string>();
    private readonly hostingExpandedPaths = new Map<string, Set<string>>();
    private localTreeInitialized = false;
    private readonly initializedHostingTrees = new Set<string>();
    private readonly orphanScanState = new ImageBrowserScanState();
    private showLocalOrphansOnly = false;
    private showHostedOrphansOnly = false;
    private localOrphanError = '';
    private hostedOrphanError = '';
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

        const viewSwitch = controls.createDiv({ cls: 'image-browser-view-switch' });
        this.gridViewBtn = viewSwitch.createEl('button', {
            cls: 'image-browser-view-btn is-active',
            text: t('modal.imageBrowser.gridView'),
        });
        this.treeViewBtn = viewSwitch.createEl('button', {
            cls: 'image-browser-view-btn',
            text: t('modal.imageBrowser.treeView'),
        });
        this.gridViewBtn.setAttribute('aria-pressed', 'true');
        this.treeViewBtn.setAttribute('aria-pressed', 'false');
        this.gridViewBtn.addEventListener('click', () => this.switchView('grid'));
        this.treeViewBtn.addEventListener('click', () => this.switchView('tree'));

        this.countEl = controls.createEl('span', { cls: 'image-browser-count' });
        this.orphanStatusEl = contentEl.createDiv({
            cls: 'image-browser-filter-status image-browser-hidden',
            attr: { role: 'status', 'aria-live': 'polite' },
        });
        this.gridEl = contentEl.createDiv({ cls: 'image-browser-grid' });
        this.loadLocalImages();
    }

    onClose() {
        this.loadSequence++;
        this.orphanScanState.cancel();
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
        this.orphanScanState.cancel();
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
            if (this.showLocalOrphansOnly && !this.orphanPaths) {
                void this.scanLocalOrphans();
            } else {
                this.applyFilterAndSort();
            }
        } else {
            if (this.sortSelect?.value === 'created') this.sortSelect.value = 'name';
            void this.loadHostedImages();
        }
    }

    private switchView(view: BrowserView) {
        if (view === this.view) return;
        this.view = view;
        this.gridViewBtn?.toggleClass('is-active', view === 'grid');
        this.treeViewBtn?.toggleClass('is-active', view === 'tree');
        this.gridViewBtn?.setAttribute('aria-pressed', String(view === 'grid'));
        this.treeViewBtn?.setAttribute('aria-pressed', String(view === 'tree'));
        this.renderContent();
    }

    private loadLocalImages() {
        this.allImages = this.scanner.getAllImages();
        this.applyFilterAndSort();
    }

    private async loadHostedImages() {
        this.orphanScanState.cancel();
        const requestSequence = ++this.loadSequence;
        const config = this.getEnabledHostingConfigs().find(
            (item) => item.id === this.hostingSelect?.value
        );
        this.hostedImages = [];
        this.hostedOrphanKeys = null;
        this.hostedOrphanError = '';
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
        if (this.showLocalOrphansOnly) {
            await this.scanLocalOrphans();
        } else {
            this.orphanScanState.cancel();
            this.orphanPaths = null;
            this.localOrphanError = '';
            this.updateOrphanButton();
            this.applyFilterAndSort();
        }
    }

    private async toggleHostedOrphanFilter() {
        this.showHostedOrphansOnly = !this.showHostedOrphansOnly;
        if (this.showHostedOrphansOnly) {
            await this.scanHostedOrphans();
        } else {
            this.orphanScanState.cancel();
            this.hostedOrphanKeys = null;
            this.hostedOrphanError = '';
            this.updateOrphanButton();
            this.applyFilterAndSort();
        }
    }

    private async scanLocalOrphans() {
        const startedAt = Date.now();
        const token = this.orphanScanState.start('local');
        this.orphanPaths = null;
        this.localOrphanError = '';
        this.updateOrphanButton();
        this.renderContent();

        try {
            const finder = new OrphanFinder(this.app, this.plugin.settings.supportedExtensions);
            const result = await finder.findOrphans();
            if (!this.orphanScanState.isCurrent(token, 'local') || this.source !== 'local') return;
            this.orphanPaths = new Set(result.orphans.map((file) => file.path));
        } catch (error) {
            if (!this.orphanScanState.isCurrent(token, 'local') || this.source !== 'local') return;
            this.showLocalOrphansOnly = false;
            this.localOrphanError = t('modal.imageBrowser.orphanScanFailed', {
                error: error instanceof Error ? error.message : t('modal.imageBrowser.unknownError'),
            });
        } finally {
            await this.waitForScanFeedback(startedAt);
            if (this.orphanScanState.finish(token, 'local') && this.source === 'local') {
                this.updateOrphanButton();
                this.applyFilterAndSort();
            }
        }
    }

    private async scanHostedOrphans() {
        const startedAt = Date.now();
        const token = this.orphanScanState.start('hosting');
        this.hostedOrphanKeys = null;
        this.hostedOrphanError = '';
        this.updateOrphanButton();
        this.renderContent();

        try {
            const orphans = await findOrphanHostedImages(this.app, this.hostedImages);
            if (!this.orphanScanState.isCurrent(token, 'hosting') || this.source !== 'hosting') return;
            this.hostedOrphanKeys = new Set(orphans.map((image) => image.key));
        } catch (error) {
            if (!this.orphanScanState.isCurrent(token, 'hosting') || this.source !== 'hosting') return;
            this.showHostedOrphansOnly = false;
            this.hostedOrphanError = t('modal.imageBrowser.orphanScanFailed', {
                error: error instanceof Error ? error.message : t('modal.imageBrowser.unknownError'),
            });
        } finally {
            await this.waitForScanFeedback(startedAt);
            if (this.orphanScanState.finish(token, 'hosting') && this.source === 'hosting') {
                this.updateOrphanButton();
                this.applyFilterAndSort();
            }
        }
    }

    private updateOrphanButton() {
        if (!this.orphanBtn) return;
        const isActive = this.source === 'local'
            ? this.showLocalOrphansOnly
            : this.showHostedOrphansOnly;
        const isScanning = this.orphanScanState.isScanning(this.source);
        this.orphanBtn.setText(isScanning
            ? t('modal.imageBrowser.orphanFilterScanning')
            : isActive
                ? t('modal.imageBrowser.showAllImages')
                : t('modal.imageBrowser.orphanFilter'));
        this.orphanBtn.toggleClass('is-active', isActive && !isScanning);
        this.orphanBtn.toggleClass('is-scanning', isScanning);
        this.orphanBtn.setAttribute('aria-pressed', String(isActive));
        this.orphanBtn.disabled = isScanning
            || (this.source === 'hosting' && this.loadingHosting);
        this.updateOrphanStatus(isActive, isScanning);
    }

    private updateOrphanStatus(isActive: boolean, isScanning: boolean) {
        if (!this.orphanStatusEl) return;
        const visible = isActive || isScanning;
        this.orphanStatusEl.toggleClass('image-browser-hidden', !visible);
        this.orphanStatusEl.toggleClass('is-active', isActive && !isScanning);
        this.orphanStatusEl.toggleClass('is-scanning', isScanning);
        if (!visible) return;

        this.orphanStatusEl.setText(isScanning
            ? this.source === 'local'
                ? t('modal.imageBrowser.orphanScanning')
                : t('modal.imageBrowser.hostedOrphanScanning')
            : this.source === 'local'
                ? t('modal.imageBrowser.localOrphanFilterActive')
                : t('modal.imageBrowser.hostedOrphanFilterActive'));
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
        this.renderContent();
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
        this.renderContent();
    }

    private renderContent() {
        if (!this.gridEl) return;
        this.gridEl.empty();
        this.gridEl.toggleClass('image-browser-grid', this.view === 'grid');
        this.gridEl.toggleClass('image-browser-tree', this.view === 'tree');
        if (this.source === 'hosting') {
            this.renderHostedContent();
        } else {
            this.renderLocalContent();
        }
    }

    private renderLocalContent() {
        if (!this.gridEl) return;
        if (this.orphanScanState.isScanning('local')) {
            this.setCountText(t('modal.imageBrowser.scanningCount'));
            this.renderLoading(t('modal.imageBrowser.orphanScanning'));
            return;
        }
        this.updateCount(this.filteredImages.length, this.allImages.length);
        if (this.localOrphanError) {
            this.renderEmpty(this.localOrphanError);
            return;
        }
        if (this.filteredImages.length === 0) {
            this.renderEmpty(t('modal.imageBrowser.noImages'));
            return;
        }

        if (this.view === 'tree') {
            const initializeTopLevel = !this.localTreeInitialized;
            this.localTreeInitialized = true;
            renderImageTree({
                containerEl: this.gridEl,
                items: this.filteredImages,
                getPath: (file) => file.path,
                getName: (file) => file.name,
                getImageUrl: (file) => this.app.vault.getResourcePath(file),
                getMeta: (file) => formatFileSize(file.stat.size),
                expandedPaths: this.localExpandedPaths,
                initializeTopLevel,
                forceExpanded: Boolean(this.searchInput?.value.trim()),
                folderCountText: (count) => t('modal.imageBrowser.treeImageCount', {
                    count: String(count),
                }),
                openItem: (file) => this.openLocalImage(file),
            });
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
                this.openLocalImage(file);
            });
        }
    }

    private openLocalImage(file: TFile) {
        new ImagePreviewModal(
            this.app,
            this.plugin,
            file,
            this,
            (deletedFile) => this.handleLocalImageDeleted(deletedFile)
        ).open();
    }

    private handleLocalImageDeleted(file: TFile) {
        this.allImages = this.allImages.filter((image) => image.path !== file.path);
        this.orphanPaths?.delete(file.path);
        this.applyFilterAndSort();
    }

    private renderHostedContent() {
        if (!this.gridEl) return;
        if (this.loadingHosting) {
            this.setCountText(t('modal.imageBrowser.loadingCount'));
            this.renderEmpty(t('modal.imageBrowser.loadingHosting'));
            return;
        }
        if (this.orphanScanState.isScanning('hosting')) {
            this.setCountText(t('modal.imageBrowser.scanningCount'));
            this.renderLoading(t('modal.imageBrowser.hostedOrphanScanning'));
            return;
        }
        this.updateCount(this.filteredHostedImages.length, this.hostedImages.length);
        if (this.hostingError) {
            this.renderEmpty(this.hostingError);
            return;
        }
        if (this.hostedOrphanError) {
            this.renderEmpty(this.hostedOrphanError);
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
        if (this.view === 'tree') {
            const configId = config?.id ?? '';
            const expandedPaths = this.getHostingExpandedPaths(configId);
            const initializeTopLevel = !this.initializedHostingTrees.has(configId);
            this.initializedHostingTrees.add(configId);
            renderImageTree({
                containerEl: this.gridEl,
                items: this.filteredHostedImages,
                getPath: (image) => image.key,
                getName: (image) => image.name,
                getImageUrl: (image) => image.url,
                getMeta: (image) => formatFileSize(image.size),
                expandedPaths,
                initializeTopLevel,
                forceExpanded: Boolean(this.searchInput?.value.trim()),
                folderCountText: (count) => t('modal.imageBrowser.treeImageCount', {
                    count: String(count),
                }),
                openItem: (image) => this.openHostedImage(image, config, uploader?.supportsDeletion ?? false),
            });
            return;
        }

        for (const image of this.filteredHostedImages) {
            const card = this.createCard(image.name, image.key, image.size);
            const img = card.imageContainer.createEl('img', { attr: { src: image.url } });
            const thumbSize = String(this.plugin.settings.thumbnailSize);
            img.setAttribute('width', thumbSize);
            img.setAttribute('height', thumbSize);
            card.cardEl.addEventListener('click', () => {
                this.openHostedImage(image, config, uploader?.supportsDeletion ?? false);
            });
        }
    }

    private getHostingExpandedPaths(configId: string): Set<string> {
        let expandedPaths = this.hostingExpandedPaths.get(configId);
        if (!expandedPaths) {
            expandedPaths = new Set<string>();
            this.hostingExpandedPaths.set(configId, expandedPaths);
        }
        return expandedPaths;
    }

    private openHostedImage(
        image: HostedImage,
        config: ImageHostingConfig | null,
        supportsDeletion: boolean
    ) {
        new HostedImagePreviewModal(
            this.app,
            image,
            supportsDeletion && config
                ? () => this.deleteHostedImage(image, config)
                : undefined
        ).open();
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
        this.setCountText(t('modal.imageBrowser.showing', {
            count: String(count),
            total: String(total),
        }));
    }

    private setCountText(text: string) {
        if (this.countEl) this.countEl.textContent = text;
    }

    private renderEmpty(message: string) {
        this.gridEl?.createDiv({ cls: 'image-browser-empty', text: message });
    }

    private renderLoading(message: string) {
        const loadingEl = this.gridEl?.createDiv({
            cls: 'image-browser-loading',
            attr: { role: 'status', 'aria-live': 'polite' },
        });
        loadingEl?.createDiv({ cls: 'image-browser-loading-spinner' });
        loadingEl?.createDiv({ cls: 'image-browser-loading-text', text: message });
    }

    private async waitForScanFeedback(startedAt: number): Promise<void> {
        const remaining = getRemainingScanFeedbackDuration(startedAt, Date.now());
        if (remaining === 0) return;
        await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
    }
}
