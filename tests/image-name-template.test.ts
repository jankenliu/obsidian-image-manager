import { describe, expect, it } from 'vitest';
import {
    appendImageNameSuffix,
    imageNamingTemplateUsesCounter,
    renderImageNameTemplate,
    sanitizeImageFileName,
} from '../src/utils/image-name-template';

describe('图片命名模板', () => {
    const now = new Date(2026, 6, 21, 2, 3, 4, 5);

    it('只按照配置模板中出现的变量生成名称', () => {
        expect(renderImageNameTemplate('截图-{date}-{time}-{counter}', 'png', 0, now)).toBe(
            '截图-2026-07-21-020304-0.png'
        );
        expect(renderImageNameTemplate('固定名称', 'jpg', 8, now)).toBe('固定名称.jpg');
        expect(renderImageNameTemplate('图片-{unknown}-{counter}', 'png', 2, now)).toBe(
            '图片-{unknown}-2.png'
        );
    });

    it('保持现有时间变量语义', () => {
        expect(renderImageNameTemplate(
            '{year}-{month}-{day}-{timestamp}',
            'webp',
            3,
            now
        )).toBe(`2026-07-21-${now.getTime()}.webp`);
    });

    it('清理名称并保留一个原扩展名', () => {
        expect(renderImageNameTemplate('  我的  图片:*?.PNG', 'png', 0, now)).toBe('我的-图片.png');
        expect(renderImageNameTemplate('  :*?  ', 'svg', 0, now)).toBe('image.svg');
        expect(sanitizeImageFileName('photo.png ', 'png')).toBe('photo.png');
    });

    it('手动名称只执行清理而不替换模板变量', () => {
        expect(sanitizeImageFileName('自定义-{date}.PNG', 'png')).toBe('自定义-{date}.png');
    });

    it('规范化一个前导点并拒绝无效扩展名', () => {
        expect(renderImageNameTemplate('图片', '.png', 0, now)).toBe('图片.png');
        expect(() => sanitizeImageFileName('图片', '')).toThrow('图片扩展名不能为空');
        expect(() => sanitizeImageFileName('图片', '.')).toThrow('图片扩展名不能为空');

        for (const extension of ['p ng', 'png/jpg', 'png\\jpg', 'pn:g', 'pn*g']) {
            expect(() => renderImageNameTemplate('图片', extension, 0, now)).toThrow(
                '图片扩展名包含非法字符'
            );
        }
    });

    it('识别 counter 变量并追加普通冲突后缀', () => {
        expect(imageNamingTemplateUsesCounter('image-{counter}')).toBe(true);
        expect(imageNamingTemplateUsesCounter('image-{timestamp}')).toBe(false);
        expect(appendImageNameSuffix('photo.png', 2)).toBe('photo-2.png');
    });
});
