import { MqttLite } from '../src/lib/mqttlite'

async function one(url: string) {
  const topic = `vp-retain/${Date.now()}-${Math.random().toString(16).slice(2)}`
  const payload = `retained-${Math.random()}`

  const pub = new MqttLite(url, { connectTimeout: 8000 })
  pub.start()
  if (!(await pub.waitOpen())) { pub.end(); return false }
  await pub.publish(topic, payload, { qos: 1, retain: true })
  pub.end()

  const sub = new MqttLite(url, { connectTimeout: 8000 })
  let seen: string | null = null
  let seenRetain = false
  sub.onMessage = (p, retain) => { seen = new TextDecoder().decode(p); seenRetain = retain }
  sub.start()
  await sub.subscribe(topic)
  const end = Date.now() + 9000
  while (seen === null && Date.now() < end) await new Promise(r => setTimeout(r, 100))
  // clear test residue
  if (await pub.waitOpen()) await pub.publish(topic, '', { qos: 1, retain: true })
  sub.end(); pub.end()
  return seen === payload && seenRetain
}

void (async () => {
  for (const u of ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt']) {
    console.log(u, await one(u) ? 'RETAIN OK' : 'RETAIN FAILED')
  }
})()
