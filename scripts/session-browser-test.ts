import { chromium, type Page } from 'playwright'

const BASE = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3131'

async function assertNoCrash(page: Page, errors: string[], stage: string) {
  await page.waitForTimeout(500)
  const body = await page.locator('body').innerText()
  if (/SESSION DISRUPTED|Application error|Unhandled Runtime Error/i.test(body)) {
    throw new Error(`${stage}: crash screen shown\n${body.slice(0, 500)}`)
  }
  const real = errors.filter(e =>
    !/WebSocket|ERR_CONNECTION|relay rejected|net::ERR|favicon/i.test(e),
  )
  if (real.length) throw new Error(`${stage}: ${real.join('\n')}`)
}

async function run(label: string, viewport: { width: number; height: number }) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('ENTER A NAME').fill(`TEST${label}`)
  await assertNoCrash(page, errors, `${label} home ready`)

  await page.getByRole('button', { name: /OPEN SESSION/i }).click()
  await page.waitForURL(/\/room\/[A-Z0-9]{5}\?create=1&saved=[01]/, { timeout: 12000 })
  await page.getByText(/THE SENATE/).waitFor({ state: 'visible', timeout: 15000 })
  await page.getByText('FIRST CONSUL').waitFor({ state: 'visible', timeout: 5000 })
  await assertNoCrash(page, errors, `${label} council opened`)

  // Test actual game start too: Spyfall needs three seated members.
  const addBot = page.getByRole('button', { name: /ADD BOT/i })
  await addBot.click()
  await addBot.click()
  await page.getByText(/THE SENATE · 3/i).waitFor({ state: 'visible', timeout: 5000 })
  await assertNoCrash(page, errors, `${label} bots added`)

  const convene = page.getByRole('button', { name: /^CONVENE$/i })
  await convene.click()
  await page.getByText(/THE LOCATION IS|YOU ARE THE SPY/i).first().waitFor({ state: 'visible', timeout: 10000 })
  await assertNoCrash(page, errors, `${label} game started`)

  // Refresh must restore the game and the owner seat.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText(/THE LOCATION IS|YOU ARE THE SPY/i).first().waitFor({ state: 'visible', timeout: 15000 })
  await assertNoCrash(page, errors, `${label} refresh restored`)

  console.log(`${label}: PASS ${page.url()}`)
  await browser.close()
}

async function main() {
  await run('DESKTOP', { width: 1280, height: 850 })
  await run('MOBILE', { width: 390, height: 844 })
  console.log('SESSION BROWSER TEST PASSED')
}

void main().catch(err => { console.error(err); process.exit(1) })
