import type { App } from 'obsidian';
import type { HostedImage } from '../types';
import { MD_IMAGE_REGEX } from '../constants';

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

/** Find hosted images whose public URL is not embedded in any Markdown note. */
export async function findOrphanHostedImages(app: App, images: HostedImage[]): Promise<HostedImage[]> {
    const referencedUrls = new Set<string>();
    const imagePattern = new RegExp(MD_IMAGE_REGEX.source, 'g');

    for (const file of app.vault.getMarkdownFiles()) {
        const content = await app.vault.cachedRead(file);
        imagePattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = imagePattern.exec(content)) !== null) {
            const normalizedUrl = normalizeHostedImageUrl(match[2] ?? '');
            if (normalizedUrl) referencedUrls.add(normalizedUrl);
        }
    }

    return images.filter((image) => {
        const normalizedUrl = normalizeHostedImageUrl(image.url);
        return normalizedUrl === null || !referencedUrls.has(normalizedUrl);
    });
}
