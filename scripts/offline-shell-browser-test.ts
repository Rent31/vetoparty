import { chromium } from 'playwright'

const BASE = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3137'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('service worker unsupported')
    await navigator.serviceWorker.ready
  })

  const registration = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready
    return { scope: r.scope, active: !!r.active, controller: !!navigator.serviceWorker.controller }
  })
  console.log('registration:', registration)

  // Ensure the next navigation is controlled. First activation may need one
  // normal reload before navigator.serviceWorker.controller is populated.
  if (!registration.controller) {
    await page.reload({ waitUntil: 'networkidle' })
    await page.evaluate(() => navigator.serviceWorker.ready)
  }

  await context.setOffline(true)

  // Existing invite URLs must work offline through the cached /room shell.
  await page.goto(`${BASE}/room/ABCDE`, { waitUntil: 'domcontentloaded', timeout: 10000 })
  await page.getByText(/NAME YOURSELF|SUMMONING THE COUNCIL/i).first().waitFor({ timeout: 5000 })
  const roomText = await page.locator('body').innerText()
  const roomOk = !/ERR_INTERNET_DISCONNECTED|temporarily unreachable/i.test(roomText)
  console.log(`offline /room/CODE shell: ${roomOk}`)

  // Home also stays available.
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 10000 })
  await page.getByText('VETO PARTY').first().waitFor({ timeout: 5000 })
  const homeOk = await page.getByRole('button', { name: /OPEN SESSION/i }).isVisible()
  console.log(`offline home shell:       ${homeOk}`)
  console.log(`page errors:              ${errors.length}`)

  await browser.close()
  const ok = registration.active && roomOk && homeOk && errors.length === 0
  console.log(ok ? 'OFFLINE SHELL BROWSER TEST PASSED' : 'OFFLINE SHELL BROWSER TEST FAILED')
  process.exit(ok ? 0 : 1)
}

void main().catch(err => { console.error(err); process.exit(1) })
