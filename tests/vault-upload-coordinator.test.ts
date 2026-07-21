import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    images: [] as unknown[],
    upload: vi.fn(),
    trashFile: vi.fn(),
    trashEmptyDirectories: vi.fn(),
    notices: [] as string[],
}));

vi.mock('obsidian', () => ({
    Notice: class {
        constructor(message: string) { mocks.notices.push(message); }
    },
    Plugin: class {
        app: unknown;
        constructor(app: unknown) { this.app = app; }
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
vi.mock('../src/utils/image-scanner', () => ({
    ImageScanner: class { getAllImages = () => mocks.images; },
}));
vi.mock('../src/utils/batch-rename', () => ({ BatchRename: class {} }));
vi.mock('../src/utils/image-reorganizer', () => ({ ImageReorganizer: class {} }));
vi.mock('../src/uploaders/uploader-factory', () => ({
    createUploader: () => ({ upload: mocks.upload }),
}));
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
    const app = {
        vault: { readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(1)) },
        fileManager: { trashFile: mocks.trashFile },
    };
    const plugin = new ImageManagerPlugin(app as never, {} as never);
    plugin.settings = {
        reorganizeConvertFormat: true,
        autoReplaceAfterUpload: true,
        keepLocalCopy: false,
        hostingConfigs: [{ id: 'default', enabled: true }],
        defaultHostingId: 'default',
        supportedExtensions: ['png'],
        uploadPathTemplate: 'images/{filename}',
        autoCompress: false,
    } as never;
    return plugin;
}

function createImage(path: string) {
    const [parentPath, name] = path.split(/\/(?=[^/]+$)/);
    return { path, name: name ?? path, parent: parentPath ? { path: parentPath } : null };
}

describe('Vault upload coordinator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.images = [];
        mocks.notices = [];
        mocks.trashEmptyDirectories.mockResolvedValue({ trashed: [], failed: 0 });
    });

    it('stops before scanning when automatic replacement is disabled', async () => {
        const plugin = createPlugin();
        plugin.settings.autoReplaceAfterUpload = false;

        await plugin.uploadEntireVault();

        expect(mocks.upload).not.toHaveBeenCalled();
        expect(mocks.notices).toContain('notice.autoReplaceRequiredForVaultUpload');
    });

    it('stops before uploading when hosting features are disabled', async () => {
        const plugin = createPlugin();
        plugin.settings.reorganizeConvertFormat = false;
        mocks.images = [createImage('attachments/a.png')];

        await plugin.uploadEntireVault();

        expect(mocks.upload).not.toHaveBeenCalled();
        expect(mocks.notices).toContain('settings.hostingDisabledByFormat');
    });

    it('stops before uploading when no hosting configuration is enabled', async () => {
        const plugin = createPlugin();
        plugin.settings.hostingConfigs = [{ id: 'disabled', enabled: false }] as never;
        mocks.images = [createImage('attachments/a.png')];

        await plugin.uploadEntireVault();

        expect(mocks.upload).not.toHaveBeenCalled();
        expect(mocks.notices).toContain('notice.noHostingConfig');
    });

    it('stops before uploading when the vault has no local images', async () => {
        const plugin = createPlugin();

        await plugin.uploadEntireVault();

        expect(mocks.upload).not.toHaveBeenCalled();
        expect(mocks.notices).toContain('notice.noImagesToUpload');
    });

    it('uploads, replaces references, then trashes successful images and cleans their parents', async () => {
        const plugin = createPlugin();
        const image = createImage('attachments/a.png');
        mocks.images = [image];
        mocks.upload.mockImplementation(async () => ({ success: true, url: 'https://host/a.png' }));
        const replace = vi.fn(async () => undefined);
        (plugin as unknown as { replaceReferenceInNote: typeof replace }).replaceReferenceInNote = replace;
        mocks.trashFile.mockImplementation(async () => undefined);

        await plugin.uploadEntireVault();

        expect(mocks.upload).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'a.png', { sourcePath: 'attachments/a.png' });
        expect(replace).toHaveBeenCalledWith(image, 'https://host/a.png');
        expect(mocks.trashFile).toHaveBeenCalledWith(image);
        expect(mocks.trashEmptyDirectories).toHaveBeenCalledWith((plugin as unknown as { app: unknown }).app, ['attachments']);
        expect(replace.mock.invocationCallOrder[0]).toBeLessThan(mocks.trashFile.mock.invocationCallOrder[0]!);
    });

    it('keeps the local image and skips directory cleanup when keepLocalCopy is enabled', async () => {
        const plugin = createPlugin();
        plugin.settings.keepLocalCopy = true;
        const image = createImage('attachments/a.png');
        mocks.images = [image];
        mocks.upload.mockResolvedValue({ success: true, url: 'https://host/a.png' });
        const replace = vi.fn(async () => undefined);
        (plugin as unknown as { replaceReferenceInNote: typeof replace }).replaceReferenceInNote = replace;

        await plugin.uploadEntireVault();

        expect(replace).toHaveBeenCalledWith(image, 'https://host/a.png');
        expect(mocks.trashFile).not.toHaveBeenCalled();
        expect(mocks.trashEmptyDirectories).not.toHaveBeenCalled();
    });

    it('keeps images when upload or reference replacement fails', async () => {
        const plugin = createPlugin();
        const uploadFailed = createImage('attachments/upload-failed.png');
        const replaceFailed = createImage('attachments/replace-failed.png');
        mocks.images = [uploadFailed, replaceFailed];
        mocks.upload
            .mockResolvedValueOnce({ success: false, error: 'network' })
            .mockResolvedValueOnce({ success: true, url: 'https://host/replace-failed.png' });
        (plugin as unknown as { replaceReferenceInNote: () => Promise<void> }).replaceReferenceInNote = vi.fn(async () => {
            throw new Error('write failed');
        });

        await plugin.uploadEntireVault();

        expect(mocks.trashFile).not.toHaveBeenCalled();
        expect(mocks.trashEmptyDirectories).toHaveBeenCalledWith((plugin as unknown as { app: unknown }).app, []);
    });

    it('cleans the original parent when trashing clears the image parent', async () => {
        const plugin = createPlugin();
        const image = createImage('attachments/a.png');
        mocks.images = [image];
        mocks.upload.mockResolvedValue({ success: true, url: 'https://host/a.png' });
        (plugin as unknown as { replaceReferenceInNote: () => Promise<void> }).replaceReferenceInNote = vi.fn(async () => undefined);
        mocks.trashFile.mockImplementation(async (file: { parent: unknown }) => { file.parent = null; });

        await plugin.uploadEntireVault();

        expect(mocks.trashEmptyDirectories).toHaveBeenCalledWith((plugin as unknown as { app: unknown }).app, ['attachments']);
    });

    it('does not start a second vault upload while one is running', async () => {
        const plugin = createPlugin();
        mocks.images = [createImage('attachments/a.png')];
        let completeUpload: ((result: { success: boolean; url: string }) => void) | undefined;
        mocks.upload.mockImplementationOnce(() => new Promise((resolve) => { completeUpload = resolve; }));

        const firstRun = plugin.uploadEntireVault();
        const secondRun = plugin.uploadEntireVault();

        await Promise.resolve();
        expect(mocks.upload).toHaveBeenCalledTimes(1);
        completeUpload?.({ success: true, url: 'https://host/a.png' });
        await firstRun;
        await secondRun;
    });

    it('does not start vault reorganization while a vault upload is running', async () => {
        const plugin = createPlugin();
        mocks.images = [createImage('attachments/a.png')];
        let completeUpload: ((result: { success: boolean; url: string }) => void) | undefined;
        mocks.upload.mockImplementationOnce(() => new Promise((resolve) => { completeUpload = resolve; }));

        const upload = plugin.uploadEntireVault();
        await Promise.resolve();
        await plugin.reorganizeEntireVault();

        expect(mocks.notices).toContain('notice.vaultActionInProgress');
        completeUpload?.({ success: true, url: 'https://host/a.png' });
        await upload;
    });
});
