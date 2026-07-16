import { describe, expect, it } from 'vitest';
import {
    getRemainingScanFeedbackDuration,
    ImageBrowserScanState,
} from '../src/modals/image-browser-scan-state';

describe('Image browser scan state', () => {
    it('tracks the active local or hosting scan', () => {
        const state = new ImageBrowserScanState();
        const token = state.start('local');

        expect(state.isScanning('local')).toBe(true);
        expect(state.isScanning('hosting')).toBe(false);
        expect(state.finish(token, 'local')).toBe(true);
        expect(state.isScanning('local')).toBe(false);
    });

    it('invalidates a scan when another scan starts', () => {
        const state = new ImageBrowserScanState();
        const localToken = state.start('local');
        const hostingToken = state.start('hosting');

        expect(state.isCurrent(localToken, 'local')).toBe(false);
        expect(state.finish(localToken, 'local')).toBe(false);
        expect(state.isCurrent(hostingToken, 'hosting')).toBe(true);
    });

    it('invalidates pending results when the current view cancels scanning', () => {
        const state = new ImageBrowserScanState();
        const token = state.start('hosting');

        state.cancel();

        expect(state.isCurrent(token, 'hosting')).toBe(false);
        expect(state.isScanning('hosting')).toBe(false);
    });

    it('keeps fast scan feedback visible without delaying slow scans', () => {
        expect(getRemainingScanFeedbackDuration(1000, 1100)).toBe(300);
        expect(getRemainingScanFeedbackDuration(1000, 1500)).toBe(0);
        expect(getRemainingScanFeedbackDuration(1000, 1100, 250)).toBe(150);
    });
});
