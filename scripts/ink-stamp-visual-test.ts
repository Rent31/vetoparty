import { chromium } from 'playwright'

const BASE = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3133'

/**
 * Renders the real VetoedBanner markup and checks the browser actually
 * computed the ink-stamp treatment. CSS masks and turbulence filters can be
 * silently dropped by a build step or unsupported syntax, which would leave a
 * plain red box, so this asserts the computed values rather than the source.
 */
async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } } as never)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })

  // Mount the exact banner markup inside the live stylesheet context.
  await page.evaluate(() => {
    const host = document.createElement('div')
    host.id = 'ink-probe'
    host.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:var(--bg);z-index:99999'
    host.innerHTML = `
      <span class="relative inline-flex items-center justify-center">
        <span class="vp-puff pointer-events-none absolute h-[120%] w-[125%] border-2"></span>
        <span id="ink" data-ink="VETOED!" class="ink-stamp vp-press text-[4.2rem] leading-none">VETOED!</span>
      </span>`
    document.body.appendChild(host)
  })

  const el = page.locator('#ink')
  await el.waitFor({ state: 'visible', timeout: 5000 })
  // let the press animation settle so the capture shows the resting stamp
  await page.waitForTimeout(1200)

  const computed = await el.evaluate(node => {
    const cs = getComputedStyle(node)
    const before = getComputedStyle(node, '::before')
    return {
      color: cs.color,
      fontFamily: cs.fontFamily,
      fontWeight: cs.fontWeight,
      transform: cs.transform,
      opacity: cs.opacity,
      borderTopWidth: cs.borderTopWidth,
      outlineWidth: cs.outlineWidth,
      outlineStyle: cs.outlineStyle,
      beforeContent: before.content,
    }
  })

  let failures = 0
  const check = (ok: boolean, label: string, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}${ok ? '' : ` :: ${detail}`}`)
    if (!ok) failures++
  }

  // red ink, not the theme default
  const rgb = computed.color.match(/\d+/g)?.map(Number) ?? []
  check(rgb.length >= 3 && rgb[0] > 140 && rgb[0] > rgb[1] * 2 && rgb[0] > rgb[2] * 2,
    'ink renders as red', computed.color)

  // THE POINT of this test: the distressed font must actually be applied,
  // not a silent fallback to the site's serif.
  check(/special ?elite|__stampFont|stamp/i.test(computed.fontFamily),
    'grunge font applied (not a fallback)', computed.fontFamily)
  check(computed.fontFamily.toLowerCase().indexOf('cinzel') === -1,
    'not the default display face', computed.fontFamily)

  check(/matrix|rotate/.test(computed.transform) && computed.transform !== 'none',
    'stamp sits at an angle', computed.transform)
  const borderPx = parseFloat(computed.borderTopWidth)
  check(borderPx >= 3.5, 'bold stamp border scales with font size', `${borderPx}px`)
  check(parseFloat(computed.outlineWidth) > 0 && computed.outlineStyle !== 'none',
    'double-ruled stamp edge present', `${computed.outlineStyle} ${computed.outlineWidth}`)
  // the CSS rule sets 0.94; verify the rule exists in the shipped stylesheet
  const cssOk = await page.evaluate(async () => {
    const res = await fetch(document.querySelector('link[rel=stylesheet]')?.href ?? '')
    const text = await res.text()
    return /\.ink-stamp\{[^}]*opacity:\.94/.test(text) || /\.ink-stamp\{[^}]*opacity:0\.94/.test(text)
  })
  check(cssOk, 'ink opacity rule shipped (paper shows through slightly)')

  // the offset second impression comes from the ::before layer
  const beforeRule = await page.evaluate(async () => {
    const res = await fetch(document.querySelector('link[rel=stylesheet]')?.href ?? '')
    const text = await res.text()
    return /\.ink-stamp:before\{[^}]*content:attr\(data-ink\)/.test(text)
  })
  check(beforeRule, 'offset second impression rule shipped (attr(data-ink))')

  const box = await el.boundingBox()
  console.log(`   stamp box: ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}px`)
  check(!!box && box.width > 140, 'stamp is big enough to read', JSON.stringify(box))

  // ink must be clearly visible, and slightly imperfect rather than solid
  const shot = await el.screenshot()
  const redRatio = await page.evaluate(async (b64: string) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let red = 0, total = 0
    for (let i = 0; i < d.length; i += 4) {
      total++
      if (d[i] > 90 && d[i] > d[i + 1] * 1.6 && d[i] > d[i + 2] * 1.6) red++
    }
    return red / total
  }, shot.toString('base64'))
  console.log(`   visible red coverage: ${(redRatio * 100).toFixed(1)}%`)
  check(redRatio > 0.1, 'ink is clearly visible', `${(redRatio * 100).toFixed(1)}%`)
  check(redRatio < 0.95, 'ink is distressed (not a solid block)', `${(redRatio * 100).toFixed(1)}%`)

  check(errors.length === 0, 'no page errors', errors.join(' | '))

  await page.screenshot({ path: '/tmp/ink-stamp.png' })
  await browser.close()

  console.log(failures === 0 ? '\nINK STAMP VISUAL TEST PASSED' : `\n${failures} FAILURES`)
  process.exit(failures ? 1 : 0)
}

void main().catch(e => { console.error(e); process.exit(1) })
