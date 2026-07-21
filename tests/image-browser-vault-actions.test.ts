import { describe, expect, it } from 'vitest';
import { ImageBrowserVaultActionState } from '../src/modals/image-browser-vault-actions';

describe('Image browser vault actions', () => {
    it('shows the actions only for local images', () => {
        const state = new ImageBrowserVaultActionState();

        expect(state.isVisible('local')).toBe(true);
        expect(state.isVisible('hosting')).toBe(false);
    });

    it('prevents a second vault action while one is running', () => {
        const state = new ImageBrowserVaultActionState();

        expect(state.start()).toBe(true);
        expect(state.isRunning()).toBe(true);
        expect(state.start()).toBe(false);

        state.finish();

        expect(state.isRunning()).toBe(false);
        expect(state.start()).toBe(true);
    });
});
