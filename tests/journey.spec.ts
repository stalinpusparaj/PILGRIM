import { test, expect } from '@playwright/test';

test('discovery rewards persist, deduplicate and reset with the save', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const load = (path: string): Promise<any> => import(/* @vite-ignore */ path);
    const { events } = await load('/src/core/Events.ts');
    const { services } = await load('/src/core/Services.ts');
    const { createGameState } = await load('/src/core/GameState.ts');
    const { Journey } = await load('/src/ui/Journey.ts');
    const state = createGameState();
    const panel = new Journey();
    events.emit('promise:collected', { id: 'p01', total: 1 });
    events.emit('promise:collected', { id: 'p01', total: 1 });
    events.emit('friend:met', { id: 'help' });
    const score = state.flag('journey.score');
    const saved = state.snapshot();
    state.reset(saved);
    events.emit('promise:collected', { id: 'p01', total: 1 });
    const restored = state.flag('journey.score');
    state.reset();
    const reset = state.flag('journey.score');
    panel.dispose();
    services.unregister('state');
    return { score, restored, reset };
  });
  expect(result).toEqual({ score: 75, restored: 75, reset: undefined });
});

test('objective remains visible beyond six seconds and returns after cutscenes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/ui/hud-banners.ts';
    const { ObjectiveLine } = await import(/* @vite-ignore */ path);
    const objective = new ObjectiveLine();
    objective.set('ui.hud.objective.followLight');
    objective.update(10, true);
    const persistent = objective.visible;
    objective.update(1, false);
    const hidden = !objective.visible;
    objective.update(1, true);
    return { persistent, hidden, restored: objective.visible };
  });
  expect(result).toEqual({ persistent: true, hidden: true, restored: true });
});

test('mobile coaching fits a portrait phone and touch joystick is discoverable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?chapter=1&skipIntro=1');
  await page.waitForFunction(() => (window as any).__pilgrim?.modeReady === true);
  await page.evaluate(async () => {
    const path = '/src/core/Services.ts';
    const { services } = await import(/* @vite-ignore */ path);
    const input = services.get('input');
    // Use real touch pointer input to switch the current device.
    document.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    input.setGameplayActive(true);
    const guide = services.tryGet('guide');
    guide?.update(1 / 60);
  });
  await expect(page.locator('.pg-touch')).toBeVisible();
  const stick = page.locator('.pg-touch-stick');
  await expect(stick).toHaveCSS('opacity', '0.38');
});
