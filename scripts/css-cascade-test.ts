import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards a subtle CSS cascade bug.
 *
 * An UNLAYERED rule outranks every @layer, so a plain
 *   input, textarea, select, button { color: inherit }
 * silently beat Tailwind's entire utilities layer. Result: `solid` buttons
 * rendered white text on a white background (the unreadable YEA button), and
 * font-size / font-weight utilities were ignored on every control.
 *
 * Form-control resets must therefore live inside @layer base.
 */

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
  if (!ok) failures++
}

function findCss(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...findCss(p))
    else if (e.name.endsWith('.css')) out.push(p)
  }
  return out
}

/** Strip balanced @layer blocks, leaving only unlayered CSS. */
function unlayeredOnly(css: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const at = css.indexOf('@layer', i)
    if (at === -1) { out += css.slice(i); break }
    out += css.slice(i, at)
    const brace = css.indexOf('{', at)
    const semi = css.indexOf(';', at)
    if (brace === -1 || (semi !== -1 && semi < brace)) { i = (semi === -1 ? css.length : semi + 1); continue }
    let depth = 0
    let j = brace
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') { depth--; if (depth === 0) { j++; break } }
    }
    i = j
  }
  return out
}

const files = findCss('.next/static')
check(files.length > 0, `found built CSS (${files.length} file(s))`)

let checked = 0
for (const f of files) {
  const css = readFileSync(f, 'utf8')
  if (!css.includes('--accent-ink')) continue   // not our stylesheet
  checked++

  const bare = unlayeredOnly(css)

  // The bug class: an unlayered rule setting `color` (or the `font` shorthand,
  // which resets colour too) on a form control. A bare `font-size` override is
  // allowed - the iOS anti-zoom rule needs to outrank utilities by design.
  const offenders = [...bare.matchAll(/([^{}]*\b(?:button|input|textarea|select)\b[^{}]*)\{([^}]*)\}/g)]
    .filter(m => /(^|;)\s*(color|font)\s*:/.test(m[2]))
    .map(m => `${m[1].trim().slice(0, 60)} { ${m[2].slice(0, 50)} }`)

  check(offenders.length === 0,
    offenders.length ? `unlayered colour/font reset found: ${offenders[0]}` : 'no unlayered colour reset on form controls')

  // The intentional exception must stay narrow: font-size only, inputs only.
  const iosRule = /@media[^{]*\{[^{}]*input,\s*select,\s*textarea\s*\{([^}]*)\}/.exec(bare)
  check(!iosRule || !/color\s*:/.test(iosRule[1]), 'iOS anti-zoom rule sets no colour')

  // The reset should still exist - inside a layer.
  check(/@layer\s+base/.test(css) && /input,\s*textarea,\s*select,\s*button\s*\{[^}]*color:\s*inherit/.test(css),
    'form-control reset is present and layered')

  // The utilities the buttons depend on must be emitted.
  check(css.includes('.text-white{'), 'text-white utility emitted')
  check(/\.text-\\\[var\\\(--bg\\\)\\\]\{color:var\(--bg\)\}/.test(css), 'text-[var(--bg)] utility emitted (solid button ink)')
}

check(checked > 0, 'located the app stylesheet')
console.log(failures === 0 ? '\nALL CSS CASCADE TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
