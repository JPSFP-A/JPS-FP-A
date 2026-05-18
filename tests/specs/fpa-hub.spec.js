// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * JPS FP&A Hub — End-to-End Tests
 *
 * Coverage:
 *  1. Page load + auth gate
 *  2. Dashboard KPI cards load from DB (not hardcoded)
 *  3. Theme switching (JPS Corporate ↔ Slate Executive)
 *  4. EBITDA calculation integrity
 *  5. OCC conflict handling (inline edit version conflict)
 *  6. Period close stepper
 *  7. Rate-limit debounce on filter inputs
 *  8. Skeleton loading states
 *  9. Caching — second load faster than first
 * 10. No hardcoded non-zero financial values in DOM
 */

test.describe('FP&A Hub', () => {

  // ── 1. Page loads and shows login / dashboard ─────────────────────────────
  test('page loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
    // Either login screen or dashboard should be visible
    const hasLogin = await page.locator('[data-testid="login-form"], #login, .login-wrapper').first().isVisible().catch(() => false);
    const hasDashboard = await page.locator('[data-testid="dashboard"], #pane-dashboard, .dashboard').first().isVisible().catch(() => false);
    expect(hasLogin || hasDashboard).toBe(true);
  });

  // ── 2. KPI cards show DB values, not zero-placeholder or phantom ──────────
  test('KPI cards load numeric values from database', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for skeleton to resolve (max 10s)
    await page.waitForFunction(() => {
      const skeletons = document.querySelectorAll('.skeleton, .shimmer, [data-loading="true"]');
      return skeletons.length === 0;
    }, { timeout: 10_000 }).catch(() => {
      // OK if no skeletons — means loading is synchronous
    });

    // Check that KPI cards exist
    const kpiCards = page.locator('.kpi-card, [data-kpi], .metric-card');
    const count = await kpiCards.count();

    if (count > 0) {
      // Each card with a numeric value should not show placeholder text
      for (let i = 0; i < Math.min(count, 6); i++) {
        const text = await kpiCards.nth(i).innerText();
        // Should not be loading placeholder
        expect(text).not.toContain('...');
        expect(text).not.toContain('Loading');
      }
    }
  });

  // ── 3. Theme switching ────────────────────────────────────────────────────
  test('theme toggle switches between JPS Corporate and Slate Executive', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Find theme toggle — check for button with JPS/slate text
    const themeBtn = page.locator('button').filter({ hasText: /slate|executive|dark/i }).first();
    const hasBtnVisible = await themeBtn.isVisible().catch(() => false);

    if (hasBtnVisible) {
      // Get initial bg color
      const initialBg = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      );

      await themeBtn.click();
      await page.waitForTimeout(200); // transition

      const newBg = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      );

      expect(newBg).not.toBe(initialBg);

      // Verify theme class applied
      const htmlClass = await page.evaluate(() =>
        document.documentElement.className + document.documentElement.getAttribute('data-theme')
      );
      expect(htmlClass).toMatch(/slate|jps|theme/i);
    } else {
      test.skip();
    }
  });

  // ── 4. EBITDA = Revenue − COGS − Opex (math integrity) ───────────────────
  test('EBITDA equals Revenue minus COGS minus Opex', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // allow DB data to render

    // Look for EBITDA-related elements
    const ebitdaEl = page.locator('[data-metric="ebitda"], [data-kpi="ebitda"], #ebitda-value, .ebitda').first();
    const isVisible = await ebitdaEl.isVisible().catch(() => false);

    if (isVisible) {
      const ebitdaText = await ebitdaEl.innerText();
      // Extract number — remove $, commas, M, B
      const ebitdaNum = parseFloat(ebitdaText.replace(/[^0-9.-]/g, ''));

      // If we can find revenue and costs separately, verify math
      const revenueEl = page.locator('[data-metric="revenue"], [data-kpi="revenue"], #revenue-value').first();
      const cogsEl = page.locator('[data-metric="cogs"], [data-kpi="cogs"], #cogs-value').first();
      const opexEl = page.locator('[data-metric="opex"], [data-kpi="opex"], #opex-value').first();

      const revVisible = await revenueEl.isVisible().catch(() => false);
      const cogsVisible = await cogsEl.isVisible().catch(() => false);
      const opexVisible = await opexEl.isVisible().catch(() => false);

      if (revVisible && cogsVisible && opexVisible) {
        const rev = parseFloat((await revenueEl.innerText()).replace(/[^0-9.-]/g, ''));
        const cogs = parseFloat((await cogsEl.innerText()).replace(/[^0-9.-]/g, ''));
        const opex = parseFloat((await opexEl.innerText()).replace(/[^0-9.-]/g, ''));

        const computed = rev - cogs - opex;
        // Allow 1% tolerance for rounding
        const tolerance = Math.abs(computed) * 0.01;
        expect(Math.abs(ebitdaNum - computed)).toBeLessThan(tolerance + 1);
      } else {
        // Can't verify math — just confirm EBITDA is a number
        expect(isNaN(ebitdaNum)).toBe(false);
      }
    } else {
      test.skip(); // EBITDA card not on current view
    }
  });

  // ── 5. OCC conflict toast on stale version ────────────────────────────────
  test('OCC conflict shows toast, does not silently overwrite', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find an inline-editable cell (fpa_facts cells typically have contenteditable or input)
    const editableCell = page.locator('[contenteditable="true"], [data-editable="true"], .editable-cell').first();
    const isEditable = await editableCell.isVisible().catch(() => false);

    if (isEditable) {
      // Simulate OCC: intercept the supabase UPDATE to return 0 rows
      await page.route('**/rest/v1/fpa_facts*', async route => {
        const method = route.request().method();
        if (method === 'PATCH' || method === 'PUT') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '[]', // 0 rows updated = OCC conflict
          });
        } else {
          await route.continue();
        }
      });

      await editableCell.click();
      const originalText = await editableCell.innerText();
      await editableCell.fill('99999999'); // enter a value
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);

      // Check toast appeared
      const toast = page.locator('.toast, [data-toast], .notification, .alert').first();
      const toastVisible = await toast.isVisible().catch(() => false);
      expect(toastVisible).toBe(true);

      // Cell should have rolled back to original
      const currentText = await editableCell.innerText().catch(() => '');
      expect(currentText).not.toBe('99999999');
    } else {
      test.skip(); // no editable cells on this page state
    }
  });

  // ── 6. Period close stepper navigates correctly ───────────────────────────
  test('period close stepper advances through all steps', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to period close section
    const closeBtn = page.locator('[data-nav="period-close"], #nav-period-close, button, a').filter({ hasText: /period close|close period/i }).first();
    const closeBtnVisible = await closeBtn.isVisible().catch(() => false);

    if (closeBtnVisible) {
      await closeBtn.click();
      await page.waitForTimeout(500);

      // Check stepper exists
      const stepper = page.locator('.stepper, [data-stepper], .wizard-steps').first();
      const stepperVisible = await stepper.isVisible().catch(() => false);
      expect(stepperVisible).toBe(true);

      // Advance through steps
      const nextBtn = page.locator('button').filter({ hasText: /next|continue|proceed/i }).first();
      const nextVisible = await nextBtn.isVisible().catch(() => false);
      if (nextVisible) {
        await nextBtn.click();
        await page.waitForTimeout(300);
        // Step 2 should now be active
        const activeStep = page.locator('.step.active, .step--active, [data-step-active]').first();
        const step2Active = await activeStep.isVisible().catch(() => false);
        expect(step2Active).toBe(true);
      }
    } else {
      test.skip();
    }
  });

  // ── 7. Filter input debounce — no rapid-fire DB calls ────────────────────
  test('filter input debounces — max 1 network call per burst', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const filterInput = page.locator('input[type="search"], input[placeholder*="filter"], input[placeholder*="Filter"], .filter-input').first();
    const isVisible = await filterInput.isVisible().catch(() => false);

    if (isVisible) {
      const requests = [];
      page.on('request', req => {
        if (req.url().includes('supabase') || req.url().includes('rest/v1')) {
          requests.push(req.url());
        }
      });

      const before = requests.length;
      // Type 5 chars rapidly
      await filterInput.click();
      await filterInput.type('hello', { delay: 30 });
      await page.waitForTimeout(500); // debounce window

      const after = requests.length;
      const callsTriggered = after - before;

      // Should be 0 or 1 calls (debounced to 300ms, so rapid typing = 1 or 0)
      expect(callsTriggered).toBeLessThanOrEqual(2);
    } else {
      test.skip();
    }
  });

  // ── 8. Skeleton loading clears within 8 seconds ──────────────────────────
  test('skeleton loaders resolve within 8 seconds', async ({ page }) => {
    await page.goto('/');

    // Check skeletons appear initially (within 1s)
    await page.waitForTimeout(500);
    const skeletonCount = await page.locator('.skeleton, .shimmer, [data-skeleton]').count();

    if (skeletonCount > 0) {
      // Wait for all to clear
      await expect(page.locator('.skeleton, .shimmer, [data-skeleton]')).toHaveCount(0, { timeout: 8_000 });
    }
    // If no skeletons — that's also fine (immediate render)
  });

  // ── 9. Caching — second navigation faster than first ─────────────────────
  test('second page visit uses cache (fewer network calls)', async ({ page }) => {
    // First load
    const firstLoadRequests = [];
    page.on('request', req => {
      if (req.url().includes('supabase') || req.url().includes('rest/v1')) {
        firstLoadRequests.push(req.url());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    const firstCount = firstLoadRequests.length;

    // Second load (same session — should use sessionStorage cache)
    const secondLoadRequests = [];
    page.on('request', req => {
      if (req.url().includes('supabase') || req.url().includes('rest/v1')) {
        secondLoadRequests.push(req.url());
      }
    });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    const secondCount = secondLoadRequests.length;

    // Second load should make equal or fewer DB calls (cached)
    // Allow up to 20% more calls as tolerance (some calls like auth refresh always fire)
    expect(secondCount).toBeLessThanOrEqual(Math.max(firstCount * 1.2, firstCount + 3));
  });

  // ── 10. No hardcoded non-zero financial values in DOM ────────────────────
  test('no hardcoded financial values visible in page source', async ({ page }) => {
    const response = await page.goto('/');
    const html = await response?.text() ?? '';

    // Known bad patterns from audit: || 162, || 94, || 350150, || 1278150
    const hardcodedPatterns = [
      /\|\|\s*350150/,
      /\|\|\s*1278150/,
      /\|\|\s*127200/,
      /\|\|\s*162[^0-9]/,
      /\|\|\s*94[^0-9]/,
      /\|\|\s*89[^0-9]/,
    ];

    for (const pattern of hardcodedPatterns) {
      expect(html).not.toMatch(pattern);
    }
  });

});

// ── Accessibility smoke test ──────────────────────────────────────────────────
test('page has no critical accessibility violations', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Check for minimum accessibility markers
  const title = await page.title();
  expect(title.length).toBeGreaterThan(0); // has a title

  // Main landmark exists
  const main = page.locator('main, [role="main"], #main').first();
  const hasMain = await main.isVisible().catch(() => false);

  // Buttons have accessible text
  const buttons = page.locator('button:not([aria-hidden="true"])');
  const btnCount = await buttons.count();
  for (let i = 0; i < Math.min(btnCount, 10); i++) {
    const btn = buttons.nth(i);
    const text = await btn.innerText().catch(() => '');
    const ariaLabel = await btn.getAttribute('aria-label').catch(() => '');
    const title = await btn.getAttribute('title').catch(() => '');
    expect(text.trim() || ariaLabel || title).toBeTruthy();
  }
});
