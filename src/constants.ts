/** Supported image MIME type mappings. */
export const IMAGE_MIME_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    avif: 'image/avif',
};

/** Obsidian Wiki image embeds. Markdown image embeds use the balanced parser. */
export const WIKI_IMAGE_REGEX = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
