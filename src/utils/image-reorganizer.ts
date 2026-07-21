import { App, TFile } from 'obsidian';
import type {
    ImageManagerSettings,
    ImageReference,
    ReferenceFormat,
} from '../types';
import {
    appendImageNameSuffix,
    imageNamingTemplateUsesCounter,
    renderImageNameTemplate,
} from './image-name-template';
import { joinPath, decodePathSegments, encodePathSegments } from './path-utils';
import { RefConverter } from './ref-converter';

export interface ReorganizeResult {
    moved: number;
    skipped: number;
    failed: number;
}

export interface ReorganizeFolderCleanupResult extends ReorganizeResult {
    notes: number;
    movedParentPaths: readonly string[];
}

interface PlannedImage {
    file: TFile;
    sourcePath: string;
    targetPath: string;
    finalPath: string;
    noteFile: TFile;
    namingTime: Date;
    failed: boolean;
}

interface ReorganizeContext {
    nextCounter: number;
    reservedPaths: Set<string>;
    images: Map<string, PlannedImage>;
    moved: number;
    skipped: number;
    failed: number;
    movedParentPaths: Set<string>;
}

interface ReorganizeNotesResult extends ReorganizeResult {
    notes: number;
    movedParentPaths: Set<string>;
}

interface PlannedReference {
    ref: ImageReference;
    sourcePath: string | null;
    forcedFormat?: ReferenceFormat;
    isTrigger: boolean;
}

interface NotePlan {
    file: TFile;
    references: PlannedReference[];
}

export class ImageReorganizer {
    private app: App;
    private refConverter: RefConverter;
    private settings: ImageManagerSettings;
    private resolveImagePath: (
        template: string,
        currentFile: TFile | null,
        filename: string
    ) => string;

    constructor(
        app: App,
        settings: ImageManagerSettings,
        resolveImagePath: (
            template: string,
            currentFile: TFile | null,
            filename: string
        ) => string
    ) {
        this.app = app;
        this.refConverter = new RefConverter(app);
        this.settings = settings;
        this.resolveImagePath = resolveImagePath;
    }

    /** 整理单篇笔记引用的图片 */
    async reorganizeNote(
        noteFile: TFile,
        convertFormat?: ReferenceFormat
    ): Promise<ReorganizeResult> {
        const result = await this.reorganizeNotes([noteFile], convertFormat);
        return {
            moved: result.moved,
            skipped: result.skipped,
            failed: result.failed,
        };
    }

    /** 整理文件夹内所有笔记引用的图片 */
    async reorganizeFolder(
        folderPath: string,
        convertFormat?: ReferenceFormat
    ): Promise<ReorganizeResult & { notes: number }> {
        const result = await this.reorganizeNotes(
            this.getFolderNoteFiles(folderPath),
            convertFormat
        );
        return {
            moved: result.moved,
            skipped: result.skipped,
            failed: result.failed,
            notes: result.notes,
        };
    }

    async reorganizeFolderWithCleanupInfo(
        folderPath: string,
        convertFormat?: ReferenceFormat
    ): Promise<ReorganizeFolderCleanupResult> {
        const result = await this.reorganizeNotes(
            this.getFolderNoteFiles(folderPath),
            convertFormat
        );
        return {
            moved: result.moved,
            skipped: result.skipped,
            failed: result.failed,
            notes: result.notes,
            movedParentPaths: Object.freeze([...result.movedParentPaths]),
        };
    }

    private getFolderNoteFiles(folderPath: string): TFile[] {
        const folderPrefix = folderPath ? `${folderPath}/` : '';
        return this.app.vault.getMarkdownFiles().filter((file) =>
            folderPath === '' || file.path === folderPath || file.path.startsWith(folderPrefix)
        );
    }

    private createContext(): ReorganizeContext {
        return {
            nextCounter: 0,
            reservedPaths: new Set<string>(),
            images: new Map<string, PlannedImage>(),
            moved: 0,
            skipped: 0,
            failed: 0,
            movedParentPaths: new Set<string>(),
        };
    }

    private async reorganizeNotes(
        noteFiles: TFile[],
        convertFormat?: ReferenceFormat
    ): Promise<ReorganizeNotesResult> {
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

                const imageFile = this.resolveImageFromRef(ref.path, noteFile);
                if (!imageFile) {
                    context.skipped++;
                    touchedNotes.add(noteFile.path);
                    continue;
                }

                const sourcePath = imageFile.path;
                if (!context.images.has(sourcePath)) {
                    const namingTime = new Date();
                    const targetPath = await this.allocateTargetPath(
                        imageFile,
                        noteFile,
                        context,
                        namingTime
                    );
                    context.images.set(sourcePath, {
                        file: imageFile,
                        sourcePath,
                        targetPath,
                        finalPath: sourcePath,
                        noteFile,
                        namingTime,
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
            movedParentPaths: context.movedParentPaths,
            notes: touchedNotes.size,
        };
    }

    private async allocateTargetPath(
        file: TFile,
        noteFile: TFile,
        context: ReorganizeContext,
        namingTime: Date
    ): Promise<string> {
        const template = this.settings.imageNamingTemplate;
        const usesCounter = imageNamingTemplateUsesCounter(template);
        let candidateCounter = context.nextCounter;
        let suffix = 0;

        while (true) {
            const rendered = renderImageNameTemplate(
                template,
                file.extension,
                candidateCounter,
                namingTime
            );
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

            if (usesCounter) {
                candidateCounter++;
            } else {
                suffix++;
            }
        }
    }

    private async isTargetOccupied(
        path: string,
        sourcePath: string,
        context: ReorganizeContext
    ): Promise<boolean> {
        if (path === sourcePath) return false;
        if (context.reservedPaths.has(path)) return true;
        return this.isStoredTargetOccupied(path, sourcePath);
    }

    private async isStoredTargetOccupied(
        path: string,
        sourcePath: string
    ): Promise<boolean> {
        if (path === sourcePath) return false;
        if (this.app.vault.getAbstractFileByPath(path)) return true;
        return this.app.vault.adapter.exists(path);
    }

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
                    return {
                        ref,
                        sourcePath: null,
                        isTrigger: false,
                    };
                }

                const imageFile = this.resolveImageFromRef(ref.path, noteFile);
                const isTrigger = scopePaths.has(noteFile.path) && !(
                    this.settings.skipWikiRefsOnReorganize && ref.format === 'wiki'
                );
                return {
                    ref,
                    sourcePath: imageFile?.path ?? null,
                    forcedFormat: isTrigger ? convertFormat : undefined,
                    isTrigger,
                };
            });

            const referencesPlannedImage = references.some(
                (entry) => entry.sourcePath !== null && context.images.has(entry.sourcePath)
            );
            if (referencesPlannedImage) {
                plans.push({ file: noteFile, references });
            }
        }

        return plans;
    }

    private async movePlannedImages(context: ReorganizeContext): Promise<void> {
        for (const image of context.images.values()) {
            while (true) {
                if (image.targetPath === image.sourcePath) {
                    image.finalPath = image.sourcePath;
                    break;
                }

                context.reservedPaths.delete(image.targetPath);
                if (await this.isTargetOccupied(image.targetPath, image.sourcePath, context)) {
                    image.targetPath = await this.allocateTargetPath(
                        image.file,
                        image.noteFile,
                        context,
                        image.namingTime
                    );
                    continue;
                }
                context.reservedPaths.add(image.targetPath);

                const targetDir = image.targetPath.substring(
                    0,
                    image.targetPath.lastIndexOf('/')
                );
                try {
                    await this.ensureDirectory(targetDir);
                    const sourceParentPath = image.file.parent?.path;
                    await this.app.vault.rename(image.file, image.targetPath);
                    image.finalPath = image.targetPath;
                    context.moved++;
                    if (sourceParentPath) {
                        context.movedParentPaths.add(sourceParentPath);
                    }
                    break;
                } catch {
                    if (await this.isStoredTargetOccupied(
                        image.targetPath,
                        image.sourcePath
                    )) {
                        context.reservedPaths.delete(image.targetPath);
                        image.targetPath = await this.allocateTargetPath(
                            image.file,
                            image.noteFile,
                            context,
                            image.namingTime
                        );
                        continue;
                    }

                    image.failed = true;
                    image.finalPath = image.sourcePath;
                    context.failed++;
                    context.reservedPaths.delete(image.targetPath);
                    break;
                }
            }
        }
    }

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
                    if (!plannedRef.isTrigger && image.finalPath === image.sourcePath) continue;

                    const newRef = this.buildReference(
                        currentRef,
                        image.finalPath,
                        notePlan.file,
                        plannedRef.forcedFormat ?? currentRef.format
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
            const currentPath = decodePathSegments(currentRef.path).replace(/\\/g, '/');
            const originalPath = decodePathSegments(plannedRef.ref.path).replace(/\\/g, '/');
            if (currentPath === originalPath) return true;

            const image = context.images.get(plannedRef.sourcePath);
            if (!image || image.failed) return false;
            const resolved = this.resolveImageFromRef(currentRef.path, notePlan.file);
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
            if (noteDir) {
                refPath = this.refConverter.computeRelativePath(noteDir, finalPath);
            }
        }
        return `![${ref.altText}](${encodePathSegments(refPath)})`;
    }

    /** 从引用路径解析出图片 TFile */
    private resolveImageFromRef(refPath: string, noteFile?: TFile): TFile | null {
        const decodedPath = decodePathSegments(refPath).replace(/\\/g, '/');

        if (noteFile) {
            const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
                decodedPath,
                noteFile.path
            );
            if (linkedFile) {
                return linkedFile instanceof TFile && this.isImageFile(linkedFile)
                    ? linkedFile
                    : null;
            }
        }

        const pathCandidates = new Map<string, TFile>();
        const explicitPath = this.resolveExplicitVaultPath(decodedPath);
        if (explicitPath) {
            this.addImagePathCandidate(pathCandidates, explicitPath);
        }
        if (noteFile) {
            const relativePath = this.resolveRelativeVaultPath(decodedPath, noteFile);
            if (relativePath) {
                this.addImagePathCandidate(pathCandidates, relativePath);
            }
        }

        if (pathCandidates.size === 1) {
            return [...pathCandidates.values()][0] ?? null;
        }
        if (pathCandidates.size > 1) return null;
        if (decodedPath.includes('/')) return null;

        const filename = decodedPath.split('/').pop() ?? decodedPath;
        const matches = this.app.vault.getFiles().filter(
            (file) => this.isImageFile(file) && file.name === filename
        );
        return matches.length === 1 ? matches[0]! : null;
    }

    private resolveExplicitVaultPath(path: string): string | null {
        const withoutLeadingSlash = path.replace(/^\/+/, '');
        if (!withoutLeadingSlash) return null;
        if (path.startsWith('./') || path.startsWith('../')) return null;
        if (!path.startsWith('/') && !path.includes('/')) return null;
        return withoutLeadingSlash;
    }

    private resolveRelativeVaultPath(path: string, noteFile: TFile): string | null {
        if (path.startsWith('/')) return null;
        if (!path.includes('/')) return null;

        const parts = (noteFile.parent?.path ?? '').split('/').filter(Boolean);
        for (const segment of path.split('/')) {
            if (!segment || segment === '.') continue;
            if (segment === '..') {
                if (parts.length === 0) return null;
                parts.pop();
                continue;
            }
            parts.push(segment);
        }
        return parts.join('/') || null;
    }

    private addImagePathCandidate(candidates: Map<string, TFile>, path: string): void {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile && this.isImageFile(file)) {
            candidates.set(file.path, file);
        }
    }

    private isImageFile(file: TFile): boolean {
        return this.settings.supportedExtensions.includes(file.extension.toLowerCase());
    }

    private isExternalReference(path: string): boolean {
        return path.startsWith('http://') || path.startsWith('https://');
    }

    private async ensureDirectory(dirPath: string): Promise<void> {
        if (!dirPath) return;

        const parts = dirPath.split('/');
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!this.app.vault.getAbstractFileByPath(current)) {
                await this.app.vault.createFolder(current).catch(() => {});
            }
        }
    }
}
