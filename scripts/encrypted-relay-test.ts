import { webcrypto } from 'node:crypto'
import { EncryptedRelay, RelayMessage } from '../src/lib/relay'

// Browser globals used by the transport.
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
if (!globalThis.btoa) globalThis.btoa = s => Buffer.from(s, 'binary').toString('base64')
if (!globalThis.atob) globalThis.atob = s => Buffer.from(s, 'base64').toString('binary')

async function main() {
  const code = `T${Date.now().toString(36).slice(-4)}`.toUpperCase()
  const aMsgs: RelayMessage[] = []
  const bMsgs: RelayMessage[] = []
  const a = new EncryptedRelay(code, 'peer-a', m => aMsgs.push(m), () => undefined)
  const b = new EncryptedRelay(code, 'peer-b', m => bMsgs.push(m), () => undefined)
  await Promise.all([a.start(), b.start()])

  const deadline = Date.now() + 15000
  while ((!a.connected || !b.connected) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 100))
  }
  if (!a.connected || !b.connected) throw new Error('relay did not connect')

  const mid = 'dedup-test-mid'
  await a.send('intent', { t: 'hello', id: 'p1', color: '#abcdef' }, undefined, mid)
  await b.send('state', { code, version: 7, players: ['p1'] }, undefined, 'state-mid', true)

  const delivered = Date.now() + 8000
  while ((aMsgs.length < 1 || bMsgs.length < 1) && Date.now() < delivered) {
    await new Promise(r => setTimeout(r, 100))
  }

  // Both brokers mirror every packet, but each recipient must deliver once.
  const hello = bMsgs.filter(m => m.id === mid)
  const state = aMsgs.filter(m => m.id === 'state-mid')
  console.log(`A brokers=${a.connectedCount}, B brokers=${b.connectedCount}`)
  console.log(`hello deliveries=${hello.length}, state deliveries=${state.length}`)
  console.log(`A received=${aMsgs.map(m => `${m.kind}:${m.id}:${m.from}`).join(',') || 'none'}`)
  console.log(`B received=${bMsgs.map(m => `${m.kind}:${m.id}:${m.from}`).join(',') || 'none'}`)
  console.log(`payload intact=${(hello[0]?.data as { id?: string })?.id === 'p1'}`)

  a.stop(); b.stop()
  if (hello.length !== 1 || state.length !== 1) process.exit(1)
  console.log('ENCRYPTED RELAY TEST PASSED')
}

void main().catch(err => { console.error(err); process.exit(1) })
