import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    reorganizeFolderWithCleanupInfo: vi.fn(),
    trashEmptyDirectories: vi.fn(),
    notices: [] as string[],
}));

vi.mock('obsidian', () => ({
    Notice: class {
        constructor(message: string) { mocks.notices.push(message); }
    },
    Plugin: class {
        app: unknown;
        constructor(app: unknown) {
            this.app = app;
        }
    },
    TFile: class {},
    TFolder: class {},
    MarkdownView: class {},
    SuggestModal: class {},
    normalizePath: (path: string) => path,
}));

vi.mock('../src/settings', () => ({ ImageManagerSettingTab: class {} }));
vi.mock('../src/modals/image-browser', () => ({ ImageBrowserModal: class {} }));
vi.mock('../src/modals/orphan-images', () => ({ OrphanImagesModal: class {} }));
vi.mock('../src/modals/rename-image', () => ({ RenameImageModal: class {} }));
vi.mock('../src/modals/image-name-prompt', () => ({ ImageNamePromptModal: class {} }));
vi.mock('../src/utils/ref-converter', () => ({ RefConverter: class {} }));
vi.mock('../src/utils/image-optimizer', () => ({ ImageOptimizer: class {} }));
vi.mock('../src/utils/image-scanner', () => ({ ImageScanner: class {} }));
vi.mock('../src/utils/batch-rename', () => ({ BatchRename: class {} }));
vi.mock('../src/utils/image-reorganizer', () => ({
    ImageReorganizer: class {
        reorganizeFolderWithCleanupInfo = mocks.reorganizeFolderWithCleanupInfo;
    },
}));
vi.mock('../src/uploaders/uploader-factory', () => ({ createUploader: vi.fn() }));
vi.mock('../src/uploaders/upload-queue', () => ({ UploadQueue: class {} }));
vi.mock('../src/i18n', () => ({ setLocale: vi.fn(), t: (key: string) => key }));
vi.mock('../src/utils/path-utils', () => ({
    getDateTemplateVars: vi.fn(), getFileNameWithoutExt: vi.fn(), encodePathSegments: vi.fn(),
}));
vi.mock('../src/utils/public-url', () => ({ makePublicUrlReadable: (url: string) => url }));
vi.mock('../src/utils/empty-folder-cleaner', () => ({ EmptyFolderCleaner: class {} }));
vi.mock('../src/utils/empty-directory-cleanup', () => ({
    trashEmptyDirectories: mocks.trashEmptyDirectories,
}));
vi.mock('../src/utils/image-name-template', () => ({ renderImageNameTemplate: vi.fn(), sanitizeImageFileName: vi.fn() }));
vi.mock('../src/types', () => ({ DEFAULT_SETTINGS: {} }));

import ImageManagerPlugin from '../src/main';

function createPlugin() {
    const plugin = new ImageManagerPlugin({} as never, {} as never);
    plugin.settings = { reorganizeConvertFormat: true } as never;
    return plugin;
}

describe('Vault reorganization coordinator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.notices = [];
    });

    it('reorganizes the entire vault and cleans the parents of moved images', async () => {
        mocks.reorganizeFolderWithCleanupInfo.mockResolvedValue({
            notes: 2, moved: 3, skipped: 1, failed: 0, movedParentPaths: ['attachments/2026'],
        });
        mocks.trashEmptyDirectories.mockResolvedValue({ trashed: ['attachments/2026'], failed: 0 });
        const plugin = createPlugin();

        await plugin.reorganizeEntireVault();

        expect(mocks.reorganizeFolderWithCleanupInfo).toHaveBeenCalledWith('', 'markdown');
        expect(mocks.trashEmptyDirectories).toHaveBeenCalledWith(plugin.app, ['attachments/2026']);
    });

    it('resets the reorganization guard when vault reorganization fails', async () => {
        mocks.reorganizeFolderWithCleanupInfo.mockRejectedValue(new Error('move failed'));
        const plugin = createPlugin();

        await plugin.reorganizeEntireVault();

        expect((plugin as unknown as { isReorganizing: boolean }).isReorganizing).toBe(false);
        expect(mocks.trashEmptyDirectories).not.toHaveBeenCalled();
    });

    it('does not start a second vault reorganization while one is running', async () => {
        let completeReorganization: ((value: {
            notes: number;
            moved: number;
            skipped: number;
            failed: number;
            movedParentPaths: string[];
        }) => void) | undefined;
        const completedResult = { notes: 1, moved: 0, skipped: 0, failed: 0, movedParentPaths: [] };
        mocks.reorganizeFolderWithCleanupInfo.mockImplementationOnce(() => new Promise((resolve) => {
            completeReorganization = resolve;
        })).mockResolvedValue(completedResult);
        mocks.trashEmptyDirectories.mockResolvedValue({ trashed: [], failed: 0 });
        const plugin = createPlugin();

        const firstRun = plugin.reorganizeEntireVault();
        const secondRun = plugin.reorganizeEntireVault();

        expect(mocks.reorganizeFolderWithCleanupInfo).toHaveBeenCalledTimes(1);

        completeReorganization?.(completedResult);
        await firstRun;
        await secondRun;
    });

    it('does not start a vault upload while vault reorganization is running', async () => {
        let completeReorganization: ((value: {
            notes: number;
            moved: number;
            skipped: number;
            failed: number;
            movedParentPaths: string[];
        }) => void) | undefined;
        mocks.reorganizeFolderWithCleanupInfo.mockImplementationOnce(() => new Promise((resolve) => {
            completeReorganization = resolve;
        }));
        const plugin = createPlugin();

        const reorganization = plugin.reorganizeEntireVault();
        await plugin.uploadEntireVault();

        expect(mocks.notices).toContain('notice.vaultActionInProgress');
        completeReorganization?.({ notes: 1, moved: 0, skipped: 0, failed: 0, movedParentPaths: [] });
        await reorganization;
    });
});
