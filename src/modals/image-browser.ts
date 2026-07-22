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
import { renderImageTree } from './image-browser-tree';
import { ConfirmDialog } from './confirm-dialog';
import { trashLocalImage } from '../utils/local-image-deletion';
import {
    deleteBatchItems,
    ImageBrowserBatchSelection,
} from './image-browser-batch';
import {
    getRemainingScanFeedbackDuration,
    ImageBrowserScanState,
} from './image-browser-scan-state';
import { getOrphanBadgeLabel } from './image-browser-orphan-label';
import { ImageBrowserVaultActionState } from './image-browser-vault-actions';

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
    private batchToolbarEl: HTMLDivElement | null = null;
    private selectAllBtn: HTMLButtonElement | null = null;
    private selectNoneBtn: HTMLButtonElement | null = null;
    private selectedCountEl: HTMLSpanElement | null = null;
    private deleteSelectedBtn: HTMLButtonElement | null = null;
    private hostingSelect: HTMLSelectElement | null = null;
    private localBtn: HTMLButtonElement | null = null;
    private hostingBtn: HTMLButtonElement | null = null;
    private gridViewBtn: HTMLButtonElement | null = null;
    private treeViewBtn: HTMLButtonElement | null = null;
    private vaultActionsEl: HTMLDivElement | null = null;
    private reorganizeVaultBtn: HTMLButtonElement | null = null;
    private uploadVaultBtn: HTMLButtonElement | null = null;
    private source: BrowserSource = 'local';
    private view: BrowserView = 'grid';
    private readonly localExpandedPaths = new Set<string>();
    private readonly hostingExpandedPaths = new Map<string, Set<string>>();
    private localTreeInitialized = false;
    private readonly initializedHostingTrees = new Set<string>();
    private readonly orphanScanState = new ImageBrowserScanState();
    private readonly batchSelection = new ImageBrowserBatchSelection();
    private readonly vaultActionState = new ImageBrowserVaultActionState();
    private showLocalOrphansOnly = false;
    private showHostedOrphansOnly = false;
    private localOrphanError = '';
    private hostedOrphanError = '';
    private debounceTimer: number | null = null;
    private loadSequence = 0;
    private loadingHosting = false;
    private hostingError = '';
    private deletingBatchSource: BrowserSource | null = null;
    private localOrphanScanPromise: Promise<Set<string>> | null = null;
    private hostedOrphanScan: {
        sequence: number;
        promise: Promise<Set<string>>;
    } | null = null;
    private isModalOpen = false;

    constructor(app: App, plugin: ImageManagerPlugin) {
        super(app);
        this.plugin = plugin;
        this.scanner = new ImageScanner(app, plugin.settings.supportedExtensions);
    }

    onOpen() {
        this.isModalOpen = true;
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

        this.createVaultActions(contentEl);

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
        this.createBatchToolbar(contentEl);
        this.gridEl = contentEl.createDiv({ cls: 'image-browser-grid' });
        this.loadLocalImages();
    }

    onClose() {
        this.isModalOpen = false;
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

    private createBatchToolbar(containerEl: HTMLElement) {
        this.batchToolbarEl = containerEl.createDiv({
            cls: 'image-browser-batch-toolbar image-browser-hidden',
        });
        this.selectAllBtn = this.batchToolbarEl.createEl('button', {
            text: t('modal.imageBrowser.selectAll'),
        });
        this.selectNoneBtn = this.batchToolbarEl.createEl('button', {
            text: t('modal.imageBrowser.selectNone'),
        });
        this.selectedCountEl = this.batchToolbarEl.createSpan({
            cls: 'image-browser-selected-count',
        });
        this.deleteSelectedBtn = this.batchToolbarEl.createEl('button', {
            cls: 'mod-warning image-browser-delete-selected',
            text: t('modal.imageBrowser.deleteSelected'),
        });
        this.selectAllBtn.addEventListener('click', () => this.selectAllVisibleImages());
        this.selectNoneBtn.addEventListener('click', () => this.clearCurrentSelection());
        this.deleteSelectedBtn.addEventListener('click', () => this.confirmBatchDelete());
    }

    private createVaultActions(containerEl: HTMLElement) {
        this.vaultActionsEl = containerEl.createDiv({ cls: 'image-browser-vault-actions' });
        this.reorganizeVaultBtn = this.vaultActionsEl.createEl('button', {
            text: t('modal.imageBrowser.reorganizeVault'),
        });
        this.uploadVaultBtn = this.vaultActionsEl.createEl('button', {
            text: t('modal.imageBrowser.uploadVault'),
        });
        this.reorganizeVaultBtn.addEventListener('click', () => this.confirmReorganizeVault());
        this.uploadVaultBtn.addEventListener('click', () => this.confirmUploadVault());
        this.updateVaultActionButtons();
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
        this.updateVaultActionButtons();
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
                if (!this.orphanPaths) void this.refreshLocalOrphanLabels();
            }
        } else {
            if (this.sortSelect?.value === 'created') this.sortSelect.value = 'name';
            void this.loadHostedImages();
        }
    }

    private confirmReorganizeVault() {
        if (this.vaultActionState.isRunning()) return;
        new ConfirmDialog(this.app, {
            title: t('modal.imageBrowser.reorganizeVault'),
            message: t('modal.imageBrowser.reorganizeVaultMessage'),
            onConfirm: () => this.runVaultAction(() => this.plugin.reorganizeEntireVault()),
        }).open();
    }

    private confirmUploadVault() {
        if (this.vaultActionState.isRunning()) return;
        if (!this.plugin.settings.autoReplaceAfterUpload) {
            new Notice(t('notice.autoReplaceRequiredForVaultUpload'));
            return;
        }
        new ConfirmDialog(this.app, {
            title: t('modal.imageBrowser.uploadVault'),
            message: t('modal.imageBrowser.uploadVaultMessage'),
            onConfirm: () => this.runVaultAction(() => this.plugin.uploadEntireVault()),
        }).open();
    }

    private async runVaultAction(action: () => Promise<void>) {
        if (!this.vaultActionState.start()) return;
        this.updateVaultActionButtons();
        try {
            await action();
            this.loadLocalImages();
        } finally {
            this.vaultActionState.finish();
            this.updateVaultActionButtons();
        }
    }

    private updateVaultActionButtons() {
        const visible = this.vaultActionState.isVisible(this.source);
        this.vaultActionsEl?.toggleClass('image-browser-hidden', !visible);
        const disabled = this.vaultActionState.isRunning();
        if (this.reorganizeVaultBtn) this.reorganizeVaultBtn.disabled = disabled;
        if (this.uploadVaultBtn) this.uploadVaultBtn.disabled = disabled;
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
        void this.refreshLocalOrphanLabels();
    }

    private async loadHostedImages() {
        this.orphanScanState.cancel();
        this.batchSelection.clear('hosting');
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
            this.loadingHosting = false;
            this.updateOrphanButton();
            if (this.showHostedOrphansOnly) {
                await this.scanHostedOrphans();
            } else {
                this.applyFilterAndSort();
                void this.refreshHostedOrphanLabels(requestSequence);
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
            if (this.orphanPaths) {
                this.updateOrphanButton();
                this.applyFilterAndSort();
            } else {
                await this.scanLocalOrphans();
            }
        } else {
            this.orphanScanState.cancel();
            this.localOrphanError = '';
            this.batchSelection.clear('local');
            this.updateOrphanButton();
            this.applyFilterAndSort();
        }
    }

    private async toggleHostedOrphanFilter() {
        this.showHostedOrphansOnly = !this.showHostedOrphansOnly;
        if (this.showHostedOrphansOnly) {
            if (this.hostedOrphanKeys) {
                this.updateOrphanButton();
                this.applyFilterAndSort();
            } else {
                await this.scanHostedOrphans();
            }
        } else {
            this.orphanScanState.cancel();
            this.hostedOrphanError = '';
            this.batchSelection.clear('hosting');
            this.updateOrphanButton();
            this.applyFilterAndSort();
        }
    }

    private async scanLocalOrphans() {
        const startedAt = Date.now();
        const token = this.orphanScanState.start('local');
        this.orphanPaths = null;
        this.localOrphanError = '';
        this.batchSelection.clear('local');
        this.updateOrphanButton();
        this.renderContent();

        try {
            const orphanPaths = await this.getLocalOrphanPaths();
            this.orphanPaths = orphanPaths;
            if (!this.orphanScanState.isCurrent(token, 'local') || this.source !== 'local') return;
        } catch (error) {
            if (!this.orphanScanState.isCurrent(token, 'local') || this.source !== 'local') return;
            this.showLocalOrphansOnly = false;
            this.batchSelection.clear('local');
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
        const requestSequence = this.loadSequence;
        const token = this.orphanScanState.start('hosting');
        this.hostedOrphanKeys = null;
        this.hostedOrphanError = '';
        this.batchSelection.clear('hosting');
        this.updateOrphanButton();
        this.renderContent();

        try {
            const orphanKeys = await this.getHostedOrphanKeys(requestSequence);
            if (requestSequence === this.loadSequence) this.hostedOrphanKeys = orphanKeys;
            if (!this.orphanScanState.isCurrent(token, 'hosting') || this.source !== 'hosting') return;
        } catch (error) {
            if (!this.orphanScanState.isCurrent(token, 'hosting') || this.source !== 'hosting') return;
            this.showHostedOrphansOnly = false;
            this.batchSelection.clear('hosting');
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

    private getLocalOrphanPaths(): Promise<Set<string>> {
        if (this.localOrphanScanPromise) return this.localOrphanScanPromise;
        const finder = new OrphanFinder(this.app, this.plugin.settings.supportedExtensions);
        const scan = finder.findOrphans().then(
            (result) => new Set(result.orphans.map((file) => file.path))
        );
        this.localOrphanScanPromise = scan;
        void scan.then(
            () => {
                if (this.localOrphanScanPromise === scan) this.localOrphanScanPromise = null;
            },
            () => {
                if (this.localOrphanScanPromise === scan) this.localOrphanScanPromise = null;
            }
        );
        return scan;
    }

    private async refreshLocalOrphanLabels() {
        try {
            this.orphanPaths = await this.getLocalOrphanPaths();
            if (this.isModalOpen
                && this.source === 'local'
                && !this.orphanScanState.isScanning('local')) {
                this.applyFilterAndSort();
            }
        } catch {
            // Keep the list usable without labels; explicit filtering retries with visible feedback.
        }
    }

    private getHostedOrphanKeys(requestSequence: number): Promise<Set<string>> {
        if (this.hostedOrphanScan?.sequence === requestSequence) {
            return this.hostedOrphanScan.promise;
        }
        const images = [...this.hostedImages];
        const scan = findOrphanHostedImages(this.app, images).then(
            (orphans) => new Set(orphans.map((image) => image.key))
        );
        this.hostedOrphanScan = { sequence: requestSequence, promise: scan };
        void scan.then(
            () => {
                if (this.hostedOrphanScan?.promise === scan) this.hostedOrphanScan = null;
            },
            () => {
                if (this.hostedOrphanScan?.promise === scan) this.hostedOrphanScan = null;
            }
        );
        return scan;
    }

    private async refreshHostedOrphanLabels(requestSequence: number) {
        try {
            const orphanKeys = await this.getHostedOrphanKeys(requestSequence);
            if (requestSequence !== this.loadSequence) return;
            this.hostedOrphanKeys = orphanKeys;
            if (this.isModalOpen
                && this.source === 'hosting'
                && !this.orphanScanState.isScanning('hosting')) {
                this.applyFilterAndSort();
            }
        } catch {
            // Keep the remote list usable without labels; explicit filtering retries visibly.
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
        this.orphanBtn.disabled = this.deletingBatchSource !== null
            || isScanning
            || (this.source === 'hosting' && this.loadingHosting);
        this.updateOrphanStatus(isActive, isScanning);
        this.updateBatchToolbar();
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
        this.updateBatchToolbar();
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
                getBadge: (file) => this.getLocalOrphanBadge(file),
                expandedPaths: this.localExpandedPaths,
                initializeTopLevel,
                forceExpanded: Boolean(this.searchInput?.value.trim()),
                folderCountText: (count) => t('modal.imageBrowser.treeImageCount', {
                    count: String(count),
                }),
                openItem: (file) => this.openLocalImage(file),
                isItemSelected: this.isBatchSelectionAvailable()
                    ? (file) => this.batchSelection.isSelected('local', file.path)
                    : undefined,
                onItemSelectionChange: this.isBatchSelectionAvailable()
                    ? (file, selected) => this.setItemSelected('local', file.path, selected)
                    : undefined,
                selectionLabel: (file) => t('modal.imageBrowser.selectImage', {
                    name: file.name,
                }),
            });
            return;
        }

        for (const file of this.filteredImages) {
            const card = this.createCard(
                file.name,
                file.path,
                file.stat.size,
                this.getLocalOrphanBadge(file)
            );
            if (this.isBatchSelectionAvailable()) {
                this.attachCardSelection(card.cardEl, 'local', file.path, file.name);
            }
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
        this.batchSelection.remove('local', [file.path]);
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
                getBadge: (image) => this.getHostedOrphanBadge(image),
                expandedPaths,
                initializeTopLevel,
                forceExpanded: Boolean(this.searchInput?.value.trim()),
                folderCountText: (count) => t('modal.imageBrowser.treeImageCount', {
                    count: String(count),
                }),
                openItem: (image) => this.openHostedImage(image, config, uploader?.supportsDeletion ?? false),
                isItemSelected: this.isBatchSelectionAvailable()
                    ? (image) => this.batchSelection.isSelected('hosting', image.key)
                    : undefined,
                onItemSelectionChange: this.isBatchSelectionAvailable()
                    ? (image, selected) => this.setItemSelected('hosting', image.key, selected)
                    : undefined,
                selectionLabel: (image) => t('modal.imageBrowser.selectImage', {
                    name: image.name,
                }),
            });
            return;
        }

        for (const image of this.filteredHostedImages) {
            const card = this.createCard(
                image.name,
                image.key,
                image.size,
                this.getHostedOrphanBadge(image)
            );
            if (this.isBatchSelectionAvailable()) {
                this.attachCardSelection(card.cardEl, 'hosting', image.key, image.name);
            }
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
                : undefined,
            this
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
        this.batchSelection.remove('hosting', [image.key]);
        this.applyFilterAndSort();
    }

    private isBatchSelectionAvailable(source = this.source): boolean {
        if (this.orphanScanState.isScanning(source)) return false;
        if (source === 'local') {
            return this.showLocalOrphansOnly
                && this.orphanPaths !== null
                && !this.localOrphanError;
        }
        const config = this.getSelectedHostingConfig();
        const supportsDeletion = config
            ? createUploader(config, this.plugin.settings.uploadPathTemplate).supportsDeletion
            : false;
        return this.showHostedOrphansOnly
            && this.hostedOrphanKeys !== null
            && !this.loadingHosting
            && !this.hostedOrphanError
            && !this.hostingError
            && supportsDeletion;
    }

    private updateBatchToolbar() {
        if (!this.batchToolbarEl) return;
        const deleting = this.deletingBatchSource !== null;
        if (this.localBtn) this.localBtn.disabled = deleting;
        if (this.hostingBtn) this.hostingBtn.disabled = deleting;
        if (this.hostingSelect) this.hostingSelect.disabled = deleting;
        if (this.searchInput) this.searchInput.disabled = deleting;
        if (this.sortSelect) this.sortSelect.disabled = deleting;
        if (this.gridViewBtn) this.gridViewBtn.disabled = deleting;
        if (this.treeViewBtn) this.treeViewBtn.disabled = deleting;
        if (this.orphanBtn) this.orphanBtn.disabled = deleting
            || this.orphanScanState.isScanning(this.source)
            || (this.source === 'hosting' && this.loadingHosting);
        const available = this.isBatchSelectionAvailable();
        this.batchToolbarEl.toggleClass('image-browser-hidden', !available);
        if (!available) return;

        this.retainValidSelections(this.source);
        const selectedCount = this.batchSelection.getCount(this.source);
        const visibleCount = this.source === 'local'
            ? this.filteredImages.length
            : this.filteredHostedImages.length;
        const deletingCurrentSource = this.deletingBatchSource === this.source;
        if (this.selectedCountEl) {
            this.selectedCountEl.setText(t('modal.imageBrowser.selectedCount', {
                count: String(selectedCount),
            }));
        }
        if (this.selectAllBtn) this.selectAllBtn.disabled = deletingCurrentSource || visibleCount === 0;
        if (this.selectNoneBtn) this.selectNoneBtn.disabled = deletingCurrentSource || selectedCount === 0;
        if (this.deleteSelectedBtn) {
            this.deleteSelectedBtn.disabled = deletingCurrentSource || selectedCount === 0;
            this.deleteSelectedBtn.setText(deletingCurrentSource
                ? t('modal.imageBrowser.deletingSelected')
                : t('modal.imageBrowser.deleteSelected'));
        }
        this.gridEl?.querySelectorAll<HTMLInputElement>('.image-browser-selection-checkbox')
            .forEach((checkbox) => { checkbox.disabled = deletingCurrentSource; });
    }

    private retainValidSelections(source: BrowserSource) {
        const validKeys = source === 'local'
            ? this.orphanPaths ?? []
            : this.hostedOrphanKeys ?? [];
        this.batchSelection.retain(source, validKeys);
    }

    private selectAllVisibleImages() {
        if (!this.isBatchSelectionAvailable()) return;
        const keys = this.source === 'local'
            ? this.filteredImages.map((file) => file.path)
            : this.filteredHostedImages.map((image) => image.key);
        this.batchSelection.selectAll(this.source, keys);
        this.renderContent();
    }

    private clearCurrentSelection() {
        this.batchSelection.clear(this.source);
        this.renderContent();
    }

    private setItemSelected(source: BrowserSource, key: string, selected: boolean) {
        this.batchSelection.setSelected(source, key, selected);
        this.updateBatchToolbar();
    }

    private attachCardSelection(
        cardEl: HTMLDivElement,
        source: BrowserSource,
        key: string,
        name: string
    ) {
        const selected = this.batchSelection.isSelected(source, key);
        cardEl.toggleClass('is-selected', selected);
        const checkbox = cardEl.createEl('input', {
            cls: 'image-browser-selection-checkbox image-browser-card-checkbox',
            attr: {
                type: 'checkbox',
                'aria-label': t('modal.imageBrowser.selectImage', { name }),
            },
        });
        checkbox.checked = selected;
        checkbox.addEventListener('click', (event) => event.stopPropagation());
        checkbox.addEventListener('change', () => {
            this.setItemSelected(source, key, checkbox.checked);
            cardEl.toggleClass('is-selected', checkbox.checked);
        });
    }

    private confirmBatchDelete() {
        if (!this.isBatchSelectionAvailable()) return;
        const source = this.source;
        const count = this.batchSelection.getCount(source);
        if (count === 0) {
            new Notice(t('modal.imageBrowser.noSelection'));
            return;
        }
        new ConfirmDialog(this.app, {
            title: source === 'local'
                ? t('modal.imageBrowser.deleteLocalBatchTitle')
                : t('modal.imageBrowser.deleteHostedBatchTitle'),
            message: source === 'local'
                ? t('modal.imageBrowser.deleteLocalBatchMessage', { count: String(count) })
                : t('modal.imageBrowser.deleteHostedBatchMessage', { count: String(count) }),
            confirmText: t('modal.imageBrowser.deleteSelected'),
            onConfirm: () => this.deleteSelectedImages(source),
        }).open();
    }

    private async deleteSelectedImages(source: BrowserSource) {
        if (this.deletingBatchSource) return;
        this.deletingBatchSource = source;
        this.updateBatchToolbar();
        const selectedKeys = new Set(this.batchSelection.getKeys(source));

        try {
            if (source === 'local') {
                const selectedFiles = this.allImages.filter((file) => selectedKeys.has(file.path));
                const result = await deleteBatchItems(selectedFiles, (file) =>
                    trashLocalImage(this.app, file)
                );
                const deletedPaths = new Set(result.deleted.map((file) => file.path));
                this.allImages = this.allImages.filter((file) => !deletedPaths.has(file.path));
                this.orphanPaths = new Set(
                    Array.from(this.orphanPaths ?? []).filter((path) => !deletedPaths.has(path))
                );
                this.batchSelection.remove('local', deletedPaths);
                this.showBatchDeleteNotice(result.deleted.length, result.failed.length, 'local');
            } else {
                const config = this.getSelectedHostingConfig();
                if (!config) throw new Error(t('modal.imageBrowser.noHosting'));
                const uploader = createUploader(config, this.plugin.settings.uploadPathTemplate);
                const selectedImages = this.hostedImages.filter((image) => selectedKeys.has(image.key));
                const result = await deleteBatchItems(selectedImages, (image) =>
                    uploader.deleteImage(image.key)
                );
                const deletedKeys = new Set(result.deleted.map((image) => image.key));
                this.hostedImages = this.hostedImages.filter((image) => !deletedKeys.has(image.key));
                this.hostedOrphanKeys = new Set(
                    Array.from(this.hostedOrphanKeys ?? []).filter((key) => !deletedKeys.has(key))
                );
                this.batchSelection.remove('hosting', deletedKeys);
                this.showBatchDeleteNotice(result.deleted.length, result.failed.length, 'hosting');
            }
        } catch (error) {
            new Notice(t('modal.imageBrowser.batchDeleteFailed', {
                error: error instanceof Error ? error.message : t('modal.imageBrowser.unknownError'),
            }));
        } finally {
            this.deletingBatchSource = null;
            if (this.source === source) this.applyFilterAndSort();
            else this.updateBatchToolbar();
        }
    }

    private showBatchDeleteNotice(deleted: number, failed: number, source: BrowserSource) {
        if (failed > 0) {
            new Notice(t('modal.imageBrowser.batchDeletePartial', {
                deleted: String(deleted),
                failed: String(failed),
            }));
            return;
        }
        new Notice(t(source === 'local'
            ? 'modal.imageBrowser.localBatchDeleted'
            : 'modal.imageBrowser.hostedBatchDeleted', {
            count: String(deleted),
        }));
    }

    private getLocalOrphanBadge(file: TFile): string | null {
        return getOrphanBadgeLabel(
            file,
            (item) => item.path,
            this.orphanPaths,
            t('modal.imageBrowser.orphanBadge')
        );
    }

    private getHostedOrphanBadge(image: HostedImage): string | null {
        return getOrphanBadgeLabel(
            image,
            (item) => item.key,
            this.hostedOrphanKeys,
            t('modal.imageBrowser.orphanBadge')
        );
    }

    private createCard(name: string, path: string, size: number, badge: string | null): {
        cardEl: HTMLDivElement;
        imageContainer: HTMLDivElement;
    } {
        const cardEl = this.gridEl!.createDiv({ cls: 'image-browser-card' });
        cardEl.setAttribute('title', `${path}\n${t('modal.imageBrowser.insertTooltip')}`);
        const imageContainer = cardEl.createDiv({ cls: 'image-browser-card-img' });
        if (badge) {
            cardEl.createDiv({
                cls: 'image-browser-orphan-badge image-browser-card-orphan-badge',
                text: badge,
            });
        }
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
