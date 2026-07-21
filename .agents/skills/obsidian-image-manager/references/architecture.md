# 架构概览

## 模块依赖关系

```
main.ts（入口）
├── settings.ts（设置面板）
├── modals/（7 个 Modal）
├── uploaders/（图床上传）
│   ├── uploader-factory.ts → 4 个上传器
│   ├── upload-path.ts（共享上传路径模板解析）
│   ├── public-url.ts（公共访问 URL 基础路径拼接）
│   └── upload-queue.ts
├── utils/（工具模块）
│   ├── ref-converter.ts ← constants.ts（正则）
│   ├── public-url.ts（Markdown URL 的 Unicode 可读化）
│   ├── image-scanner.ts
│   ├── orphan-finder.ts ← ref-converter.ts
│   ├── image-optimizer.ts
│   ├── image-name-template.ts（共享图片命名模板）
│   ├── image-reorganizer.ts ← image-name-template.ts + ref-converter.ts + path-utils.ts
│   ├── batch-rename.ts ← ref-converter.ts
│   └── path-utils.ts
├── types.ts（类型定义）
└── i18n/（国际化）
```

## 核心设计模式

### 1. 工厂模式（上传器）

`createUploader(config)` 根据 `HostingType` 返回对应的 `UploaderBase` 子类实例。新增服务商只需：
- 继承 `UploaderBase`
- 实现 `upload()` + `testConnection()`
- 在工厂中注册

### 2. 策略模式（引用格式）

`ReferenceFormat` 类型（`'markdown' | 'wiki'`）决定引用生成策略。`RefConverter` 负责解析和转换，`reorganizeConvertFormat` 设置控制全局行为。

### 3. 观察者模式（事件处理）

插件通过 `this.registerEvent()` 注册事件监听器，确保 `onunload()` 时自动清理：
- `editor-paste` / `editor-drop`：粘贴/拖放拦截
- `vault rename`：修复 Obsidian 重命名后的引用
- `file-menu`：右键菜单扩展

### 4. 并发队列（上传）

`UploadQueue` 实现 3 并发 worker、3 次重试、进度回调。用于批量上传场景。

## 关键数据流

### 粘贴/拖放 → 保存 → 引用插入

```
ClipboardEvent/DragEvent
  → handleImagePaste/handleImageDrop（返回 boolean）
  → processImageFiles（逐文件处理）
    → image-name-template（会话级 pasteCounter + 模板渲染/名称清理）
    → ImageNamePromptModal（可选）
    → savePastedImage
      → resolveImagePath（模板变量：{noteName}, {notePath}, {filename}, {year}, {month}, {day}, {timestamp}）
      → ensureDirectory（递归创建）
      → ensureUniquePath（冲突处理：-1, -2, ...）
      → Canvas 压缩（可选，PNG→WebP）
      → vault.createBinary
      → editor.replaceSelection（MD 或 Wiki 格式）
      → autoUploadAfterPaste（可选）
```

### 上传 → 替换引用

```
doUpload(file, config)
  → readBinary + 可选压缩
  → createUploader(config, globalTemplate).upload(data, filename, { sourcePath })
  → 成功：clipboard.writeText(ref)
    → 仅在 Markdown 边界还原 URL 路径中的 Unicode，保留敏感 ASCII 编码
  → 可选 replaceReferenceInNote（遍历所有 MD 文件）
  → 可选 trashFile（!keepLocalCopy）
```

### 资源整理 → 移动 + 更新引用

```
reorganizeNote(file)
  → ImageReorganizer.reorganizeNote
    → 创建任务级上下文（单篇或整个文件夹各一个，counter 从 0 开始）
    → metadataCache 优先解析引用，歧义时安全跳过
    → 按源路径去重并记录每张图片首次分配时的 namingTime
    → image-name-template（完整 imageNamingTemplate + 任务级 counter）
    → resolveImagePath（使用最终候选文件名计算目标目录）
    → 检查 Vault 内存映射 + adapter + reservedPaths，预留目标路径
    → 移动前复检；rename 竞态冲突时继续分配，其他失败仅隔离当前图片
    → vault.rename（每张不同图片最多成功移动或重命名一次）
    → vault.process（按旧路径 → 最终路径映射更新范围内及其他笔记）
```

粘贴/拖放与资源整理共享 `image-name-template.ts` 的模板渲染和文件名清理规则，但计数器生命周期不同：`pasteCounter` 在插件会话内持续递增；每次单篇整理或文件夹整理创建独立任务上下文，文件夹内所有笔记共享同一个从 `0` 开始的计数器。

## 设置门控逻辑

```
reorganizeConvertFormat
  ├── true（默认）→ 图床功能可用
  │   ├── 图床设置面板正常渲染
  │   ├── 上传命令可执行
  │   └── 粘贴引用使用 MD 格式
  └── false → 图床功能禁用
      ├── 图床设置面板显示提示
      ├── 上传命令 Notice 提示
      └── 粘贴引用使用 Wiki 格式
```

## 模块职责边界

| 模块 | 职责 | 不负责 |
|------|------|--------|
| `main.ts` | 命令注册、事件编排、粘贴/拖放 | 具体业务逻辑（委托给 utils） |
| `settings.ts` | 设置面板 UI 渲染 | 设置值的持久化（main.ts 处理） |
| `ref-converter.ts` | 引用解析、格式转换 | 文件移动、引用替换（reorganizer 处理） |
| `image-name-template.ts` | 图片命名模板渲染、文件名清理、冲突后缀生成 | 计数器生命周期、路径占用检查 |
| `image-reorganizer.ts` | 任务级名称与路径规划、文件移动/重命名、失败隔离、跨笔记引用更新 | 压缩、上传 |
| `batch-rename.ts` | 重命名 + 引用同步 | 文件移动、格式转换 |
| `uploaders/` | 图床上传 | 引用替换（main.ts 处理） |
| `image-optimizer.ts` | 压缩、格式转换 | 文件保存（调用者处理） |
