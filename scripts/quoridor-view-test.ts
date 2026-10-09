export {}

/**
 * The board is rotated per player for display only. These tests pin the
 * transform so a rotated view can never desync from the canonical state.
 */

type Turn = 0 | 1 | 2 | 3
const SEAT_TURNS: Turn[] = [0, 2, 1, 3]

const toView = (r: number, c: number, k: Turn): [number, number] => {
  let R = r, C = c
  for (let i = 0; i < k; i++) { const nr = C, nc = 8 - R; R = nr; C = nc }
  return [R, C]
}
const fromView = (R: number, C: number, k: Turn): [number, number] => {
  let r = R, c = C
  for (let i = 0; i < k; i++) { const pr = 8 - c, pc = r; r = pr; c = pc }
  return [r, c]
}
const flip = (o: 'h' | 'v'): 'h' | 'v' => (o === 'h' ? 'v' : 'h')
interface F { r: number; c: number; o: 'h' | 'v' }
const fenceToView = (f: F, k: Turn): F => {
  let r = f.r, c = f.c, o = f.o
  for (let i = 0; i < k; i++) { const nr = c, nc = 7 - r; r = nr; c = nc; o = flip(o) }
  return { r, c, o }
}
const fenceFromView = (f: F, k: Turn): F => {
  let r = f.r, c = f.c, o = f.o
  for (let i = 0; i < k; i++) { const pr = 7 - c, pc = r; r = pr; c = pc; o = flip(o) }
  return { r, c, o }
}
const goalEdge = (g: { t: 'r' | 'c'; v: number }) =>
  g.t === 'r' ? (g.v === 0 ? 0 : 2) : (g.v === 0 ? 3 : 1)

const Q_SEATS = [
  { r: 8, c: 4, goal: { t: 'r' as const, v: 0 } },
  { r: 0, c: 4, goal: { t: 'r' as const, v: 8 } },
  { r: 4, c: 8, goal: { t: 'c' as const, v: 0 } },
  { r: 4, c: 0, goal: { t: 'c' as const, v: 8 } },
]

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
  if (!ok) failures++
}

// 1. round trip for every cell and every rotation
{
  let bad = 0
  let outOfRange = 0
  for (const k of [0, 1, 2, 3] as Turn[]) {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const [R, C] = toView(r, c, k)
      if (R < 0 || R > 8 || C < 0 || C > 8) outOfRange++
      const [br, bc] = fromView(R, C, k)
      if (br !== r || bc !== c) bad++
    }
  }
  check(bad === 0, 'cell transform round trips for all 81 cells x 4 rotations')
  check(outOfRange === 0, 'rotated cells always stay on the board')
}

// 2. rotation is a bijection (no two cells collide)
{
  let collisions = 0
  for (const k of [0, 1, 2, 3] as Turn[]) {
    const seen = new Set<string>()
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const key = toView(r, c, k).join(',')
      if (seen.has(key)) collisions++
      seen.add(key)
    }
  }
  check(collisions === 0, 'cell rotation is a bijection (no overlap)')
}

// 3. fences round trip, stay in range, and alternate orientation
{
  let bad = 0, outOfRange = 0, wrongOrient = 0
  for (const k of [0, 1, 2, 3] as Turn[]) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      for (const o of ['h', 'v'] as const) {
        const v = fenceToView({ r, c, o }, k)
        if (v.r < 0 || v.r > 7 || v.c < 0 || v.c > 7) outOfRange++
        const expected = k % 2 === 0 ? o : flip(o)
        if (v.o !== expected) wrongOrient++
        const back = fenceFromView(v, k)
        if (back.r !== r || back.c !== c || back.o !== o) bad++
      }
    }
  }
  check(bad === 0, 'fence transform round trips for all 128 fences x 4 rotations')
  check(outOfRange === 0, 'rotated fences stay within the 8x8 gap grid')
  check(wrongOrient === 0, 'odd rotations flip fence orientation, even ones preserve it')
}

// 4. THE POINT: every seat sees itself at the bottom, goal at the top
{
  for (let seat = 0; seat < 4; seat++) {
    const k = SEAT_TURNS[seat]
    const { r, c, goal } = Q_SEATS[seat]
    const [R, C] = toView(r, c, k)
    check(R === 8, `seat ${seat}: own pawn starts on the bottom row (row ${R})`)
    check(C === 4, `seat ${seat}: own pawn starts centred (col ${C})`)
    const displayedGoalEdge = (goalEdge(goal) + k) % 4
    check(displayedGoalEdge === 0, `seat ${seat}: goal renders on the top edge`)
  }
}

// 5. a fence blocks the SAME pair of cells before and after rotation
{
  // horizontal fence (r,c) separates (r,c)|(r+1,c) and (r,c+1)|(r+1,c+1)
  const blockedPairs = (f: F): string[] => {
    const pairs: [number, number, number, number][] = f.o === 'h'
      ? [[f.r, f.c, f.r + 1, f.c], [f.r, f.c + 1, f.r + 1, f.c + 1]]
      : [[f.r, f.c, f.r, f.c + 1], [f.r + 1, f.c, f.r + 1, f.c + 1]]
    return pairs.map(([a, b, cc, d]) => [`${a},${b}`, `${cc},${d}`].sort().join('|')).sort()
  }

  let mismatches = 0
  for (const k of [1, 2, 3] as Turn[]) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      for (const o of ['h', 'v'] as const) {
        const canonical = blockedPairs({ r, c, o })
        // rotate the fence, then rotate its blocked cells back to canonical
        const v = fenceToView({ r, c, o }, k)
        const viewPairs = blockedPairs(v).map(pair =>
          pair.split('|').map(cell => {
            const [R, C] = cell.split(',').map(Number)
            return fromView(R, C, k).join(',')
          }).sort().join('|'),
        ).sort()
        if (JSON.stringify(canonical) !== JSON.stringify(viewPairs)) mismatches++
      }
    }
  }
  check(mismatches === 0, 'a rotated fence blocks exactly the same cell pairs (no desync)')
}

console.log(failures === 0 ? '\nALL QUORIDOR VIEW TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
