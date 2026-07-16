import { describe, expect, it } from 'vitest';
import { getOrphanBadgeLabel } from '../src/modals/image-browser-orphan-label';

describe('Image browser orphan label', () => {
    const image = { path: 'images/photo.png' };
    const getPath = (item: typeof image) => item.path;

    it('shows a badge only for a known orphan image', () => {
        expect(getOrphanBadgeLabel(
            image,
            getPath,
            new Set(['images/photo.png']),
            'Orphan'
        )).toBe('Orphan');
        expect(getOrphanBadgeLabel(
            image,
            getPath,
            new Set(['images/other.png']),
            'Orphan'
        )).toBeNull();
    });

    it('does not guess while orphan status is still unavailable', () => {
        expect(getOrphanBadgeLabel(image, getPath, null, 'Orphan')).toBeNull();
    });
});
