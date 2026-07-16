export interface MarkdownImageReference {
    fullMatch: string;
    altText: string;
    destination: string;
    index: number;
}

/** Extract Markdown image embeds while preserving balanced parentheses in destinations. */
export function extractMarkdownImageReferences(text: string): MarkdownImageReference[] {
    const references: MarkdownImageReference[] = [];
    let searchFrom = 0;

    while (searchFrom < text.length) {
        const start = text.indexOf('![', searchFrom);
        if (start === -1) break;
        const altEnd = findClosingBracket(text, start + 2);
        if (altEnd === -1 || text[altEnd + 1] !== '(') {
            searchFrom = start + 2;
            continue;
        }

        const destinationStart = altEnd + 2;
        const referenceEnd = findClosingParenthesis(text, destinationStart);
        if (referenceEnd === -1) {
            searchFrom = start + 2;
            continue;
        }

        const destination = extractDestination(text.slice(destinationStart, referenceEnd));
        if (destination !== null) {
            references.push({
                fullMatch: text.slice(start, referenceEnd + 1),
                altText: unescapeMarkdownPunctuation(text.slice(start + 2, altEnd)),
                destination,
                index: start,
            });
        }
        searchFrom = referenceEnd + 1;
    }

    return references;
}

function findClosingBracket(text: string, contentStart: number): number {
    let nestedDepth = 0;
    for (let index = contentStart; index < text.length; index++) {
        const character = text[index];
        if (character === '\\') {
            index++;
        } else if (character === '[') {
            nestedDepth++;
        } else if (character === ']') {
            if (nestedDepth === 0) return index;
            nestedDepth--;
        }
    }
    return -1;
}

function findClosingParenthesis(text: string, contentStart: number): number {
    let nestedDepth = 0;
    let inAngleDestination = false;
    let titleQuote: '"' | "'" | null = null;
    let hasNonWhitespace = false;

    for (let index = contentStart; index < text.length; index++) {
        const character = text[index];
        if (character === '\\') {
            index++;
            hasNonWhitespace = true;
            continue;
        }
        if (inAngleDestination) {
            if (character === '>') inAngleDestination = false;
            continue;
        }
        if (titleQuote) {
            if (character === titleQuote) titleQuote = null;
            continue;
        }
        if (!hasNonWhitespace && character === '<') {
            inAngleDestination = true;
            hasNonWhitespace = true;
            continue;
        }
        if ((character === '"' || character === "'")
            && index > contentStart
            && /\s/.test(text[index - 1] ?? '')) {
            titleQuote = character;
            hasNonWhitespace = true;
            continue;
        }
        if (character === '(') {
            nestedDepth++;
            hasNonWhitespace = true;
        } else if (character === ')') {
            if (nestedDepth === 0) return index;
            nestedDepth--;
        } else if (!/\s/.test(character ?? '')) {
            hasNonWhitespace = true;
        }
    }
    return -1;
}

function extractDestination(rawContent: string): string | null {
    const content = rawContent.trim();
    if (!content) return null;
    if (content.startsWith('<')) {
        const closingAngle = findUnescapedCharacter(content, '>', 1);
        if (closingAngle === -1) return null;
        return unescapeMarkdownPunctuation(content.slice(1, closingAngle));
    }

    let nestedDepth = 0;
    for (let index = 0; index < content.length; index++) {
        const character = content[index];
        if (character === '\\') {
            index++;
        } else if (character === '(') {
            nestedDepth++;
        } else if (character === ')') {
            nestedDepth = Math.max(0, nestedDepth - 1);
        } else if (/\s/.test(character ?? '') && nestedDepth === 0) {
            const remainder = content.slice(index).trimStart();
            if (/^["'(]/.test(remainder)) {
                return unescapeMarkdownPunctuation(content.slice(0, index));
            }
        }
    }
    return unescapeMarkdownPunctuation(content);
}

function findUnescapedCharacter(text: string, target: string, start: number): number {
    for (let index = start; index < text.length; index++) {
        if (text[index] === '\\') index++;
        else if (text[index] === target) return index;
    }
    return -1;
}

function unescapeMarkdownPunctuation(value: string): string {
    return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
}
