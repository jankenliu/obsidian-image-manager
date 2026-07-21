import { App, TFile, normalizePath } from 'obsidian';
import { ImageScanner } from './image-scanner';
import { WIKI_IMAGE_REGEX } from '../constants';
import { extractHtmlImageReferences } from './html-image-reference';
import { extractMarkdownImageReferences } from './markdown-image-reference';

export interface OrphanResult {
    orphans: TFile[];
    total: number;
    referenced: number;
}

export class OrphanFinder {
    private app: App;
    private scanner: ImageScanner;

    constructor(app: App, supportedExtensions: string[]) {
        this.app = app;
        this.scanner = new ImageScanner(app, supportedExtensions);
    }

    /**
     * 查找所有未被任何笔记引用的孤立图片
     */
    async findOrphans(): Promise<OrphanResult> {
        const allImages = this.scanner.getAllImages();
        const referencedPaths = await this.getAllReferencedImages();

        const orphans = allImages.filter((file) => {
            return !referencedPaths.has(file.path);
        });

        return {
            orphans,
            total: allImages.length,
            referenced: allImages.length - orphans.length,
        };
    }

    /**
     * 获取所有笔记中引用的图片路径集合
     */
    private async getAllReferencedImages(): Promise<Set<string>> {
        const referenced = new Set<string>();
        const mdFiles = this.app.vault.getMarkdownFiles();

        for (const file of mdFiles) {
            const content = await this.app.vault.cachedRead(file);
            this.extractReferences(content, referenced, file.path);
        }

        return referenced;
    }

    /**
     * 获取引用指定图片的笔记路径和所有引用行号列表
     */
    async getReferencingNotes(file: TFile): Promise<Array<{ path: string; lines: number[] }>> {
        const notes: Array<{ path: string; lines: number[] }> = [];
        const mdFiles = this.app.vault.getMarkdownFiles();

        for (const mdFile of mdFiles) {
            const content = await this.app.vault.cachedRead(mdFile);
            const lines = this.findReferenceLines(content, file, mdFile.path);
            if (lines.length > 0) {
                notes.push({ path: mdFile.path, lines });
            }
        }

        return notes;
    }

    private findReferenceLines(text: string, file: TFile, notePath: string): number[] {
        const result: number[] = [];

        // Check markdown references
        let match: RegExpExecArray | null;
        for (const reference of extractMarkdownImageReferences(text)) {
            if (this.matchesFilePath(reference.destination, file, notePath)) {
                result.push(this.getLineNumber(text, reference.index));
            }
        }

        // Check wiki references
        WIKI_IMAGE_REGEX.lastIndex = 0;
        while ((match = WIKI_IMAGE_REGEX.exec(text)) !== null) {
            const path = match[1]?.trim();
            if (path && this.matchesFilePath(path, file, notePath)) {
                result.push(this.getLineNumber(text, match.index));
            }
        }

        // Check HTML <img src="path"> references
        for (const reference of extractHtmlImageReferences(text)) {
            if (this.isLocalPath(reference.src) && this.matchesFilePath(
                reference.src,
                file,
                notePath
            )) {
                result.push(this.getLineNumber(text, reference.index));
            }
        }

        return result.sort((left, right) => left - right);
    }

    private resolveRelative(baseDir: string, relativePath: string): string {
        const baseParts = baseDir.split('/').filter(Boolean);
        const relParts = relativePath.split('/').filter(Boolean);
        const parts = [...baseParts];
        for (const part of relParts) {
            if (part === '..') {
                parts.pop();
            } else if (part !== '.') {
                parts.push(part);
            }
        }
        return normalizePath(parts.join('/'));
    }

    private tryDecode(path: string): string {
        try { return decodeURIComponent(path); } catch { return path; }
    }

    private isLocalPath(path: string): boolean {
        return !/^(?:https?:|data:|blob:)/i.test(path);
    }

    private matchesFilePath(path: string, file: TFile, notePath: string): boolean {
        if (!this.isLocalPath(path)) return false;
        return this.resolveLocalReferencePaths(path, notePath).has(file.path);
    }

    private getLineNumber(text: string, index: number): number {
        return text.substring(0, index).split('\n').length - 1;
    }

    private addLocalReference(path: string, result: Set<string>, notePath: string): void {
        if (!this.isLocalPath(path)) return;
        for (const resolvedPath of this.resolveLocalReferencePaths(path, notePath)) {
            result.add(resolvedPath);
        }
    }

    private resolveLocalReferencePaths(path: string, notePath: string): Set<string> {
        const result = new Set<string>();
        const decoded = this.tryDecode(path);
        const metadataMatch = this.app.metadataCache?.getFirstLinkpathDest(decoded, notePath);
        if (metadataMatch instanceof TFile) result.add(metadataMatch.path);

        const noteDir = notePath.substring(0, notePath.lastIndexOf('/'));
        if (decoded.startsWith('/')) {
            result.add(normalizePath(decoded.slice(1)));
        } else if (decoded.startsWith('../') || decoded.startsWith('./')) {
            result.add(this.resolveRelative(noteDir, decoded));
            result.add(normalizePath(decoded.replace(/^(?:\.\.\/|\.\/)+/, '')));
        } else if (decoded.includes('/')) {
            result.add(normalizePath(decoded));
            result.add(this.resolveRelative(noteDir, decoded));
        } else {
            result.add(normalizePath(noteDir ? `${noteDir}/${decoded}` : decoded));
            result.add(normalizePath(decoded));
        }

        if (!decoded.includes('/')) {
            const filenameMatches = this.app.vault.getFiles().filter((file) =>
                file.name === decoded
            );
            if (filenameMatches.length === 1) result.add(filenameMatches[0]!.path);
        }

        return result;
    }

    /**
     * 从文本中提取所有图片引用路径
     */
    private extractReferences(text: string, result: Set<string>, notePath: string): void {
        let match: RegExpExecArray | null;

        // Reset lastIndex
        WIKI_IMAGE_REGEX.lastIndex = 0;

        // Markdown references: ![alt](path)
        for (const reference of extractMarkdownImageReferences(text)) {
            this.addLocalReference(reference.destination, result, notePath);
        }

        // Wiki references: ![[path]] or ![[path|alt]]
        while ((match = WIKI_IMAGE_REGEX.exec(text)) !== null) {
            const path = match[1]?.trim();
            if (path) this.addLocalReference(path, result, notePath);
        }

        // HTML references: <img src="path">
        for (const reference of extractHtmlImageReferences(text)) {
            this.addLocalReference(reference.src, result, notePath);
        }
    }
}
