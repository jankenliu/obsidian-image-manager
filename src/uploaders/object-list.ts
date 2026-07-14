export interface ListedObject {
    key: string;
    size: number;
    modified: number;
}

export interface ObjectListPage {
    objects: ListedObject[];
    isTruncated: boolean;
    nextToken: string;
}

function encodeQueryComponent(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

/** Build a sorted RFC 3986 query string suitable for OSS V4 and AWS SigV4. */
export function buildCanonicalQuery(params: Array<[string, string]>): string {
    return params
        .map(([key, value]) => [encodeQueryComponent(key), encodeQueryComponent(value)] as const)
        .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
            leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
        )
        .map(([key, value]) => `${key}=${value}`)
        .join('&');
}

function decodeXml(value: string): string {
    return value
        .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
        .replace(/&#x([\da-f]+);/gi, (_match, code: string) =>
            String.fromCodePoint(Number.parseInt(code, 16))
        )
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function getTagValue(xml: string, tag: string): string {
    const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
    return match ? decodeXml(match[1]!.trim()) : '';
}

/** Parse the common ListObjectsV2 XML shape returned by OSS and S3. */
export function parseObjectListXml(xml: string): ObjectListPage {
    const objects: ListedObject[] = [];
    const contentsPattern = /<Contents>([\s\S]*?)<\/Contents>/g;
    let match: RegExpExecArray | null;

    while ((match = contentsPattern.exec(xml)) !== null) {
        const contents = match[1]!;
        const key = getTagValue(contents, 'Key');
        if (!key) continue;

        const size = Number(getTagValue(contents, 'Size'));
        const modified = Date.parse(getTagValue(contents, 'LastModified'));
        objects.push({
            key,
            size: Number.isFinite(size) ? size : 0,
            modified: Number.isNaN(modified) ? 0 : modified,
        });
    }

    return {
        objects,
        isTruncated: getTagValue(xml, 'IsTruncated').toLowerCase() === 'true',
        nextToken: getTagValue(xml, 'NextContinuationToken'),
    };
}

export function getObjectName(key: string): string {
    return key.split('/').pop() || key;
}
