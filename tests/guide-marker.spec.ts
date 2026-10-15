import { test, expect } from '@playwright/test';

test('guide preserves behind-camera direction and fits portrait and landscape HUD bounds', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const load = (p: string): Promise<any> => import(/* @vite-ignore */ p);
    const THREE = await load('/node_modules/.vite/deps/three.js');
    const { services } = await load('/src/core/Services.ts');
    const { GuideMarker } = await load('/src/ui/hud-guide.ts');
    const camera = new THREE.PerspectiveCamera(60, 1280 / 720, 0.1, 100);
    const target = new THREE.Vector3(10, -1.9, 10);
    const previous = services.tryGet('guide');
    services.register('guide', { sample: () => ({target, custom:true, distance:20}) });
    const marker = new GuideMarker();
    document.body.appendChild(marker.el);
    const avoid = { top:0, bottom:0, left:0, right:0, touch:false, buttons:[], corners:[] };
    marker.render(camera, true, 1280, 720, avoid);
    const arrow = marker.el.querySelector('.hud-guide__arrow') as HTMLElement;
    const read = () => {
      const m = new DOMMatrix(arrow.style.transform);
      return { x:m.m41, y:m.m42, angle:Math.atan2(m.m12, m.m11)*180/Math.PI };
    };
    const right = read();
    target.x = -10;
    marker.render(camera, true, 1280, 720, avoid);
    const left = read();
    camera.aspect = 390/844;
    camera.updateProjectionMatrix();
    target.set(30, 20, -10);
    marker.render(camera, true, 390, 844, {...avoid, touch:true});
    const portrait = read();
    marker.render(camera, false, 390, 844, avoid);
    const hidden = !arrow.classList.contains('is-on');
    marker.dispose();
    if (previous) services.register('guide', previous); else services.unregister('guide');
    return {right,left,portrait,hidden};
  });
  expect(result.right.x).toBeGreaterThan(640);
  expect(result.left.x).toBeLessThan(640);
  expect(result.right.y).toBeGreaterThan(360);
  expect(result.left.y).toBeGreaterThan(360);
  expect(result.portrait.x).toBeGreaterThanOrEqual(46);
  expect(result.portrait.x).toBeLessThanOrEqual(344);
  expect(result.portrait.y).toBeGreaterThanOrEqual(170);
  expect(result.portrait.y).toBeLessThanOrEqual(614);
  expect(result.hidden).toBe(true);
});
