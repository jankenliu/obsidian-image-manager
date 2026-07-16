import { describe, expect, it, vi } from 'vitest';
import {
    deleteBatchItems,
    ImageBrowserBatchSelection,
} from '../src/modals/image-browser-batch';

describe('Image browser batch selection', () => {
    it('keeps local and hosted selections independent', () => {
        const selection = new ImageBrowserBatchSelection();

        selection.selectAll('local', ['a.png', 'b.png']);
        selection.setSelected('hosting', 'remote/a.png', true);
        selection.setSelected('local', 'a.png', false);

        expect(selection.getKeys('local')).toEqual(['b.png']);
        expect(selection.getKeys('hosting')).toEqual(['remote/a.png']);
    });

    it('retains only selections that still exist in the orphan result', () => {
        const selection = new ImageBrowserBatchSelection();
        selection.selectAll('local', ['a.png', 'b.png', 'c.png']);

        selection.retain('local', ['a.png', 'c.png']);
        selection.remove('local', ['a.png']);

        expect(selection.getCount('local')).toBe(1);
        expect(selection.isSelected('local', 'c.png')).toBe(true);
    });
});

describe('Image browser batch deletion', () => {
    it('continues deleting after one item fails and reports partial results', async () => {
        const deleteItem = vi.fn(async (item: string) => {
            if (item === 'b.png') throw new Error('Delete failed');
        });

        const result = await deleteBatchItems(['a.png', 'b.png', 'c.png'], deleteItem);

        expect(deleteItem).toHaveBeenCalledTimes(3);
        expect(result.deleted).toEqual(['a.png', 'c.png']);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]?.item).toBe('b.png');
    });
});
