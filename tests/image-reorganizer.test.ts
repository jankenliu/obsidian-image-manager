import { describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import type { ImageManagerSettings } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/types';

const mockClasses = vi.hoisted(() => {
    class MockTFolder {
        path = '';
    }

    class MockTFile {
        path = '';
        parent: MockTFolder | null = null;

        get name(): string {
            return this.path.split('/').pop() ?? this.path;
        }

        get extension(): string {
            return this.name.split('.').pop() ?? '';
        }
    }

    return { MockTFile, MockTFolder };
});

vi.mock('obsidian', () => ({
    TFile: mockClasses.MockTFile,
    TFolder: mockClasses.MockTFolder,
    normalizePath: (path: string) => path
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .replace(/\/{2,}/g, '/'),
}));

import { TFile as RuntimeTFile, TFolder as RuntimeTFolder } from 'obsidian';
import { ImageReorganizer } from '../src/utils/image-reorganizer';

interface Harness {
    app: App;
    contents: Map<string, string>;
    files: Map<string, TFile>;
    adapterOnlyPaths: Set<string>;
    occupyOnSecondAdapterCheck: Set<string>;
    onSecondAdapterCheck: Map<string, () => void>;
    occupyDuringRename: Set<string>;
    updateBeforeProcess: Map<string, (content: string) => string>;
    metadataDestinations: Map<string, TFile>;
    getFirstLinkpathDest: ReturnType<typeof vi.fn>;
    rename: ReturnType<typeof vi.fn>;
    failRenameFrom: Set<string>;
}

function parentPath(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash < 0 ? '' : path.substring(0, slash);
}

function createFile(path: string): TFile {
    const file = new RuntimeTFile();
    file.path = path;
    const parent = new RuntimeTFolder();
    parent.path = parentPath(path);
    file.parent = parent;
    return file;
}

function createHarness(initial: Record<string, string | null>): Harness {
    const files = new Map<string, TFile>();
    const contents = new Map<string, string>();
    const adapterOnlyPaths = new Set<string>();
    const occupyOnSecondAdapterCheck = new Set<string>();
    const onSecondAdapterCheck = new Map<string, () => void>();
    const occupyDuringRename = new Set<string>();
    const updateBeforeProcess = new Map<string, (content: string) => string>();
    const adapterCheckCounts = new Map<string, number>();
    const metadataDestinations = new Map<string, TFile>();
    const failRenameFrom = new Set<string>();

    for (const [path, content] of Object.entries(initial)) {
        files.set(path, createFile(path));
        if (content !== null) contents.set(path, content);
    }

    const rename = vi.fn(async (file: TFile, newPath: string) => {
        const oldPath = file.path;
        if (failRenameFrom.has(oldPath)) throw new Error('模拟移动失败');
        if (occupyDuringRename.delete(newPath)) {
            files.set(newPath, createFile(newPath));
            throw new Error('目标文件已存在');
        }
        if (files.has(newPath) || adapterOnlyPaths.has(newPath)) {
            throw new Error('目标文件已存在');
        }
        files.delete(oldPath);
        file.path = newPath;
        const parent = new RuntimeTFolder();
        parent.path = parentPath(newPath);
        file.parent = parent;
        files.set(newPath, file);
    });

    const getFirstLinkpathDest = vi.fn((linkpath: string, sourcePath: string) =>
        metadataDestinations.get(`${sourcePath}|${linkpath}`) ?? null
    );

    const app = {
        metadataCache: { getFirstLinkpathDest },
        vault: {
            getAbstractFileByPath: (path: string) => files.get(path) ?? null,
            adapter: {
                exists: async (path: string) => {
                    const checks = (adapterCheckCounts.get(path) ?? 0) + 1;
                    adapterCheckCounts.set(path, checks);
                    if (checks === 2) onSecondAdapterCheck.get(path)?.();
                    return files.has(path) ||
                        adapterOnlyPaths.has(path) ||
                        (occupyOnSecondAdapterCheck.has(path) && checks >= 2);
                },
            },
            getFiles: () => [...files.values()],
            getMarkdownFiles: () => [...files.values()].filter((file) => file.extension === 'md'),
            cachedRead: async (file: TFile) => contents.get(file.path) ?? '',
            process: async (file: TFile, update: (content: string) => string) => {
                let currentContent = contents.get(file.path) ?? '';
                const concurrentUpdate = updateBeforeProcess.get(file.path);
                if (concurrentUpdate) {
                    currentContent = concurrentUpdate(currentContent);
                    updateBeforeProcess.delete(file.path);
                }
                contents.set(file.path, update(currentContent));
            },
            createFolder: async () => undefined,
            rename,
        },
    } as unknown as App;

    return {
        app,
        contents,
        files,
        adapterOnlyPaths,
        occupyOnSecondAdapterCheck,
        onSecondAdapterCheck,
        occupyDuringRename,
        updateBeforeProcess,
        metadataDestinations,
        getFirstLinkpathDest,
        rename,
        failRenameFrom,
    };
}

function createSettings(overrides: Partial<ImageManagerSettings> = {}): ImageManagerSettings {
    return { ...DEFAULT_SETTINGS, imagePathBase: 'note', ...overrides };
}

function resolveImagePath(_template: string, note: TFile | null): string {
    const noteDir = note?.parent?.path ?? '';
    return noteDir ? `${noteDir}/attachments` : 'attachments';
}

describe('图片资源整理命名', () => {
    it('优先使用 metadataCache 解析来源笔记并移动其指定的重名图片', async () => {
        const harness = createHarness({
            'notes/note.md': '![图片](images/shared%20image.png)',
            'images/shared image.png': null,
            'notes/images/shared image.png': null,
        });
        const rootImage = harness.files.get('images/shared image.png')!;
        const linkedImage = harness.files.get('notes/images/shared image.png')!;
        harness.metadataDestinations.set(
            'notes/note.md|images/shared image.png',
            linkedImage
        );
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'selected-{counter}' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        expect(harness.getFirstLinkpathDest).toHaveBeenCalledWith(
            'images/shared image.png',
            'notes/note.md'
        );
        expect(result).toMatchObject({ moved: 1, skipped: 0, failed: 0 });
        expect(harness.files.get('images/shared image.png')).toBe(rootImage);
        expect(harness.files.has('notes/images/shared image.png')).toBe(false);
        expect(harness.files.get('notes/attachments/selected-0.png')).toBe(linkedImage);
        expect(harness.contents.get('notes/note.md')).toBe(
            '![图片](attachments/selected-0.png)'
        );
    });

    it('metadataCache 未命中且同名图片不唯一时跳过而不任意移动', async () => {
        const harness = createHarness({
            'notes/note.md': '![图片](shared.png)',
            'assets/shared.png': null,
            'other/shared.png': null,
        });
        const first = harness.files.get('assets/shared.png');
        const second = harness.files.get('other/shared.png');
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'image-{counter}' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        expect(harness.getFirstLinkpathDest).toHaveBeenCalledWith(
            'shared.png',
            'notes/note.md'
        );
        expect(result).toMatchObject({ moved: 0, skipped: 1, failed: 0 });
        expect(harness.rename).not.toHaveBeenCalled();
        expect(harness.files.get('assets/shared.png')).toBe(first);
        expect(harness.files.get('other/shared.png')).toBe(second);
        expect(harness.contents.get('notes/note.md')).toBe('![图片](shared.png)');
    });

    it('裸文件名在来源目录和其他目录重名时不优先来源目录', async () => {
        const harness = createHarness({
            'notes/note.md': '![图片](shared.png)',
            'notes/shared.png': null,
            'other/shared.png': null,
        });
        const noteImage = harness.files.get('notes/shared.png');
        const otherImage = harness.files.get('other/shared.png');
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'image-{counter}' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        expect(result).toMatchObject({ moved: 0, skipped: 1, failed: 0 });
        expect(harness.rename).not.toHaveBeenCalled();
        expect(harness.files.get('notes/shared.png')).toBe(noteImage);
        expect(harness.files.get('other/shared.png')).toBe(otherImage);
        expect(harness.contents.get('notes/note.md')).toBe('![图片](shared.png)');
    });

    it('metadataCache 返回非受支持文件时不再回退到同名图片', async () => {
        const harness = createHarness({
            'notes/note.md': '![图片](shared.png)',
            'notes/not-image.md': '',
            'assets/shared.png': null,
        });
        harness.metadataDestinations.set(
            'notes/note.md|shared.png',
            harness.files.get('notes/not-image.md')!
        );
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'image-{counter}' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        expect(result).toMatchObject({ moved: 0, skipped: 1, failed: 0 });
        expect(harness.rename).not.toHaveBeenCalled();
        expect(harness.files.has('assets/shared.png')).toBe(true);
        expect(harness.contents.get('notes/note.md')).toBe('![图片](shared.png)');
    });

    it('带路径引用未命中时不回退到其他目录的同名图片', async () => {
        const harness = createHarness({
            'notes/note.md': '![图片](missing/shared.png)',
            'other/shared.png': null,
        });
        const otherImage = harness.files.get('other/shared.png');
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'image-{counter}' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        expect(result).toMatchObject({ moved: 0, skipped: 1, failed: 0 });
        expect(harness.rename).not.toHaveBeenCalled();
        expect(harness.files.get('other/shared.png')).toBe(otherImage);
        expect(harness.contents.get('notes/note.md')).toBe(
            '![图片](missing/shared.png)'
        );
    });

    it('二次冲突重分配复用首次命名时间并追加原基本名后缀', async () => {
        vi.useFakeTimers();
        try {
            const initialTime = new Date(2026, 6, 21, 8, 0, 0);
            const laterTime = new Date(2026, 6, 21, 9, 0, 0);
            vi.setSystemTime(initialTime);
            const initialName = `base-${initialTime.getTime()}.png`;
            const initialPath = `notes/attachments/${initialName}`;
            const harness = createHarness({
                'notes/note.md': '![图片](../assets/old.png)',
                'assets/old.png': null,
            });
            harness.occupyOnSecondAdapterCheck.add(initialPath);
            harness.onSecondAdapterCheck.set(initialPath, () => {
                vi.setSystemTime(laterTime);
            });
            const reorganizer = new ImageReorganizer(
                harness.app,
                createSettings({ imageNamingTemplate: 'base-{timestamp}' }),
                resolveImagePath
            );

            const result = await reorganizer.reorganizeNote(
                harness.files.get('notes/note.md')!,
                'markdown'
            );

            expect(result).toMatchObject({ moved: 1, skipped: 0, failed: 0 });
            expect(harness.files.has(
                `notes/attachments/base-${initialTime.getTime()}-1.png`
            )).toBe(true);
            expect(harness.files.has(
                `notes/attachments/base-${laterTime.getTime()}.png`
            )).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('rename 时目标被竞争者创建后重新分配并保留竞争文件', async () => {
        const harness = createHarness({
            'notes/note.md': '![图片](../assets/old.png)',
            'assets/old.png': null,
        });
        const sourceImage = harness.files.get('assets/old.png');
        harness.occupyDuringRename.add('notes/attachments/photo.png');
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'photo' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        const competingFile = harness.files.get('notes/attachments/photo.png');
        expect(result).toMatchObject({ moved: 1, skipped: 0, failed: 0 });
        expect(harness.rename).toHaveBeenCalledTimes(2);
        expect(competingFile).toBeDefined();
        expect(competingFile).not.toBe(sourceImage);
        expect(harness.files.get('notes/attachments/photo-1.png')).toBe(sourceImage);
        expect(harness.contents.get('notes/note.md')).toBe(
            '![图片](attachments/photo-1.png)'
        );
    });

    it('process 前仅修改 alt 时保留新 alt 并更新已移动路径', async () => {
        const harness = createHarness({
            'notes/note.md': '![旧说明](../assets/old.png)',
            'assets/old.png': null,
        });
        harness.updateBeforeProcess.set('notes/note.md', (content) =>
            content.replace('旧说明', '新说明')
        );
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'image-{counter}' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        expect(result).toMatchObject({ moved: 1, skipped: 0, failed: 0 });
        expect(harness.contents.get('notes/note.md')).toBe(
            '![新说明](attachments/image-0.png)'
        );
    });

    it('未指定转换格式时保留 process 前改成的 Wiki 格式', async () => {
        const harness = createHarness({
            'notes/note.md': '![旧说明](../assets/old.png)',
            'assets/old.png': null,
        });
        harness.updateBeforeProcess.set('notes/note.md', () =>
            '![[../assets/old.png|新别名]]'
        );
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'image-{counter}' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!
        );

        expect(result).toMatchObject({ moved: 1, skipped: 0, failed: 0 });
        expect(harness.contents.get('notes/note.md')).toBe(
            '![[image-0.png|新别名]]'
        );
    });

    it('明确要求 Markdown 时覆盖 process 前的 Wiki 格式变化', async () => {
        const harness = createHarness({
            'notes/note.md': '![旧说明](../assets/old.png)',
            'assets/old.png': null,
        });
        harness.updateBeforeProcess.set('notes/note.md', () =>
            '![[../assets/old.png|新别名]]'
        );
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'image-{counter}' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        expect(result).toMatchObject({ moved: 1, skipped: 0, failed: 0 });
        expect(harness.contents.get('notes/note.md')).toBe(
            '![新别名](attachments/image-0.png)'
        );
    });

    it('按配置 counter 模板重命名并更新重复引用', async () => {
        const harness = createHarness({
            'notes/note.md': '![第一处](../assets/old.png)\n![第二处](../assets/old.png)',
            'assets/old.png': null,
        });
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'image-{counter}' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        expect(result).toMatchObject({ moved: 1, skipped: 0, failed: 0 });
        expect(harness.rename).toHaveBeenCalledTimes(1);
        expect(harness.files.has('notes/attachments/image-0.png')).toBe(true);
        expect(harness.contents.get('notes/note.md')).toBe(
            '![第一处](attachments/image-0.png)\n![第二处](attachments/image-0.png)'
        );
    });

    it('目标目录已有 counter 名称时继续递增且不覆盖', async () => {
        const harness = createHarness({
            'notes/note.md': '![图片](../assets/old.png)',
            'assets/old.png': null,
            'notes/attachments/image-0.png': null,
        });
        const existing = harness.files.get('notes/attachments/image-0.png');
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'image-{counter}' }),
            resolveImagePath
        );

        await reorganizer.reorganizeNote(harness.files.get('notes/note.md')!, 'markdown');

        expect(harness.files.get('notes/attachments/image-0.png')).toBe(existing);
        expect(harness.files.has('notes/attachments/image-1.png')).toBe(true);
    });

    it('移动前发现规划后出现的新冲突时重新分配名称', async () => {
        const harness = createHarness({
            'notes/note.md': '![图片](../assets/old.png)',
            'assets/old.png': null,
        });
        harness.occupyOnSecondAdapterCheck.add('notes/attachments/image-0.png');
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'image-{counter}' }),
            resolveImagePath
        );

        await reorganizer.reorganizeNote(harness.files.get('notes/note.md')!, 'markdown');

        expect(harness.files.has('notes/attachments/image-0.png')).toBe(false);
        expect(harness.files.has('notes/attachments/image-1.png')).toBe(true);
        expect(harness.contents.get('notes/note.md')).toBe(
            '![图片](attachments/image-1.png)'
        );
    });

    it('重新分配后的目标等于源文件时不执行同路径移动', async () => {
        const harness = createHarness({
            'notes/note.md': '![[image-1.png|封面]]',
            'notes/attachments/image-1.png': null,
        });
        harness.occupyOnSecondAdapterCheck.add('notes/attachments/image-0.png');
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({
                imageNamingTemplate: 'image-{counter}',
                skipWikiRefsOnReorganize: false,
            }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        expect(result).toMatchObject({ moved: 0, skipped: 0, failed: 0 });
        expect(harness.rename).not.toHaveBeenCalled();
        expect(harness.contents.get('notes/note.md')).toBe(
            '![封面](attachments/image-1.png)'
        );
    });

    it('同时检查 adapter 占用并为无 counter 模板追加后缀', async () => {
        const harness = createHarness({
            'notes/note.md': '![图片](../assets/old.png)',
            'assets/old.png': null,
            'notes/attachments/photo.png': null,
        });
        harness.adapterOnlyPaths.add('notes/attachments/photo-1.png');
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'photo' }),
            resolveImagePath
        );

        await reorganizer.reorganizeNote(harness.files.get('notes/note.md')!, 'markdown');

        expect(harness.files.has('notes/attachments/photo-2.png')).toBe(true);
        expect(harness.adapterOnlyPaths.has('notes/attachments/photo-1.png')).toBe(true);
    });

    it('把本次任务尚未移动的预留路径视为冲突', async () => {
        const harness = createHarness({
            'notes/note.md': '![A](../assets/a.png)\n![B](../assets/b.png)',
            'assets/a.png': null,
            'assets/b.png': null,
        });
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'photo' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        expect(result).toMatchObject({ moved: 2, skipped: 0, failed: 0 });
        expect(harness.files.has('notes/attachments/photo.png')).toBe(true);
        expect(harness.files.has('notes/attachments/photo-1.png')).toBe(true);
    });

    it('候选路径就是源图片时不移动但仍执行格式转换并保留 Wiki alias', async () => {
        const harness = createHarness({
            'notes/note.md': '![[image-0.png|封面]]',
            'notes/attachments/image-0.png': null,
        });
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({
                imageNamingTemplate: 'image-{counter}',
                skipWikiRefsOnReorganize: false,
            }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        expect(result).toMatchObject({ moved: 0, skipped: 0, failed: 0 });
        expect(harness.rename).not.toHaveBeenCalled();
        expect(harness.contents.get('notes/note.md')).toBe(
            '![封面](attachments/image-0.png)'
        );
    });

    it('文件夹整理在全部笔记之间共享 counter', async () => {
        const harness = createHarness({
            'notes/a.md': '![A](../assets/a.png)',
            'notes/b.md': '![B](../assets/b.png)',
            'assets/a.png': null,
            'assets/b.png': null,
        });
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'image-{counter}' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeFolder('notes', 'markdown');

        expect(result).toMatchObject({ moved: 2, skipped: 0, failed: 0, notes: 2 });
        expect(harness.files.has('notes/attachments/image-0.png')).toBe(true);
        expect(harness.files.has('notes/attachments/image-1.png')).toBe(true);
    });

    it('同一图片跨笔记引用时只移动一次并更新全部引用', async () => {
        const harness = createHarness({
            'notes/a.md': '![A](../assets/shared.png)',
            'other/b.md': '![B](../assets/shared.png)',
            'assets/shared.png': null,
        });
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'shared-{counter}' }),
            resolveImagePath
        );

        await reorganizer.reorganizeNote(harness.files.get('notes/a.md')!, 'markdown');

        expect(harness.rename).toHaveBeenCalledTimes(1);
        expect(harness.contents.get('notes/a.md')).toBe('![A](attachments/shared-0.png)');
        expect(harness.contents.get('other/b.md')).toBe(
            '![B](../notes/attachments/shared-0.png)'
        );
    });

    it('单张图片移动失败时保留原引用并继续其他图片', async () => {
        const harness = createHarness({
            'notes/note.md': '![失败](../failed/a.png)\n![成功](../assets/b.png)',
            'failed/a.png': null,
            'assets/b.png': null,
        });
        harness.failRenameFrom.add('failed/a.png');
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'image-{counter}' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        expect(result).toMatchObject({ moved: 1, skipped: 0, failed: 1 });
        expect(result.movedParentPaths).toEqual(new Set(['assets']));
        expect(harness.contents.get('notes/note.md')).toContain('![失败](../failed/a.png)');
        expect(harness.contents.get('notes/note.md')).toContain(
            '![成功](attachments/image-1.png)'
        );
    });

    it('保持 Vault 路径、Markdown 编码和 Wiki alias 语义', async () => {
        const harness = createHarness({
            'notes/note.md': '![图片](../assets/a.png)\n![[b.png|别名]]',
            'assets/a.png': null,
            'assets/b.png': null,
        });
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({
                imageNamingTemplate: '图片-{unknown}-{counter}',
                imagePathBase: 'vault',
                skipWikiRefsOnReorganize: false,
            }),
            resolveImagePath
        );

        await reorganizer.reorganizeNote(harness.files.get('notes/note.md')!);

        expect(harness.contents.get('notes/note.md')).toBe(
            '![图片](notes/attachments/图片-%7Bunknown%7D-0.png)\n' +
            '![[图片-{unknown}-1.png|别名]]'
        );
    });

    it('继续跳过设置要求忽略的 Wiki 引用', async () => {
        const harness = createHarness({
            'notes/note.md': '![[old.png|别名]]',
            'assets/old.png': null,
        });
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({
                imageNamingTemplate: 'image-{counter}',
                skipWikiRefsOnReorganize: true,
            }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(harness.files.get('notes/note.md')!);

        expect(result).toMatchObject({ moved: 0, skipped: 1, failed: 0 });
        expect(harness.rename).not.toHaveBeenCalled();
        expect(harness.contents.get('notes/note.md')).toBe('![[old.png|别名]]');
    });

    it('仅在图片实际移动成功后报告其原父目录', async () => {
        const harness = createHarness({
            'notes/note.md': '![图片](../assets/old.png)',
            'assets/old.png': null,
        });
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'image-{counter}' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        expect(result.movedParentPaths).toEqual(new Set(['assets']));
    });

    it('不报告 Vault 根目录作为已移动图片的父目录', async () => {
        const harness = createHarness({
            'notes/note.md': '![图片](old.png)',
            'old.png': null,
        });
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'image-{counter}' }),
            resolveImagePath
        );

        const result = await reorganizer.reorganizeNote(
            harness.files.get('notes/note.md')!,
            'markdown'
        );

        expect(result.movedParentPaths).toEqual(new Set());
    });
});
