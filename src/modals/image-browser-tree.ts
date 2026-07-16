import { setIcon } from 'obsidian';

export interface ImageTreeNode<T> {
    name: string;
    path: string;
    folders: ImageTreeNode<T>[];
    items: T[];
    itemCount: number;
}

interface MutableImageTreeNode<T> extends ImageTreeNode<T> {
    folders: MutableImageTreeNode<T>[];
    folderMap: Map<string, MutableImageTreeNode<T>>;
}

export interface ImageTreeRenderOptions<T> {
    containerEl: HTMLElement;
    items: T[];
    getPath: (item: T) => string;
    getName: (item: T) => string;
    getImageUrl: (item: T) => string;
    getMeta: (item: T) => string;
    expandedPaths: Set<string>;
    initializeTopLevel: boolean;
    forceExpanded: boolean;
    folderCountText: (count: number) => string;
    openItem: (item: T) => void;
    isItemSelected?: (item: T) => boolean;
    onItemSelectionChange?: (item: T, selected: boolean) => void;
    selectionLabel?: (item: T) => string;
}

/** Build a directory tree while preserving the caller's item sort order. */
export function buildImageTree<T>(items: T[], getPath: (item: T) => string): ImageTreeNode<T> {
    const root = createMutableNode<T>('', '');

    for (const item of items) {
        const parts = getPath(item).split('/').filter(Boolean);
        parts.pop();
        let current = root;
        let currentPath = '';

        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            let folder = current.folderMap.get(part);
            if (!folder) {
                folder = createMutableNode(part, currentPath);
                current.folderMap.set(part, folder);
                current.folders.push(folder);
            }
            current = folder;
        }

        current.items.push(item);
    }

    finalizeNode(root);
    return root;
}

/** Render an expandable image directory tree. */
export function renderImageTree<T>(options: ImageTreeRenderOptions<T>): void {
    const root = buildImageTree(options.items, options.getPath);
    if (options.initializeTopLevel) {
        for (const folder of root.folders) options.expandedPaths.add(folder.path);
    }

    for (const folder of root.folders) renderFolder(folder, options.containerEl, options);
    renderItems(root.items, options.containerEl, options);
}

function createMutableNode<T>(name: string, path: string): MutableImageTreeNode<T> {
    return {
        name,
        path,
        folders: [],
        items: [],
        itemCount: 0,
        folderMap: new Map<string, MutableImageTreeNode<T>>(),
    };
}

function finalizeNode<T>(node: MutableImageTreeNode<T>): number {
    node.folders.sort((left, right) => left.name.localeCompare(right.name));
    node.itemCount = node.items.length;
    for (const folder of node.folders) node.itemCount += finalizeNode(folder);
    return node.itemCount;
}

function renderFolder<T>(
    folder: ImageTreeNode<T>,
    parentEl: HTMLElement,
    options: ImageTreeRenderOptions<T>
): void {
    const nodeEl = parentEl.createDiv({ cls: 'image-browser-tree-node' });
    const expanded = options.forceExpanded || options.expandedPaths.has(folder.path);
    const folderButton = nodeEl.createEl('button', { cls: 'image-browser-tree-folder' });
    folderButton.setAttribute('aria-expanded', String(expanded));
    const caretEl = folderButton.createSpan({
        cls: 'image-browser-tree-caret',
        text: expanded ? '▾' : '▸',
    });
    const folderIconEl = folderButton.createSpan({ cls: 'image-browser-tree-folder-icon' });
    setIcon(folderIconEl, 'folder');
    folderButton.createSpan({ cls: 'image-browser-tree-folder-name', text: folder.name });
    folderButton.createSpan({
        cls: 'image-browser-tree-folder-count',
        text: options.folderCountText(folder.itemCount),
    });

    const childrenEl = nodeEl.createDiv({ cls: 'image-browser-tree-children' });
    childrenEl.toggleClass('image-browser-hidden', !expanded);
    for (const childFolder of folder.folders) renderFolder(childFolder, childrenEl, options);
    renderItems(folder.items, childrenEl, options);

    folderButton.addEventListener('click', () => {
        if (options.forceExpanded) return;
        const isExpanded = options.expandedPaths.has(folder.path);
        if (isExpanded) options.expandedPaths.delete(folder.path);
        else options.expandedPaths.add(folder.path);
        const nextExpanded = !isExpanded;
        folderButton.setAttribute('aria-expanded', String(nextExpanded));
        caretEl.setText(nextExpanded ? '▾' : '▸');
        childrenEl.toggleClass('image-browser-hidden', !nextExpanded);
    });
}

function renderItems<T>(
    items: T[],
    parentEl: HTMLElement,
    options: ImageTreeRenderOptions<T>
): void {
    for (const item of items) {
        const rowEl = parentEl.createDiv({ cls: 'image-browser-tree-item-row' });
        const selected = options.isItemSelected?.(item) ?? false;
        if (options.isItemSelected && options.onItemSelectionChange) {
            const checkbox = rowEl.createEl('input', {
                cls: 'image-browser-selection-checkbox',
                attr: {
                    type: 'checkbox',
                    'aria-label': options.selectionLabel?.(item) ?? options.getName(item),
                },
            });
            checkbox.checked = selected;
            checkbox.addEventListener('change', () => {
                options.onItemSelectionChange?.(item, checkbox.checked);
                itemButton.toggleClass('is-selected', checkbox.checked);
            });
        }
        const itemButton = rowEl.createEl('button', {
            cls: selected
                ? 'image-browser-tree-item is-selected'
                : 'image-browser-tree-item',
        });
        itemButton.setAttribute('title', options.getPath(item));
        itemButton.createEl('img', {
            cls: 'image-browser-tree-thumbnail',
            attr: { src: options.getImageUrl(item), alt: '' },
        });
        itemButton.createSpan({
            cls: 'image-browser-tree-item-name',
            text: options.getName(item),
        });
        itemButton.createSpan({
            cls: 'image-browser-tree-item-meta',
            text: options.getMeta(item),
        });
        itemButton.addEventListener('click', () => options.openItem(item));
    }
}
