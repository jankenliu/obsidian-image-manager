import type { App } from 'obsidian';
import type { HostedImage } from '../types';
import { extractHtmlImageReferences } from './html-image-reference';
import { extractMarkdownImageReferences } from './markdown-image-reference';

export interface HostedImageReferencingNote {
    path: string;
    lines: number[];
}

interface ExternalImageReference {
    value: string;
    index: number;
}

function extractMarkdownDestination(rawDestination: string): string {
    const trimmed = rawDestination.trim();
    if (trimmed.startsWith('<')) {
        const closingBracket = trimmed.indexOf('>');
        return closingBracket > 0 ? trimmed.slice(1, closingBracket) : trimmed;
    }

    const titleStart = trimmed.search(/\s+["']/);
    return titleStart === -1 ? trimmed : trimmed.slice(0, titleStart);
}

/**
 * Normalize a hosted image URL for reference comparison.
 * Query parameters and fragments are ignored because CDNs commonly append image transformations.
 */
export function normalizeHostedImageUrl(value: string): string | null {
    try {
        const url = new URL(extractMarkdownDestination(value));
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        const pathname = url.pathname.replace(/%[\da-f]{2}/gi, (encodedByte) =>
            encodedByte.toUpperCase()
        );
        return `${url.origin}${pathname}`;
    } catch {
        return null;
    }
}

/** Return zero-based line numbers where a hosted image is embedded in Markdown. */
export function findHostedImageReferenceLines(text: string, imageUrl: string): number[] {
    const targetUrl = normalizeHostedImageUrl(imageUrl);
    if (!targetUrl) return [];

    const lines: number[] = [];
    for (const reference of extractExternalImageReferences(text)) {
        if (normalizeHostedImageUrl(reference.value) === targetUrl) {
            lines.push(getLineNumber(text, reference.index));
        }
    }

    return lines;
}

/** Find every Markdown note and line that embeds the hosted image. */
export async function getHostedImageReferencingNotes(
    app: App,
    image: HostedImage
): Promise<HostedImageReferencingNote[]> {
    const notes: HostedImageReferencingNote[] = [];

    for (const file of app.vault.getMarkdownFiles()) {
        const content = await app.vault.cachedRead(file);
        const lines = findHostedImageReferenceLines(content, image.url);
        if (lines.length > 0) notes.push({ path: file.path, lines });
    }

    return notes;
}

/** Find hosted images whose public URL is not embedded in any Markdown note. */
export async function findOrphanHostedImages(app: App, images: HostedImage[]): Promise<HostedImage[]> {
    const referencedUrls = new Set<string>();

    for (const file of app.vault.getMarkdownFiles()) {
        const content = await app.vault.cachedRead(file);
        for (const reference of extractExternalImageReferences(content)) {
            const normalizedUrl = normalizeHostedImageUrl(reference.value);
            if (normalizedUrl) referencedUrls.add(normalizedUrl);
        }
    }

    return images.filter((image) => {
        const normalizedUrl = normalizeHostedImageUrl(image.url);
        return normalizedUrl === null || !referencedUrls.has(normalizedUrl);
    });
}

function extractExternalImageReferences(text: string): ExternalImageReference[] {
    const references: ExternalImageReference[] = [];
    for (const reference of extractMarkdownImageReferences(text)) {
        references.push({ value: reference.destination, index: reference.index });
    }
    for (const reference of extractHtmlImageReferences(text)) {
        references.push({ value: reference.src, index: reference.index });
    }
    return references.sort((left, right) => left.index - right.index);
}

function getLineNumber(text: string, index: number): number {
    return text.substring(0, index).split('\n').length - 1;
}
