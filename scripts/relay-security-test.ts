import { webcrypto } from 'node:crypto'
import { EncryptedRelay, RelayMessage } from '../src/lib/relay'

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
if (!globalThis.btoa) globalThis.btoa = s => Buffer.from(s, 'binary').toString('base64')
if (!globalThis.atob) globalThis.atob = s => Buffer.from(s, 'base64').toString('binary')

process.env.NEXT_PUBLIC_RELAY_BROKERS = 'wss://broker.emqx.io:8084/mqtt;wss://broker.hivemq.com:8884/mqtt;wss://test.mosquitto.org:8081/mqtt'
delete (process.env as unknown as Record<string,string>).NEXT_PUBLIC_RELAY_BROKERS // silence if module cached
process.env.NEXT_PUBLIC_RELAY_BROKERS = 'wss://broker.emqx.io:8084/mqtt'

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
  if (!ok) failures++
}
  const waitFor = async (fn: () => boolean, ms: number) => {
  const end = Date.now() + ms
  while (!fn() && Date.now() < end) await new Promise(r => setTimeout(r, 100))
  return fn()
}

async function main() {
  const code = `S${Date.now().toString(36).slice(-4)}`.toUpperCase()
  const otherCode = `${code}X`

  const victimMsgs: RelayMessage[] = []
  ;(process as unknown as Record<string,unknown>).__debug = true
  const victim = new EncryptedRelay(code, 'victim', m => victimMsgs.push(m), () => undefined)
  const honest = new EncryptedRelay(code, 'honest', () => undefined, () => undefined)
  // same room code, but claims to be "honest" after honest already spoke
  const impostor = new EncryptedRelay(code, 'honest', () => undefined, () => undefined)
  // different room code entirely
  const outsider = new EncryptedRelay(otherCode, 'outsider', () => undefined, () => undefined)

  await Promise.all([victim.start(), honest.start(), impostor.start(), outsider.start()])
  await waitFor(() => victim.connected && honest.connected && impostor.connected && outsider.connected, 20000)
  check(victim.connected && honest.connected, 'relay mesh connected')
  console.log(`   mesh endpoints: victim=${victim.connectedCount}, honest=${honest.connectedCount}`)

  // 1. legitimate delivery, pinning "honest" to its real key
  await honest.send('intent', { t: 'legit' }, undefined, 'legit-1')
  await waitFor(() => victimMsgs.some(m => m.id === 'legit-1'), 12000)
  check(victimMsgs.filter(m => m.id === 'legit-1').length === 1, 'genuine packet delivered exactly once')

  // 2. impostor reuses the same `from` with a DIFFERENT signing key
  await impostor.send('state', { forged: true }, undefined, 'forged-1')
  await new Promise(r => setTimeout(r, 6000))
  check(!victimMsgs.some(m => m.id === 'forged-1'), 'sender-key impersonation rejected')

  // 3. wrong room code cannot inject anything
  await outsider.send('intent', { t: 'outsider' }, undefined, 'outsider-1')
  await new Promise(r => setTimeout(r, 4000))
  check(!victimMsgs.some(m => m.id === 'outsider-1'), 'foreign room key rejected')

  // 4. duplicates across the mesh collapse to one delivery
  await honest.send('intent', { t: 'dupe' }, undefined, 'dupe-1')
  await honest.send('intent', { t: 'dupe' }, undefined, 'dupe-1')
  await waitFor(() => victimMsgs.some(m => m.id === 'dupe-1'), 10000)
  await new Promise(r => setTimeout(r, 3000))
  check(victimMsgs.filter(m => m.id === 'dupe-1').length === 1, 'mesh duplicates deduplicated')

  for (const r of [victim, honest, impostor, outsider]) r.stop()
  console.log(failures === 0 ? '\nALL RELAY SECURITY TESTS PASSED' : `\n${failures} FAILURES`)
  process.exit(failures ? 1 : 0)
}

void main().catch(e => { console.error(e); process.exit(1) })
