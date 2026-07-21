# 资源整理

## 文件：`src/utils/image-reorganizer.ts`

## ImageReorganizer 类

```typescript
class ImageReorganizer {
    constructor(
        app: App,
        settings: ImageManagerSettings,
        resolveImagePath: (template: string, currentFile: TFile | null, filename: string) => string
    );

    // 单篇笔记创建一个独立任务上下文
    reorganizeNote(
        noteFile: TFile,
        convertFormat?: ReferenceFormat
    ): Promise<ReorganizeResult>;

    // 整个文件夹创建一个共同任务上下文，全部笔记共享 counter 和目标预留
    reorganizeFolder(
        folderPath: string,
        convertFormat?: ReferenceFormat
    ): Promise<ReorganizeResult & { notes: number }>;
}
```

## ReorganizeResult

```typescript
interface ReorganizeResult {
    moved: number;   // 成功移动或重命名的不同图片数
    skipped: number; // 因设置跳过或无法安全解析的范围内引用数
    failed: number;  // 目录准备或 rename 失败的不同图片数
}
```

文件夹结果额外返回 `notes`。单篇与文件夹入口最终都调用同一个 `reorganizeNotes`：单篇任务只包含一篇笔记；文件夹任务只创建一次 `ReorganizeContext`，不会在每篇笔记之间重置 `{counter}`、图片去重映射或预留路径。

外部 HTTP/HTTPS 引用不进入整理计划，也不计入 `skipped`。单张图片失败只增加 `failed`，不会阻止其他图片继续执行。

## 共享命名工具与任务上下文

粘贴/拖放和资源整理共同使用 `src/utils/image-name-template.ts`：

- `renderImageNameTemplate`：渲染 `imageNamingTemplate` 中实际出现的变量并保留原扩展名。
- `imageNamingTemplateUsesCounter`：选择 `{counter}` 冲突递增策略。
- `appendImageNameSuffix`：模板不含 `{counter}` 时生成 `-1`、`-2` 等后缀。

计数器生命周期由调用方管理。粘贴/拖放的 `pasteCounter` 在插件会话内持续递增；资源整理在每次公开命令开始时创建新上下文，`nextCounter` 从 `0` 开始。同一次文件夹整理中的所有笔记共享该上下文。

```typescript
interface ReorganizeContext {
    nextCounter: number;
    reservedPaths: Set<string>;
    images: Map<string, PlannedImage>; // 旧源路径 → 唯一图片计划
    moved: number;
    skipped: number;
    failed: number;
}
```

每张不同图片第一次进入计划时记录一个 `namingTime`。首次分配、移动前重新分配和 `vault.rename` 竞态后的再次分配都复用该时间，因此 `{date}`、`{time}`、`{timestamp}`、`{year}`、`{month}`、`{day}` 不会因重试跨秒或跨日而变化。

## 整理流程

### 1. 规划范围内图片

```text
reorganizeNote / reorganizeFolder
  → reorganizeNotes（创建一次任务上下文）
  → cachedRead + parseReferences
  → 忽略外部 URL；按设置跳过 Wiki；安全解析本地图片
  → 以图片旧源路径为 key 去重
  → 记录首次 namingTime
  → 渲染完整 imageNamingTemplate
  → 用最终候选文件名调用 resolveImagePath
  → 检查占用并将目标加入 reservedPaths
```

同一图片在一篇笔记中出现多次或被多篇笔记引用时，只创建一个 `PlannedImage`、只分配一次初始名称，并且最多成功移动或重命名一次。

### 2. 移动前收集全部引用计划

规划完整理范围后、移动文件前，`collectNotePlans` 扫描 Vault 中的全部 Markdown 笔记，将每条可解析引用绑定到图片的旧源路径。这样图片改名后无需按新文件名反查，范围外笔记也能通过“旧源路径 → `PlannedImage.finalPath`”映射更新。

范围内引用会标记为触发引用；范围外引用只跟随成功移动后的新路径。只有调用方显式传入 `convertFormat` 时，范围内触发引用才强制转换格式。

### 3. 移动或重命名不同图片

```text
逐个 PlannedImage
  → 目标等于源路径：不调用 rename，不增加 moved
  → 移除自己的旧预留并复检目标
  → 如被占用：按相同规则重新分配
  → 恢复最终目标预留并创建目标目录
  → vault.rename
      ├── 成功：记录 finalPath，moved + 1
      ├── 目标刚被占用：释放旧预留并继续分配
      └── 其他错误：仅标记当前图片 failed，保留 sourcePath
```

如果目标路径等于源路径，范围内引用仍可按显式 `convertFormat` 转换；范围外引用不会因此被无意义重写。

### 4. 并发安全地更新引用

`updatePlannedReferences` 对每篇受影响笔记调用 `vault.process`，在回调中基于最新内容重新解析引用。只有引用数量未变且每条当前引用仍能与计划安全对应时，才从后往前重写；如果笔记在整理期间发生无法安全对齐的编辑，整篇笔记保持当前内容不变。

更新规则：

- 图片失败时跳过该图片的全部引用更新，原路径和原格式保持不变。
- 图片成功移动时，整理范围内和范围外笔记都使用其最终路径。
- Markdown 引用保留 `vault.process` 时最新引用的 alt 文本，并按 `imagePathBase` 生成 Vault 路径或笔记相对路径。
- Wiki 引用保留 `vault.process` 时最新引用的别名。
- 未显式传入 `convertFormat` 时保留当前引用格式，包括整理期间并发发生的格式变化。
- 显式传入 `convertFormat` 时，只强制范围内触发引用使用该格式；范围外笔记仍保留各自当前格式。
- Markdown 路径统一使用 `encodePathSegments` 编码。
- Obsidian 已自动改到正确最终目标的引用可通过最终文件解析验证，不会被视为冲突编辑。

## 引用解析：`resolveImageFromRef`

解析始终带上引用所在笔记，避免同名图片被错误关联：

1. 使用 `decodePathSegments` 解码引用并统一路径分隔符。
2. 调用 `metadataCache.getFirstLinkpathDest(decodedPath, noteFile.path)`；该结果是权威解析。若返回受支持的图片 `TFile`，直接使用；若返回非图片，安全返回 `null`，不再猜测其他同名文件。
3. metadata cache 未命中时，分别检查明确的 Vault 路径和基于当前笔记目录计算的相对路径。
4. 候选恰好一个时使用；候选超过一个时视为歧义并返回 `null`。
5. 包含 `/` 的路径若仍未命中，不降级为全局文件名搜索。
6. 只有裸文件名才允许在 Vault 图片中回退搜索，而且必须全局唯一；零个或多个同名匹配都返回 `null`。

无法安全解析的范围内引用计入 `skipped`。该策略避免旧实现用第一个同名文件兜底而整理错图。

## 名称与目标路径分配

### 模板包含 `{counter}`

从任务的 `nextCounter` 开始渲染完整模板。候选冲突时递增 counter，重新渲染名称，并用新文件名重新计算目标目录，因为 `imagePathTemplate` 可以包含 `{filename}`。接受计数值 `n` 后，任务中的下一张不同图片从 `n + 1` 开始；冲突时跳过的计数值不会复用。

```text
模板：image-{counter}
image-0.png 已占用
→ 尝试 image-1.png
```

### 模板不含 `{counter}`

先使用模板生成的基本名称；冲突时在扩展名前追加 `-1`、`-2` 等后缀。每次追加后缀也会重新调用 `resolveImagePath`。

```text
photo.png 已占用
→ photo-1.png
→ photo-2.png
```

### 禁止覆盖

每个候选同时检查：

- `vault.getAbstractFileByPath` 的内存映射；
- `vault.adapter.exists` 的底层存储状态；
- 当前任务的 `reservedPaths`。

候选等于当前图片自身源路径时可接受。其他已存在文件即使计划稍后移走也仍视为占用，防止覆盖、路径交换和缓存不同步。规划完成后会在每次 `vault.rename` 前复检；如果 rename 仍因刚出现的目标文件失败，再次检查底层占用并继续分配新路径。

## 设置门控

| 设置 | 影响 |
|------|------|
| `imageNamingTemplate` | 生成整理后的目标文件名；不强制补入模板中未出现的变量 |
| `imagePathTemplate` | 使用最终候选文件名计算目标目录 |
| `imagePathBase` | Markdown 引用使用 Vault 路径或笔记相对路径 |
| `reorganizeConvertFormat` | `main.ts` 为 `true` 时显式传入 `markdown`；为 `false` 时不强制格式 |
| `skipWikiRefsOnReorganize` | 为 `true` 时范围内 Wiki 引用计入 `skipped` 且不触发图片整理 |

### 4 种行为组合

| reorganizeConvertFormat | skipWikiRefsOnReorganize | 行为 |
|-------------------------|--------------------------|------|
| true | true（默认） | 整理可处理的本地引用并强制为 Markdown，跳过 Wiki |
| true | false | 整理所有可解析的本地引用并强制为 Markdown |
| false | true | 整理可处理的本地引用并保持当前格式，跳过 Wiki |
| false | false | 整理所有可解析的本地引用并保持当前格式 |

“跳过 Wiki”表示该引用不触发图片进入整理计划，并计入 `skipped`。如果同一图片同时被可处理引用触发并成功移动，为防止引用失效，这条 Wiki 引用仍会跟随旧路径到最终路径映射更新，但保持 Wiki 格式和原别名。

## 右键菜单集成

```typescript
// 文件夹右键：一次任务处理文件夹内全部 Markdown 笔记
menu.addItem((item) => {
    item.setTitle(`Markdown Image Manager: ${t('command.reorganizeImages')}`)
        .setIcon('image-file')
        .onClick(() => this.reorganizeFolder(file.path));
});

// Markdown 文件右键：一次任务处理单篇笔记
menu.addItem((item) => {
    item.setTitle(`Markdown Image Manager: ${t('command.reorganizeImages')}`)
        .setIcon('image-file')
        .onClick(() => this.reorganizeNote(file));
});
```

## 关键保证

1. **共享规则**：粘贴/拖放与整理共用命名模板渲染和名称清理实现。
2. **任务级计数**：单篇和整个文件夹任务各自从 `0` 开始；文件夹内不按笔记重置。
3. **首次时间稳定**：同一图片在所有冲突重试中复用第一次规划时的 `namingTime`。
4. **永不覆盖**：Vault 映射、adapter、任务预留、移动前复检和 rename 竞态重试共同保护目标。
5. **失败隔离**：单张失败保留原文件、原引用和原格式，其余图片继续处理。
6. **跨笔记精确映射**：移动前按旧源路径收集引用，移动后使用最终路径更新所有相关笔记。
7. **并发内容保护**：`vault.process` 只在当前引用仍可与计划安全对应时重写，并保留最新 alt、别名和未强制的格式。
