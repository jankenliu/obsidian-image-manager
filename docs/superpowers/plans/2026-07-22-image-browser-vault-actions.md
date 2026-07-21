# 图片浏览器全库操作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在图片浏览器本地模式中提供经二次确认的全库图片整理与上传图床操作，并安全清理由此产生的空目录。

**Architecture:** 抽出可测试的空目录清理工具；`main.ts` 编排全库整理、上传、引用回写与回收站操作；`ImageBrowserModal` 只负责本地模式按钮和确认框。复用既有 `ImageReorganizer`、`ImageScanner`、上传器工厂及引用回写逻辑。

**Tech Stack:** TypeScript 5 strict、Obsidian Plugin API、Vitest。

---

### Task 1: 创建空目录清理工具

**Files:**
- Create: `src/utils/empty-directory-cleanup.ts`
- Create: `tests/empty-directory-cleanup.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('trashes empty ancestors but not the vault root', async () => {
  const result = await trashEmptyDirectories(app, new Set(['assets/nested']));
  expect(result.trashed).toEqual(['assets/nested', 'assets']);
  expect(fileManager.trashFile).not.toHaveBeenCalledWith(vaultRoot, true);
});

test('keeps directories that still have children', async () => {
  await trashEmptyDirectories(app, new Set(['assets/used']));
  expect(fileManager.trashFile).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 验证测试为红**

Run: `npm test -- tests/empty-directory-cleanup.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 最小实现**

创建 `trashEmptyDirectories(app, affectedParentPaths)`：从每个受影响父目录向 Vault 根目录收集候选项，按深度从深到浅检查；仅对 `TFolder`、`children.length === 0` 且路径非空的目录调用 `app.fileManager.trashFile(folder, true)`；捕获单目录异常并返回 `{ trashed: string[], failed: number }`。

- [ ] **Step 4: 验证变绿**

Run: `npm test -- tests/empty-directory-cleanup.test.ts`

Expected: PASS，2 项测试通过。

- [ ] **Step 5: 提交**

```bash
git add src/utils/empty-directory-cleanup.ts tests/empty-directory-cleanup.test.ts
git commit -m "feat: 支持清理空图片目录"
```

### Task 2: 扩展整理器以报告实际移动图片的原父目录

**Files:**
- Modify: `src/utils/image-reorganizer.ts:15-38,113-230`
- Modify: `tests/image-reorganizer.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('reports source parent paths only for images that were moved', async () => {
  const result = await reorganizer.reorganizeFolder('', 'markdown');
  expect(result.movedParentPaths).toEqual(new Set(['assets']));
});
```

- [ ] **Step 2: 验证测试为红**

Run: `npm test -- tests/image-reorganizer.test.ts`

Expected: FAIL，结果不含 `movedParentPaths`。

- [ ] **Step 3: 最小实现**

给 `ReorganizeResult` 和内部上下文增加 `movedParentPaths: Set<string>`；仅在 `vault.rename` 成功后记录 `file.parent?.path`。保持现有的移动计数、全 Vault 引用回写及失败隔离逻辑不变。

- [ ] **Step 4: 验证变绿**

Run: `npm test -- tests/image-reorganizer.test.ts`

Expected: PASS，既有整理测试和新增测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/utils/image-reorganizer.ts tests/image-reorganizer.test.ts
git commit -m "feat: 记录整理图片的空目录候选"
```

### Task 3: 实现全库整理协调入口

**Files:**
- Modify: `src/main.ts:612-650`
- Create: `tests/vault-image-actions.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('reorganizes all markdown notes and cleans emptied source directories', async () => {
  await plugin.reorganizeEntireVault();
  expect(reorganizeFolder).toHaveBeenCalledWith('', 'markdown');
  expect(trashEmptyDirectories).toHaveBeenCalledWith(app, new Set(['assets']));
});
```

- [ ] **Step 2: 验证测试为红**

Run: `npm test -- tests/vault-image-actions.test.ts`

Expected: FAIL，`reorganizeEntireVault` 不存在。

- [ ] **Step 3: 最小实现**

新增公开的 `reorganizeEntireVault()`：构造既有 `ImageReorganizer`，调用 `reorganizeFolder('', this.settings.reorganizeConvertFormat ? 'markdown' : undefined)`，再把结果的 `movedParentPaths` 交给 `trashEmptyDirectories`。用 `try/finally` 维护 `isReorganizing`，并用翻译通知汇总笔记、移动、跳过、失败和已清理目录数。

- [ ] **Step 4: 验证变绿**

Run: `npm test -- tests/vault-image-actions.test.ts tests/image-reorganizer.test.ts tests/empty-directory-cleanup.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main.ts tests/vault-image-actions.test.ts
git commit -m "feat: 支持全库整理笔记图片"
```

### Task 4: 实现全库上传、回写与安全删除

**Files:**
- Modify: `src/main.ts:328-411,550-591,921-929`
- Modify: `tests/vault-image-actions.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('stops before confirmation work when automatic replacement is disabled', async () => {
  plugin.settings.autoReplaceAfterUpload = false;
  await plugin.uploadEntireVault();
  expect(uploader.upload).not.toHaveBeenCalled();
});

test('uploads, replaces references, then trashes only successful images', async () => {
  await plugin.uploadEntireVault();
  expect(events).toEqual(['upload:a.png', 'replace:a.png', 'trash:a.png']);
});

test('keeps image when upload or reference replacement fails', async () => {
  await plugin.uploadEntireVault();
  expect(fileManager.trashFile).not.toHaveBeenCalledWith(failedImage, true);
});
```

- [ ] **Step 2: 验证测试为红**

Run: `npm test -- tests/vault-image-actions.test.ts`

Expected: FAIL，`uploadEntireVault` 不存在。

- [ ] **Step 3: 最小实现**

新增 `uploadEntireVault()`，按此顺序检查：`reorganizeConvertFormat`、`autoReplaceAfterUpload`、默认启用图床配置、受支持本地图片。满足条件后逐张调用一个内部上传助手（复用现有的二进制读取、可选压缩和 `createUploader(...).upload(data, file.name, { sourcePath: file.path })`）。

每张图片固定执行：上传成功且存在 URL → 成功回写所有本地引用 → 当 `keepLocalCopy === false` 时 `fileManager.trashFile(file, true)`。上传或回写失败时保留源图片。仅当不保留副本时，最后调用 `trashEmptyDirectories`；汇总通知成功、失败、保留/删除与清理目录数。不要使用现有 `UploadQueue`，因为它不保证“回写成功后才删文件”的事务顺序。

- [ ] **Step 4: 验证变绿**

Run: `npm test -- tests/vault-image-actions.test.ts tests/empty-directory-cleanup.test.ts`

Expected: PASS，包括前置阻断、成功删除、保留副本与失败保留。

- [ ] **Step 5: 提交**

```bash
git add src/main.ts tests/vault-image-actions.test.ts
git commit -m "feat: 支持全库上传图床"
```

### Task 5: 添加图片浏览器本地模式入口

**Files:**
- Modify: `src/modals/image-browser.ts:84-160,213-237`
- Modify: `styles.css`
- Create: `tests/image-browser-vault-actions.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('shows vault action buttons only in local mode', () => {
  modal.onOpen();
  expect(findButton('Organize all notes')).not.toBeNull();
  modal.switchSourceForTest('hosting');
  expect(findButton('Organize all notes')).toBeNull();
});

test('runs vault upload only after confirmation', async () => {
  clickButton('Upload all images');
  expect(confirmDialog.message).toBe(t('modal.imageBrowser.confirmVaultUpload'));
  await confirmDialog.confirm();
  expect(plugin.uploadEntireVault).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: 验证测试为红**

Run: `npm test -- tests/image-browser-vault-actions.test.ts`

Expected: FAIL，按钮不存在。

- [ ] **Step 3: 最小实现**

在 `ImageBrowserModal` 添加专用本地操作容器和两个按钮。仅在本地模式显示，图床模式加 `image-browser-hidden`。按钮使用既有 `ConfirmDialog`，其标题分别为 `modal.imageBrowser.organizeVault` 与 `modal.imageBrowser.uploadVault`，确认文案为 `confirmOrganizeVault` 和 `confirmVaultUpload`；确认时调用插件公开方法。执行期间禁用两个按钮，结束后恢复；用 CSS 类布局，不写 `element.style`。

- [ ] **Step 4: 验证变绿**

Run: `npm test -- tests/image-browser-vault-actions.test.ts tests/image-browser-batch.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/modals/image-browser.ts styles.css tests/image-browser-vault-actions.test.ts
git commit -m "feat: 添加图片浏览器全库操作入口"
```

### Task 6: 增加国际化文本并同步项目文档

**Files:**
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`
- Create: `tests/i18n-vault-actions.test.ts`
- Modify: `.agents/skills/obsidian-image-manager/references/architecture.md`
- Modify: `.agents/skills/obsidian-image-manager/references/modals.md`
- Modify: `.agents/skills/obsidian-image-manager/references/i18n.md`

- [ ] **Step 1: 写失败测试**

```ts
test.each(['modal.imageBrowser.organizeVault', 'modal.imageBrowser.uploadVault',
  'modal.imageBrowser.confirmOrganizeVault', 'modal.imageBrowser.confirmVaultUpload',
  'notice.autoReplaceRequiredForVaultUpload', 'notice.reorganizeVaultDone',
  'notice.vaultUploadDone'])('translates %s in both locales', (key) => {
  setLocale('en'); expect(t(key)).not.toBe(key);
  setLocale('zh'); expect(t(key)).not.toBe(key);
});
```

- [ ] **Step 2: 验证测试为红**

Run: `npm test -- tests/i18n-vault-actions.test.ts`

Expected: FAIL，翻译回退为 key。

- [ ] **Step 3: 最小实现**

在中英文词典中添加两按钮、两条二次确认、自动替换未开启提示和两类汇总通知。中文确认文案精确使用：`请注意！该操作会整理当前工作空间中所有的笔记本地图片。` 与 `请注意！该操作会上传所有的本地图片到图床，并替换笔记为图床的链接引用。`。同步架构、Modal 和 i18n 参考，记录前置检查、删除顺序和回收站空目录清理。

- [ ] **Step 4: 验证变绿**

Run: `npm test -- tests/i18n-vault-actions.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/i18n tests/i18n-vault-actions.test.ts .agents/skills/obsidian-image-manager/references
git commit -m "docs: 说明全库图片操作"
```

### Task 7: 完整验证和人工验收

**Files:**
- Verify: 全部改动

- [ ] **Step 1: 运行全部测试**

Run: `npm test`

Expected: 所有 Vitest 测试通过，失败数为 0。

- [ ] **Step 2: 构建生产包**

Run: `npm run build`

Expected: eslint、TypeScript 与 esbuild 均以退出码 0 完成。

- [ ] **Step 3: 在 Obsidian 手工验收**

1. 本地模式显示两个按钮，图床模式隐藏。
2. 整理操作确认后更新图片与引用，空目录进入回收站。
3. 关闭自动替换引用后，上传操作只提示并终止。
4. 打开自动替换且关闭保留副本后，成功图片回写 URL、图片与空目录进入回收站。
5. 打开保留副本后，成功图片留在 Vault；上传或回写失败时也始终保留。

- [ ] **Step 4: 检查提交范围**

Run: `git status --short`

Expected: 工作树干净，且只提交本计划范围内的实现、测试和文档。

