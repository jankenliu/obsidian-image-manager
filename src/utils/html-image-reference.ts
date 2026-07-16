export interface HtmlImageReference {
    src: string;
    index: number;
}

const HTML_IMAGE_TAG_REGEX = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const HTML_IMAGE_SRC_REGEX = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

/** Decode entities that can occur in an HTML image source without requiring a DOM. */
export function decodeHtmlAttributeValue(value: string): string {
    return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, code: string) => {
        const lowerCode = code.toLowerCase();
        if (lowerCode.startsWith('#x')) {
            return decodeNumericEntity(Number.parseInt(lowerCode.slice(2), 16), entity);
        }
        if (lowerCode.startsWith('#')) {
            return decodeNumericEntity(Number.parseInt(lowerCode.slice(1), 10), entity);
        }
        const namedEntities: Record<string, string> = {
            amp: '&',
            quot: '"',
            apos: "'",
            lt: '<',
            gt: '>',
        };
        return namedEntities[lowerCode] ?? entity;
    });
}

/** Extract HTML `<img src>` references while preserving their source offsets. */
export function extractHtmlImageReferences(text: string): HtmlImageReference[] {
    const references: HtmlImageReference[] = [];
    HTML_IMAGE_TAG_REGEX.lastIndex = 0;
    let tagMatch: RegExpExecArray | null;

    while ((tagMatch = HTML_IMAGE_TAG_REGEX.exec(text)) !== null) {
        const tag = tagMatch[0];
        const srcMatch = HTML_IMAGE_SRC_REGEX.exec(tag);
        const source = srcMatch?.[1] ?? srcMatch?.[2] ?? srcMatch?.[3];
        if (source !== undefined && source.trim()) {
            references.push({
                src: decodeHtmlAttributeValue(source.trim()),
                index: tagMatch.index,
            });
        }
    }

    return references;
}

function decodeNumericEntity(codePoint: number, fallback: string): string {
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) return fallback;
    try {
        return String.fromCodePoint(codePoint);
    } catch {
        return fallback;
    }
}
