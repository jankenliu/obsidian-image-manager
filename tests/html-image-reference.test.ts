import { describe, expect, it } from 'vitest';
import {
    decodeHtmlAttributeValue,
    extractHtmlImageReferences,
} from '../src/utils/html-image-reference';

describe('HTML image references', () => {
    it('extracts the user-provided HTML image tag', () => {
        const source = '<img src="../assets/tencentdb/logo.png" alt="TencentDB Agent Memory" width="880" />';

        expect(extractHtmlImageReferences(source)).toEqual([
            { src: '../assets/tencentdb/logo.png', index: 0 },
        ]);
    });

    it('supports case, attribute order, quotes, unquoted values, and multiline tags', () => {
        const source = [
            '<IMG alt="cover"',
            "  SRC='../assets/one.png'>",
            '<img width=200 src=../assets/two.png />',
        ].join('\n');

        expect(extractHtmlImageReferences(source).map((reference) => reference.src)).toEqual([
            '../assets/one.png',
            '../assets/two.png',
        ]);
    });

    it('decodes common and numeric HTML entities in image sources', () => {
        expect(decodeHtmlAttributeValue(
            'https://cdn.example.com/photo.png?width=880&amp;height=440&#x26;fit=cover'
        )).toBe('https://cdn.example.com/photo.png?width=880&height=440&fit=cover');
    });

    it('does not treat data-src as the image source', () => {
        expect(extractHtmlImageReferences('<img data-src="lazy.png" alt="lazy">')).toEqual([]);
    });
});
