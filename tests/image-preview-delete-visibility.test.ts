import { describe, expect, it } from 'vitest';
import { canDeleteImageFromPreview } from '../src/modals/image-preview-delete-visibility';

describe('Image preview delete visibility', () => {
    it('allows deletion only after a successful scan confirms the image is orphaned', () => {
        expect(canDeleteImageFromPreview(true, 0)).toBe(true);
        expect(canDeleteImageFromPreview(true, 2)).toBe(false);
        expect(canDeleteImageFromPreview(false, 0)).toBe(false);
    });

    it('also requires hosted deletion support', () => {
        expect(canDeleteImageFromPreview(true, 0, true)).toBe(true);
        expect(canDeleteImageFromPreview(true, 0, false)).toBe(false);
    });
});
