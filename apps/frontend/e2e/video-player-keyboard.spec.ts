import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Playwright keyboard navigation tests for the course video player.
 *
 * Covers WCAG 2.1 SC 2.1.1 (Keyboard):
 *  - Space toggles play/pause
 *  - ArrowLeft / ArrowRight seek -5s / +5s
 *  - M toggles mute
 *  - F toggles fullscreen
 *  - axe scan reports no critical violations on the player
 */

const PLAYER_SELECTOR = '[data-testid="course-video-player"]';
const VIDEO_SELECTOR = `${PLAYER_SELECTOR} video`;

/**
 * Navigates to a course page that contains the video player and waits for
 * the player to be ready. Adjust the route to match the app's course URL.
 */
async function gotoPlayer(page: Page): Promise<void> {
  await page.goto('/courses/1/lessons/1');
  const player = page.locator(PLAYER_SELECTOR);
  await expect(player).toBeVisible();

  // Wait for the underlying <video> element to be attached and ready.
  const video = page.locator(VIDEO_SELECTOR);
  await expect(video).toBeAttached();
  await video.evaluate((el: HTMLVideoElement) => {
    // Ensure the element is ready enough for state assertions.
    if (el.readyState < 1) {
      return new Promise<void>((resolve) => {
        el.addEventListener('loadedmetadata', () => resolve(), { once: true });
      });
    }
    return undefined;
  });
}

/** Focuses the player container so keyboard events are routed to it. */
async function focusPlayer(page: Page): Promise<void> {
  const player = page.locator(PLAYER_SELECTOR);
  await player.focus();
  await expect(player).toBeFocused();
}

test.describe('Course video player keyboard accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayer(page);
  });

  test('player container is focusable and exposes an accessible name', async ({ page }) => {
    const player = page.locator(PLAYER_SELECTOR);

    // tabIndex={0} makes the container reachable via keyboard.
    await expect(player).toHaveAttribute('tabindex', '0');

    // The container should have an accessible name (aria-label / aria-labelledby).
    const accessibleName = await player.evaluate((el) => {
      const label = el.getAttribute('aria-label');
      if (label) return label;
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        return labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
      }
      return '';
    });
    expect(accessibleName.length).toBeGreaterThan(0);
  });

  test('Space toggles play/pause', async ({ page }) => {
    const video = page.locator(VIDEO_SELECTOR);
    await focusPlayer(page);

    // Ensure playback starts paused.
    await video.evaluate((el: HTMLVideoElement) => el.pause());
    await expect(video).toHaveJSProperty('paused', true);

    // Space -> play
    await page.keyboard.press('Space');
    await expect
      .poll(async () => video.evaluate((el: HTMLVideoElement) => el.paused))
      .toBe(false);

    // Space -> pause
    await page.keyboard.press('Space');
    await expect
      .poll(async () => video.evaluate((el: HTMLVideoElement) => el.paused))
      .toBe(true);
  });

  test('ArrowRight seeks forward 5 seconds', async ({ page }) => {
    const video = page.locator(VIDEO_SELECTOR);
    await focusPlayer(page);

    // Start from a known position with enough headroom to seek forward.
    await video.evaluate((el: HTMLVideoElement) => {
      el.pause();
      el.currentTime = 10;
    });
    await expect
      .poll(async () => video.evaluate((el: HTMLVideoElement) => el.currentTime))
      .toBeGreaterThanOrEqual(10);

    await page.keyboard.press('ArrowRight');

    await expect
      .poll(async () => video.evaluate((el: HTMLVideoElement) => el.currentTime))
      .toBeGreaterThanOrEqual(14.5);
    const currentTime = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
    expect(currentTime).toBeLessThanOrEqual(15.5);
  });

  test('ArrowLeft seeks backward 5 seconds', async ({ page }) => {
    const video = page.locator(VIDEO_SELECTOR);
    await focusPlayer(page);

    // Start far enough in so seeking backward stays >= 0.
    await video.evaluate((el: HTMLVideoElement) => {
      el.pause();
      el.currentTime = 20;
    });
    await expect
      .poll(async () => video.evaluate((el: HTMLVideoElement) => el.currentTime))
      .toBeGreaterThanOrEqual(20);

    await page.keyboard.press('ArrowLeft');

    await expect
      .poll(async () => video.evaluate((el: HTMLVideoElement) => el.currentTime))
      .toBeLessThanOrEqual(15.5);
    const currentTime = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
    expect(currentTime).toBeGreaterThanOrEqual(14.5);
  });

  test('M toggles mute', async ({ page }) => {
    const video = page.locator(VIDEO_SELECTOR);
    await focusPlayer(page);

    // Ensure unmuted to start.
    await video.evaluate((el: HTMLVideoElement) => {
      el.muted = false;
    });
    await expect(video).toHaveJSProperty('muted', false);

    // M -> mute
    await page.keyboard.press('m');
    await expect
      .poll(async () => video.evaluate((el: HTMLVideoElement) => el.muted))
      .toBe(true);

    // M -> unmute
    await page.keyboard.press('m');
    await expect
      .poll(async () => video.evaluate((el: HTMLVideoElement) => el.muted))
      .toBe(false);
  });

  test('F toggles fullscreen', async ({ page }) => {
    const player = page.locator(PLAYER_SELECTOR);
    await focusPlayer(page);

    // Ensure we start out of fullscreen.
    await page.evaluate(() => {
      if (document.fullscreenElement) {
        return document.exitFullscreen();
      }
      return undefined;
    });
    await expect
      .poll(async () => page.evaluate(() => document.fullscreenElement !== null))
      .toBe(false);

    // F -> enter fullscreen
    await page.keyboard.press('f');
    await expect
      .poll(async () => page.evaluate(() => document.fullscreenElement !== null))
      .toBe(true);

    // F -> exit fullscreen
    await page.keyboard.press('f');
    await expect
      .poll(async () => page.evaluate(() => document.fullscreenElement !== null))
      .toBe(false);

    // Sanity: the player element is still present after toggling.
    await expect(player).toBeVisible();
  });

  test('keyboard shortcut legend is visible', async ({ page }) => {
    const legend = page.locator('[data-testid="video-player-shortcuts"]');
    await expect(legend).toBeVisible();

    // The legend should document the supported shortcuts.
    await expect(legend).toContainText(/space/i);
    await expect(legend).toContainText(/arrow/i);
    await expect(legend).toContainText(/m/i);
    await expect(legend).toContainText(/f/i);
  });

  test('axe scan reports no critical violations on the player', async ({ page }) => {
    const player = page.locator(PLAYER_SELECTOR);
    await expect(player).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include(PLAYER_SELECTOR)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const criticalViolations = results.violations.filter(
      (violation) => violation.impact === 'critical',
    );

    // Surface readable diagnostics if the assertion fails.
    expect(
      criticalViolations,
      `Critical axe violations found:\n${JSON.stringify(criticalViolations, null, 2)}`,
    ).toEqual([]);
  });
});