import { describe, expect, it } from 'vitest';
import { extractMarkdownImageReferences } from '../src/utils/markdown-image-reference';

describe('Markdown image references', () => {
    it('preserves balanced parentheses in a local image path', () => {
        const source = '![内存问题](linux/assets/内存问题(内存够用但报oom)-1.png)';

        expect(extractMarkdownImageReferences(source)).toEqual([{
            fullMatch: source,
            altText: '内存问题',
            destination: 'linux/assets/内存问题(内存够用但报oom)-1.png',
            index: 0,
        }]);
    });

    it('supports nested and escaped parentheses', () => {
        expect(extractMarkdownImageReferences(
            '![a](assets/a(b(c)d)e.png) ![b](assets/b\\(copy\\).png)'
        ).map((reference) => reference.destination)).toEqual([
            'assets/a(b(c)d)e.png',
            'assets/b(copy).png',
        ]);
    });

    it('extracts angle destinations and ignores an optional title', () => {
        expect(extractMarkdownImageReferences(
            '![a](<assets/a (copy).png> "preview") ![b](assets/b(c).png \'title\')'
        ).map((reference) => reference.destination)).toEqual([
            'assets/a (copy).png',
            'assets/b(c).png',
        ]);
    });

    it('continues parsing later references after malformed input', () => {
        expect(extractMarkdownImageReferences(
            '![broken](assets/a.png\n![valid](assets/b(c).png)'
        ).map((reference) => reference.destination)).toEqual(['assets/b(c).png']);
    });
});
