const COUNTER_TOKEN = '{counter}';
const INVALID_EXTENSION_CHARACTERS = /[\s/\\:*?"<>|]/;

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeImageExtension(extension: string): string {
    const normalizedExtension = extension.replace(/^\./, '');
    if (!normalizedExtension) {
        throw new Error('图片扩展名不能为空');
    }
    if (INVALID_EXTENSION_CHARACTERS.test(normalizedExtension)) {
        throw new Error('图片扩展名包含非法字符');
    }
    return normalizedExtension;
}

export function sanitizeImageFileName(name: string, extension: string): string {
    const normalizedExtension = normalizeImageExtension(extension);
    const extensionPattern = new RegExp(
        `(?:\\.${escapeRegExp(normalizedExtension)})+$`,
        'i'
    );
    let base = name
        .replace(/\s+/g, '-')
        .replace(/[/\\:*?"<>|]/g, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
    base = base
        .replace(extensionPattern, '')
        .replace(/^-+|-+$/g, '');

    return `${base || 'image'}.${normalizedExtension}`;
}

export function imageNamingTemplateUsesCounter(template: string): boolean {
    return template.includes(COUNTER_TOKEN);
}

export function renderImageNameTemplate(
    template: string,
    extension: string,
    counter: number,
    now: Date = new Date()
): string {
    const variables: Record<string, string> = {
        date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
        time: `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`,
        timestamp: String(now.getTime()),
        year: String(now.getFullYear()),
        month: String(now.getMonth() + 1).padStart(2, '0'),
        day: String(now.getDate()).padStart(2, '0'),
        counter: String(counter),
    };

    let rendered = template;
    for (const [key, value] of Object.entries(variables)) {
        rendered = rendered.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }

    return sanitizeImageFileName(rendered, extension);
}

export function appendImageNameSuffix(filename: string, suffix: number): string {
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex <= 0) return `${filename}-${suffix}`;
    return `${filename.substring(0, dotIndex)}-${suffix}${filename.substring(dotIndex)}`;
}
