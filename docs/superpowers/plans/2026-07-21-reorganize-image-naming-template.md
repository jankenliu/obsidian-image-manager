# 整理图片资源应用命名模板实施计划

> **供执行代理使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项执行。所有步骤使用复选框跟踪。

**目标：** 执行“整理图片资源”时，按照当前配置的图片命名模板重命名图片，在单次任务内连续分配 `{counter}`，避免覆盖目标目录中的任何已有文件，并正确更新全部相关引用。

**架构：** 新增一个无状态的命名模板工具，让粘贴/拖放和资源整理共享变量替换与文件名清理规则。`ImageReorganizer` 建立任务级上下文，先解析引用和规划唯一目标路径，再移动不同图片，最后依据旧路径到最终路径的映射更新当前范围及其他笔记中的引用。

**技术栈：** TypeScript 5.8、Obsidian Plugin API、Vitest 4、npm、esbuild。

## 全局约束

- 所有对话、文档、注释和用户可见错误均使用中文；英文国际化文案保持 sentence case。
- 包管理器固定使用 npm，Node.js 固定为项目 Volta 配置的 `22.22.3`。
- 不增加任何运行时依赖，插件继续保持零外部运行时依赖。
- 使用当前 `settings.imageNamingTemplate` 的完整值，只替换模板中实际出现的受支持变量，不强制添加 `{timestamp}` 或其他变量。
- 每次单篇或文件夹整理命令都创建独立计数器，`{counter}` 从 `0` 开始；同一图片只消耗一个最终接受的计数序列位置。
- 目标占用检查必须同时覆盖 Vault 内存映射、底层适配器和本次任务预留路径；不得覆盖已有文件。
- 图片扩展名、图片内容、现有路径基准和引用格式设置语义保持不变。
- 行为实现后更新 `.agents/skills/obsidian-image-manager/` 下的规范文档。
- 不修改或提交用户现有的未跟踪 `.codex/` 目录，不提交 `main.js`、`node_modules/` 等构建产物。
- 完成实现后必须通过 `npm test` 和 `npm run build`。

## 文件结构

- 新建 `src/utils/image-name-template.ts`：唯一的命名模板渲染、清理和后缀追加实现。
- 新建 `tests/image-name-template.test.ts`：模板变量、清理、扩展名和后缀单元测试。
- 修改 `src/main.ts`：粘贴/拖放改用共享命名工具；整理通知增加失败数量。
- 重构 `src/utils/image-reorganizer.ts`：任务上下文、去重规划、冲突分配、失败隔离和跨笔记引用更新。
- 新建 `tests/image-reorganizer.test.ts`：整理命名、冲突、共享引用、文件夹计数和失败隔离测试。
- 修改 `src/i18n/zh.ts`、`src/i18n/en.ts`：扩展命名模板说明和整理结果文案。
- 修改 `.agents/skills/obsidian-image-manager/references/architecture.md`、`paste-drop.md`、`image-reorganizer.md`、`settings.md`：同步最终行为。

---

### 任务 1：抽取共享图片命名模板工具

**文件：**

- 新建：`src/utils/image-name-template.ts`
- 新建：`tests/image-name-template.test.ts`
- 修改：`src/main.ts:16,711-746`
- 跟踪：`docs/superpowers/plans/2026-07-21-reorganize-image-naming-template.md`

**接口：**

- 输入：配置模板、图片原扩展名、调用方提供的计数值，以及可选的当前时间。
- 输出：`renderImageNameTemplate(template: string, extension: string, counter: number, now?: Date): string`。
- 输出：`sanitizeImageFileName(name: string, extension: string): string`，供手动命名只执行清理而不渲染模板变量。
- 输出：`imageNamingTemplateUsesCounter(template: string): boolean`，供整理器选择冲突策略。
- 输出：`appendImageNameSuffix(filename: string, suffix: number): string`，供无 `{counter}` 模板追加冲突后缀。

- [ ] **步骤 1：编写命名模板失败测试**

新建 `tests/image-name-template.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import {
    appendImageNameSuffix,
    imageNamingTemplateUsesCounter,
    renderImageNameTemplate,
    sanitizeImageFileName,
} from '../src/utils/image-name-template';

describe('图片命名模板', () => {
    const now = new Date(2026, 6, 21, 2, 3, 4, 5);

    it('只按照配置模板中出现的变量生成名称', () => {
        expect(renderImageNameTemplate('截图-{date}-{time}-{counter}', 'png', 0, now)).toBe(
            '截图-2026-07-21-020304-0.png'
        );
        expect(renderImageNameTemplate('固定名称', 'jpg', 8, now)).toBe('固定名称.jpg');
        expect(renderImageNameTemplate('图片-{unknown}-{counter}', 'png', 2, now)).toBe(
            '图片-{unknown}-2.png'
        );
    });

    it('保持现有时间变量语义', () => {
        expect(renderImageNameTemplate(
            '{year}-{month}-{day}-{timestamp}',
            'webp',
            3,
            now
        )).toBe(`2026-07-21-${now.getTime()}.webp`);
    });

    it('清理名称并保留一个原扩展名', () => {
        expect(renderImageNameTemplate('  我的  图片:*?.PNG', 'png', 0, now)).toBe('我的-图片.png');
        expect(renderImageNameTemplate('  :*?  ', 'svg', 0, now)).toBe('image.svg');
        expect(sanitizeImageFileName('photo.png ', 'png')).toBe('photo.png');
    });

    it('手动名称只执行清理而不替换模板变量', () => {
        expect(sanitizeImageFileName('自定义-{date}.PNG', 'png')).toBe('自定义-{date}.png');
    });

    it('规范化一个前导点并拒绝无效扩展名', () => {
        expect(renderImageNameTemplate('图片', '.png', 0, now)).toBe('图片.png');
        expect(() => sanitizeImageFileName('图片', '')).toThrow('图片扩展名不能为空');
        expect(() => sanitizeImageFileName('图片', '.')).toThrow('图片扩展名不能为空');

        for (const extension of ['p ng', 'png/jpg', 'png\\jpg', 'pn:g', 'pn*g']) {
            expect(() => renderImageNameTemplate('图片', extension, 0, now)).toThrow(
                '图片扩展名包含非法字符'
            );
        }
    });

    it('识别 counter 变量并追加普通冲突后缀', () => {
        expect(imageNamingTemplateUsesCounter('image-{counter}')).toBe(true);
        expect(imageNamingTemplateUsesCounter('image-{timestamp}')).toBe(false);
        expect(appendImageNameSuffix('photo.png', 2)).toBe('photo-2.png');
    });
});
```

- [ ] **步骤 2：运行测试并确认因模块缺失而失败**

运行：

```powershell
npm test -- tests/image-name-template.test.ts
```

预期：FAIL，Vitest 报告无法解析 `../src/utils/image-name-template`。

- [ ] **步骤 3：实现共享命名模板工具**

新建 `src/utils/image-name-template.ts`：

```typescript
const COUNTER_TOKEN = '{counter}';
const INVALID_EXTENSION_CHARACTERS = /[\s/\\:*?"<>|]/;

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeImageExtension(extension: string): string {
    const normalizedExtension = extension.replace(/^\./, '');
    if (!normalizedExtension) {
        throw new Error('图片扩展名不能为空');
    }
    if (INVALID_EXTENSION_CHARACTERS.test(normalizedExtension)) {
        throw new Error('图片扩展名包含非法字符');
    }
    return normalizedExtension;
}

export function sanitizeImageFileName(name: string, extension: string): string {
    const normalizedExtension = normalizeImageExtension(extension);
    const extensionPattern = new RegExp(
        `(?:\\.${escapeRegExp(normalizedExtension)})+$`,
        'i'
    );
    let base = name
        .replace(/\s+/g, '-')
        .replace(/[/\\:*?"<>|]/g, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
    base = base
        .replace(extensionPattern, '')
        .replace(/^-+|-+$/g, '');

    return `${base || 'image'}.${normalizedExtension}`;
}

export function imageNamingTemplateUsesCounter(template: string): boolean {
    return template.includes(COUNTER_TOKEN);
}

export function renderImageNameTemplate(
    template: string,
    extension: string,
    counter: number,
    now: Date = new Date()
): string {
    const variables: Record<string, string> = {
        date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
        time: `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`,
        timestamp: String(now.getTime()),
        year: String(now.getFullYear()),
        month: String(now.getMonth() + 1).padStart(2, '0'),
        day: String(now.getDate()).padStart(2, '0'),
        counter: String(counter),
    };

    let rendered = template;
    for (const [key, value] of Object.entries(variables)) {
        rendered = rendered.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }

    return sanitizeImageFileName(rendered, extension);
}

export function appendImageNameSuffix(filename: string, suffix: number): string {
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex <= 0) return `${filename}-${suffix}`;
    return `${filename.substring(0, dotIndex)}-${suffix}${filename.substring(dotIndex)}`;
}
```

- [ ] **步骤 4：运行模板测试并确认通过**

运行：

```powershell
npm test -- tests/image-name-template.test.ts
```

预期：该文件 6 个测试全部 PASS。

- [ ] **步骤 5：让粘贴和拖放改用共享工具**

在 `src/main.ts` 添加导入：

```typescript
import { renderImageNameTemplate, sanitizeImageFileName } from './utils/image-name-template';
```

将现有 `generateFileName` 改为下面的方法，并删除旧的 `sanitizeFileName`：

```typescript
private generateFileName(ext: string): string {
    return renderImageNameTemplate(
        this.settings.imageNamingTemplate,
        ext,
        this.pasteCounter++
    );
}
```

将手动命名回调中的清理调用改为共享函数，确保手动输入的 `{date}` 等文本不会被当作模板变量渲染：

```typescript
const safeName = sanitizeImageFileName(userNamed, ext);
```

- [ ] **步骤 6：验证共享工具没有破坏现有代码**

运行：

```powershell
npm test -- tests/image-name-template.test.ts tests/path-utils.test.ts
npm run build
```

预期：指定测试全部 PASS；构建依次通过 ESLint、TypeScript 和 esbuild。

- [ ] **步骤 7：提交共享命名工具**

```powershell
git add -- src/utils/image-name-template.ts tests/image-name-template.test.ts src/main.ts docs/superpowers/plans/2026-07-21-reorganize-image-naming-template.md
git commit -m "feat: 共享图片命名模板解析"
```

预期：提交只包含共享工具、对应测试、`src/main.ts` 和本实施计划。

---

### 任务 2：为资源整理实现任务级名称规划与引用更新

**文件：**

- 修改：`src/utils/image-reorganizer.ts:6-258`
- 新建：`tests/image-reorganizer.test.ts`

**接口：**

- 使用任务 1 的 `renderImageNameTemplate`、`imageNamingTemplateUsesCounter` 和 `appendImageNameSuffix`。
- `reorganizeNote(noteFile, convertFormat?)` 返回 `Promise<ReorganizeResult>`。
- `reorganizeFolder(folderPath, convertFormat?)` 返回 `Promise<ReorganizeResult & { notes: number }>`。
- `ReorganizeResult` 固定为 `{ moved: number; skipped: number; failed: number }`。
- 单篇和文件夹入口最终都调用一个私有 `reorganizeNotes(noteFiles, convertFormat)`，保证文件夹任务只创建一个计数上下文。

- [ ] **步骤 1：建立可验证的 Obsidian Vault 测试夹具**

新建 `tests/image-reorganizer.test.ts`，先加入以下夹具。该夹具使用内存 Map 模拟文件、笔记内容、适配器占用检查、文件夹创建、重命名和 `vault.process`：

```typescript
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
    const failRenameFrom = new Set<string>();

    for (const [path, content] of Object.entries(initial)) {
        files.set(path, createFile(path));
        if (content !== null) contents.set(path, content);
    }

    const rename = vi.fn(async (file: TFile, newPath: string) => {
        const oldPath = file.path;
        if (failRenameFrom.has(oldPath)) throw new Error('模拟移动失败');
        if (files.has(newPath)) throw new Error('目标文件已存在');
        files.delete(oldPath);
        file.path = newPath;
        const parent = new RuntimeTFolder();
        parent.path = parentPath(newPath);
        file.parent = parent;
        files.set(newPath, file);
    });

    const app = {
        vault: {
            getAbstractFileByPath: (path: string) => files.get(path) ?? null,
            adapter: { exists: async (path: string) => files.has(path) },
            getFiles: () => [...files.values()],
            getMarkdownFiles: () => [...files.values()].filter((file) => file.extension === 'md'),
            cachedRead: async (file: TFile) => contents.get(file.path) ?? '',
            process: async (file: TFile, update: (content: string) => string) => {
                contents.set(file.path, update(contents.get(file.path) ?? ''));
            },
            createFolder: async () => undefined,
            rename,
        },
    } as unknown as App;

    return { app, contents, files, rename, failRenameFrom };
}

function createSettings(overrides: Partial<ImageManagerSettings> = {}): ImageManagerSettings {
    return { ...DEFAULT_SETTINGS, imagePathBase: 'note', ...overrides };
}

function resolveImagePath(_template: string, note: TFile | null): string {
    const noteDir = note?.parent?.path ?? '';
    return noteDir ? `${noteDir}/attachments` : 'attachments';
}
```

- [ ] **步骤 2：编写单篇整理、冲突和去重失败测试**

在同一测试文件追加：

```typescript
describe('图片资源整理命名', () => {
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

        const note = harness.files.get('notes/note.md')!;
        const result = await reorganizer.reorganizeNote(note, 'markdown');

        expect(result).toEqual({ moved: 1, skipped: 0, failed: 0 });
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

    it('模板没有 counter 时在基本名称后追加递增后缀', async () => {
        const harness = createHarness({
            'notes/note.md': '![图片](../assets/old.png)',
            'assets/old.png': null,
            'notes/attachments/photo.png': null,
            'notes/attachments/photo-1.png': null,
        });
        const reorganizer = new ImageReorganizer(
            harness.app,
            createSettings({ imageNamingTemplate: 'photo' }),
            resolveImagePath
        );

        await reorganizer.reorganizeNote(harness.files.get('notes/note.md')!, 'markdown');

        expect(harness.files.has('notes/attachments/photo-2.png')).toBe(true);
    });

    it('候选路径就是源图片时不移动但仍执行格式转换', async () => {
        const harness = createHarness({
            'notes/note.md': '![[image-0.png]]',
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

        expect(result).toEqual({ moved: 0, skipped: 0, failed: 0 });
        expect(harness.rename).not.toHaveBeenCalled();
        expect(harness.contents.get('notes/note.md')).toBe(
            '![](attachments/image-0.png)'
        );
    });
});
```

- [ ] **步骤 3：运行整理器测试并确认现有实现不符合新行为**

运行：

```powershell
npm test -- tests/image-reorganizer.test.ts
```

预期：FAIL；现有整理器仍保留 `old.png`，并且结果没有 `failed`。

- [ ] **步骤 4：加入任务上下文和目标路径分配接口**

在 `src/utils/image-reorganizer.ts` 导入任务 1 的工具，并定义以下内部类型：

```typescript
import type { ImageReference } from '../types';
import {
    appendImageNameSuffix,
    imageNamingTemplateUsesCounter,
    renderImageNameTemplate,
} from './image-name-template';

export interface ReorganizeResult {
    moved: number;
    skipped: number;
    failed: number;
}

interface PlannedImage {
    file: TFile;
    sourcePath: string;
    targetPath: string;
    finalPath: string;
    noteFile: TFile;
    failed: boolean;
}

interface ReorganizeContext {
    nextCounter: number;
    reservedPaths: Set<string>;
    images: Map<string, PlannedImage>;
    moved: number;
    skipped: number;
    failed: number;
}

interface PlannedReference {
    ref: ImageReference;
    sourcePath: string | null;
    outputFormat: ReferenceFormat;
}

interface NotePlan {
    file: TFile;
    references: PlannedReference[];
}
```

加入下面的完整名称分配方法；`resolveImagePath` 必须接收最终候选文件名，因为图片路径模板可能使用 `{filename}`：

```typescript
private createContext(): ReorganizeContext {
    return {
        nextCounter: 0,
        reservedPaths: new Set<string>(),
        images: new Map<string, PlannedImage>(),
        moved: 0,
        skipped: 0,
        failed: 0,
    };
}

private async isTargetOccupied(
    path: string,
    sourcePath: string,
    context: ReorganizeContext,
    ownReservation?: string
): Promise<boolean> {
    if (path === sourcePath) return false;
    if (context.reservedPaths.has(path) && path !== ownReservation) return true;
    if (this.app.vault.getAbstractFileByPath(path)) return true;
    return this.app.vault.adapter.exists(path);
}

private async allocateTargetPath(
    file: TFile,
    noteFile: TFile,
    context: ReorganizeContext
): Promise<string> {
    const template = this.settings.imageNamingTemplate;
    const usesCounter = imageNamingTemplateUsesCounter(template);
    const now = new Date();
    let candidateCounter = context.nextCounter;
    let suffix = 0;

    while (true) {
        const rendered = renderImageNameTemplate(template, file.extension, candidateCounter, now);
        const filename = usesCounter || suffix === 0
            ? rendered
            : appendImageNameSuffix(rendered, suffix);
        const targetDir = this.resolveImagePath(
            this.settings.imagePathTemplate || 'attachments',
            noteFile,
            filename
        );
        const candidate = joinPath(targetDir, filename);

        if (!(await this.isTargetOccupied(candidate, file.path, context))) {
            context.reservedPaths.add(candidate);
            context.nextCounter = candidateCounter + 1;
            return candidate;
        }

        if (usesCounter) candidateCounter++;
        else suffix++;
    }
}
```

- [ ] **步骤 5：实现两阶段规划、移动和引用重写**

将公开入口改为共同调用 `reorganizeNotes`：

```typescript
async reorganizeNote(
    noteFile: TFile,
    convertFormat?: ReferenceFormat
): Promise<ReorganizeResult> {
    const result = await this.reorganizeNotes([noteFile], convertFormat);
    return { moved: result.moved, skipped: result.skipped, failed: result.failed };
}

async reorganizeFolder(
    folderPath: string,
    convertFormat?: ReferenceFormat
): Promise<ReorganizeResult & { notes: number }> {
    const noteFiles = this.app.vault.getMarkdownFiles().filter(
        (file) => file.path === folderPath || file.path.startsWith(`${folderPath}/`)
    );
    return this.reorganizeNotes(noteFiles, convertFormat);
}
```

`reorganizeNotes` 必须按以下完整时序组织现有辅助方法；先规划全部不同图片，再收集所有笔记中的引用，最后移动和改写：

```typescript
private async reorganizeNotes(
    noteFiles: TFile[],
    convertFormat?: ReferenceFormat
): Promise<ReorganizeResult & { notes: number }> {
    const context = this.createContext();
    const scopePaths = new Set(noteFiles.map((file) => file.path));
    const touchedNotes = new Set<string>();

    for (const noteFile of noteFiles) {
        const content = await this.app.vault.cachedRead(noteFile);
        const refs = this.refConverter.parseReferences(content);
        for (const ref of refs) {
            if (this.isExternalReference(ref.path)) continue;
            if (this.settings.skipWikiRefsOnReorganize && ref.format === 'wiki') {
                context.skipped++;
                touchedNotes.add(noteFile.path);
                continue;
            }

            const imageFile = this.resolveImageFromRef(ref.path);
            if (!imageFile) {
                context.skipped++;
                touchedNotes.add(noteFile.path);
                continue;
            }

            const sourcePath = imageFile.path;
            if (!context.images.has(sourcePath)) {
                const targetPath = await this.allocateTargetPath(imageFile, noteFile, context);
                context.images.set(sourcePath, {
                    file: imageFile,
                    sourcePath,
                    targetPath,
                    finalPath: sourcePath,
                    noteFile,
                    failed: false,
                });
            }
            touchedNotes.add(noteFile.path);
        }
    }

    const notePlans = await this.collectNotePlans(scopePaths, context, convertFormat);
    await this.movePlannedImages(context);
    await this.updatePlannedReferences(notePlans, context);

    return {
        moved: context.moved,
        skipped: context.skipped,
        failed: context.failed,
        notes: touchedNotes.size,
    };
}

private isExternalReference(path: string): boolean {
    return path.startsWith('http://') || path.startsWith('https://');
}
```

`collectNotePlans` 在移动前解析整个 Vault，使改名后的跨笔记引用仍能关联到旧源文件：

```typescript
private async collectNotePlans(
    scopePaths: Set<string>,
    context: ReorganizeContext,
    convertFormat?: ReferenceFormat
): Promise<NotePlan[]> {
    const plans: NotePlan[] = [];

    for (const noteFile of this.app.vault.getMarkdownFiles()) {
        const content = await this.app.vault.cachedRead(noteFile);
        const references = this.refConverter.parseReferences(content).map((ref) => {
            if (this.isExternalReference(ref.path)) {
                return { ref, sourcePath: null, outputFormat: ref.format };
            }
            const imageFile = this.resolveImageFromRef(ref.path);
            const sourcePath = imageFile?.path ?? null;
            const isTrigger = scopePaths.has(noteFile.path) && !(
                this.settings.skipWikiRefsOnReorganize && ref.format === 'wiki'
            );
            return {
                ref,
                sourcePath,
                outputFormat: isTrigger ? (convertFormat ?? ref.format) : ref.format,
            };
        });

        if (references.some((entry) => entry.sourcePath && context.images.has(entry.sourcePath))) {
            plans.push({ file: noteFile, references });
        }
    }

    return plans;
}
```

移动方法必须在执行前重新检查占用；新冲突出现时释放旧预留并重新分配。非冲突错误只标记当前图片失败：

```typescript
private async movePlannedImages(context: ReorganizeContext): Promise<void> {
    for (const image of context.images.values()) {
        if (image.targetPath === image.sourcePath) {
            image.finalPath = image.sourcePath;
            continue;
        }

        context.reservedPaths.delete(image.targetPath);
        if (await this.isTargetOccupied(image.targetPath, image.sourcePath, context)) {
            image.targetPath = await this.allocateTargetPath(image.file, image.noteFile, context);
        } else {
            context.reservedPaths.add(image.targetPath);
        }

        const targetDir = image.targetPath.substring(0, image.targetPath.lastIndexOf('/'));
        try {
            await this.ensureDirectory(targetDir);
            await this.app.vault.rename(image.file, image.targetPath);
            image.finalPath = image.targetPath;
            context.moved++;
        } catch {
            image.failed = true;
            image.finalPath = image.sourcePath;
            context.failed++;
            context.reservedPaths.delete(image.targetPath);
        }
    }
}
```

引用重写在 `vault.process` 回调中重新解析当前内容。只有引用数量和顺序仍可对应时才重写，避免覆盖整理期间出现的并发编辑：

```typescript
private async updatePlannedReferences(
    notePlans: NotePlan[],
    context: ReorganizeContext
): Promise<void> {
    for (const notePlan of notePlans) {
        await this.app.vault.process(notePlan.file, (currentContent) => {
            const currentRefs = this.refConverter.parseReferences(currentContent);
            if (currentRefs.length !== notePlan.references.length) return currentContent;
            if (!this.canApplyCurrentReferences(currentRefs, notePlan, context)) {
                return currentContent;
            }

            let result = currentContent;
            for (let index = currentRefs.length - 1; index >= 0; index--) {
                const currentRef = currentRefs[index]!;
                const plannedRef = notePlan.references[index]!;
                if (!plannedRef.sourcePath) continue;
                const image = context.images.get(plannedRef.sourcePath);
                if (!image || image.failed) continue;

                const newRef = this.buildReference(
                    currentRef,
                    image.finalPath,
                    notePlan.file,
                    plannedRef.outputFormat
                );
                if (newRef === currentRef.fullMatch) continue;
                result = result.substring(0, currentRef.col) +
                    newRef +
                    result.substring(currentRef.col + currentRef.fullMatch.length);
            }
            return result;
        });
    }
}

private canApplyCurrentReferences(
    currentRefs: ImageReference[],
    notePlan: NotePlan,
    context: ReorganizeContext
): boolean {
    return currentRefs.every((currentRef, index) => {
        const plannedRef = notePlan.references[index]!;
        if (currentRef.fullMatch === plannedRef.ref.fullMatch) return true;
        if (!plannedRef.sourcePath) return false;

        const image = context.images.get(plannedRef.sourcePath);
        if (!image || image.failed) return false;
        const resolved = this.resolveImageFromRef(currentRef.path);
        return resolved?.path === image.finalPath;
    });
}

private buildReference(
    ref: ImageReference,
    finalPath: string,
    noteFile: TFile,
    outputFormat: ReferenceFormat
): string {
    if (outputFormat === 'wiki') {
        const filename = finalPath.split('/').pop() ?? finalPath;
        return ref.altText ? `![[${filename}|${ref.altText}]]` : `![[${filename}]]`;
    }

    let refPath = finalPath;
    if (this.settings.imagePathBase === 'note') {
        const noteDir = noteFile.parent?.path ?? '';
        if (noteDir) refPath = this.refConverter.computeRelativePath(noteDir, finalPath);
    }
    return `![${ref.altText}](${encodePathSegments(refPath)})`;
}
```

删除旧的逐引用移动循环、`buildRefPath` 和基于移动后文件名反查的 `updateOtherNotes`；`ensureDirectory`、`ensureUniquePath` 中只有新的规划流程仍使用的部分才保留。

- [ ] **步骤 6：运行单篇整理测试并确认通过**

运行：

```powershell
npm test -- tests/image-reorganizer.test.ts
```

预期：当前 4 个测试全部 PASS。

- [ ] **步骤 7：增加文件夹共享计数、跨笔记引用和失败隔离测试**

在 `tests/image-reorganizer.test.ts` 的 `describe` 中追加：

```typescript
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

    expect(result).toEqual({ moved: 2, skipped: 0, failed: 0, notes: 2 });
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
    expect(harness.contents.get('other/b.md')).toBe('![B](../notes/attachments/shared-0.png)');
});

it('单张图片移动失败时保留原引用并继续其他图片', async () => {
    const harness = createHarness({
        'notes/note.md': '![失败](../assets/a.png)\n![成功](../assets/b.png)',
        'assets/a.png': null,
        'assets/b.png': null,
    });
    harness.failRenameFrom.add('assets/a.png');
    const reorganizer = new ImageReorganizer(
        harness.app,
        createSettings({ imageNamingTemplate: 'image-{counter}' }),
        resolveImagePath
    );

    const result = await reorganizer.reorganizeNote(
        harness.files.get('notes/note.md')!,
        'markdown'
    );

    expect(result).toEqual({ moved: 1, skipped: 0, failed: 1 });
    expect(harness.contents.get('notes/note.md')).toContain('![失败](../assets/a.png)');
    expect(harness.contents.get('notes/note.md')).toContain('attachments/image-1.png');
});
```

- [ ] **步骤 8：运行整理器与引用回归测试**

运行：

```powershell
npm test -- tests/image-reorganizer.test.ts tests/ref-converter.test.ts tests/path-utils.test.ts
```

预期：全部 PASS；跨笔记引用按每篇笔记目录生成正确相对路径。

- [ ] **步骤 9：提交整理器行为**

```powershell
git add -- src/utils/image-reorganizer.ts tests/image-reorganizer.test.ts
git commit -m "feat: 整理图片时应用命名模板"
```

预期：提交只包含整理器和对应测试。

---

### 任务 3：接入结果文案并同步项目技能文档

**文件：**

- 修改：`src/main.ts:607-643`
- 修改：`src/i18n/zh.ts:81,224-225`
- 修改：`src/i18n/en.ts:82,227-228`
- 修改：`.agents/skills/obsidian-image-manager/references/architecture.md`
- 修改：`.agents/skills/obsidian-image-manager/references/paste-drop.md`
- 修改：`.agents/skills/obsidian-image-manager/references/image-reorganizer.md`
- 修改：`.agents/skills/obsidian-image-manager/references/settings.md`

**接口：**

- 消费任务 2 的 `ReorganizeResult.failed`。
- `notice.reorganizeDone` 的中英文变量固定为 `{note}`、`{moved}`、`{skipped}`、`{failed}`。

- [ ] **步骤 1：在两个整理入口传入失败数量**

在 `src/main.ts` 的单篇与文件夹整理成功通知中都加入：

```typescript
failed: String(result.failed),
```

单篇入口的完整插值对象应为：

```typescript
t('notice.reorganizeDone', {
    note: '1',
    moved: String(result.moved),
    skipped: String(result.skipped),
    failed: String(result.failed),
})
```

文件夹入口仅将 `note` 改为 `String(result.notes)`。

- [ ] **步骤 2：更新中英文文案**

在 `src/i18n/zh.ts` 使用：

```typescript
'notice.reorganizeDone': '已整理 {note} 篇笔记，移动或重命名 {moved} 张图片，跳过 {skipped} 张，失败 {failed} 张',
'settings.imageNamingTemplateDesc':
    '粘贴、拖放或整理图片资源时的命名模板。变量：{date}, {time}, {timestamp}, {counter}, {year}, {month}, {day}',
```

在 `src/i18n/en.ts` 使用：

```typescript
'notice.reorganizeDone': 'Reorganized {note} note(s), moved or renamed {moved} image(s), skipped {skipped}, failed {failed}',
'settings.imageNamingTemplateDesc':
    'Template for image names when pasting, dropping, or reorganizing. Variables: {date}, {time}, {timestamp}, {counter}, {year}, {month}, {day}',
```

- [ ] **步骤 3：更新架构与粘贴文档**

在 `architecture.md` 的资源整理数据流中明确加入：

```text
读取 imageNamingTemplate → 任务级 counter 分配 → 检查 Vault/adapter/预留路径
→ 移动或重命名不同图片 → 按旧路径到最终路径映射更新所有引用
```

在 `paste-drop.md` 的 `generateFileName` 小节说明：

```markdown
粘贴/拖放和资源整理共同调用 `src/utils/image-name-template.ts`。模板渲染与文件名清理只有一份实现；粘贴计数器仍保持插件会话内递增，资源整理计数器则在每次命令开始时从 `0` 计数。
```

- [ ] **步骤 4：更新资源整理与设置文档**

在 `image-reorganizer.md` 补充以下明确规则：

```markdown
- 整理器使用当前 `imageNamingTemplate` 生成目标文件名。
- 单篇和文件夹整理各自创建一个任务上下文，`{counter}` 从 `0` 开始。
- 模板包含 `{counter}` 时，冲突通过重新渲染下一个 counter 解决。
- 模板不含 `{counter}` 时，冲突通过 `-1`、`-2` 后缀解决。
- 目标占用检查覆盖 Vault 内存映射、adapter 和任务预留路径，禁止覆盖。
- 同一图片只移动一次，其他笔记引用通过旧路径到最终路径映射更新。
- 结果分别统计 `moved`、`skipped` 和 `failed`。
```

在 `settings.md` 的图片命名部分把适用范围改为“粘贴、拖放和资源整理”，变量列表保持不变。

- [ ] **步骤 5：运行全量测试和构建**

运行：

```powershell
npm test
npm run build
```

预期：所有 Vitest 测试 PASS；构建通过 ESLint、TypeScript 和 esbuild，且没有新增运行时依赖。

- [ ] **步骤 6：提交入口、文案和规范文档**

```powershell
git add -- src/main.ts src/i18n/zh.ts src/i18n/en.ts .agents/skills/obsidian-image-manager/references/architecture.md .agents/skills/obsidian-image-manager/references/paste-drop.md .agents/skills/obsidian-image-manager/references/image-reorganizer.md .agents/skills/obsidian-image-manager/references/settings.md
git commit -m "feat: 更新图片整理结果提示与文档"
```

预期：提交不包含 `.claude/skills/`、`.codex/`、`main.js` 或其他生成文件。

---

### 任务 4：最终验证与交付检查

**文件：**

- 验证：`src/utils/image-name-template.ts`
- 验证：`src/utils/image-reorganizer.ts`
- 验证：`src/main.ts`
- 验证：`tests/image-name-template.test.ts`
- 验证：`tests/image-reorganizer.test.ts`
- 验证：`.agents/skills/obsidian-image-manager/references/*.md`

**接口：**

- 不产生新接口；确认前 3 个任务的提交共同满足设计文档。

- [ ] **步骤 1：检查差异格式和生成文件**

运行：

```powershell
git diff --check HEAD~3..HEAD
git status --short
```

预期：`git diff --check` 无输出；任务文件没有未提交修改。用户已有的 `?? .codex/` 可以继续存在，但不得被暂存或提交。

- [ ] **步骤 2：运行全量单元测试**

运行：

```powershell
npm test
```

预期：Vitest 退出码为 `0`，所有测试文件和测试用例 PASS。

- [ ] **步骤 3：运行生产构建**

运行：

```powershell
npm run build
```

预期：`npm run lint`、`tsc -noEmit -skipLibCheck` 和生产 esbuild 均成功，退出码为 `0`。

- [ ] **步骤 4：核对提交范围**

运行：

```powershell
git log -3 --oneline --decorate
git show --stat --oneline HEAD~3..HEAD
```

预期：最近 3 个功能提交依次对应共享模板工具、整理器行为、入口与文档；没有构建产物、依赖目录或 `.codex/`。
