import { describe, expect, it } from 'vitest';
import { buildCanonicalQuery, parseObjectListXml } from '../src/uploaders/object-list';

describe('Object list helpers', () => {
    it('sorts and encodes canonical query parameters', () => {
        expect(buildCanonicalQuery([
            ['max-keys', '1000'],
            ['continuation-token', 'next+/='],
            ['list-type', '2'],
        ])).toBe('continuation-token=next%2B%2F%3D&list-type=2&max-keys=1000');
    });

    it('parses object metadata, XML entities, and pagination', () => {
        const page = parseObjectListXml(`
            <ListBucketResult>
                <IsTruncated>true</IsTruncated>
                <NextContinuationToken>next&amp;page</NextContinuationToken>
                <Contents>
                    <Key>images/图 &amp; photo.png</Key>
                    <LastModified>2026-07-15T01:02:03.000Z</LastModified>
                    <Size>2048</Size>
                </Contents>
            </ListBucketResult>
        `);

        expect(page).toEqual({
            objects: [{
                key: 'images/图 & photo.png',
                size: 2048,
                modified: Date.parse('2026-07-15T01:02:03.000Z'),
            }],
            isTruncated: true,
            nextToken: 'next&page',
        });
    });
});
