import { MqttLite } from '../src/lib/mqttlite'

const brokers = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker-cn.emqx.io:8084/mqtt',
  'wss://mqtt-dashboard.com:8884/mqtt',
]
const topic = `vp-smoke/${Date.now()}-${Math.random().toString(16).slice(2)}`

async function probe(url: string): Promise<string> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const sub = new MqttLite(url, { connectTimeout: 10000 })
    let got: string | null = null
    sub.onMessage = p => { got = new TextDecoder().decode(p) }
    sub.start()
    const ok = await sub.subscribe(topic)
    if (!ok) { sub.end(); if (attempt === 2) return `${url}: SUBSCRIBE_FAILED`; else continue }

    const pub = new MqttLite(url, { connectTimeout: 10000 })
    pub.start()
    if (!(await pub.waitOpen())) { sub.end(); pub.end(); if (attempt === 2) return `${url}: CONNECT_FAILED`; else continue }
    await pub.publish(topic, 'opaque-test-packet', { qos: 1 })

    const end = Date.now() + 9000
    while (got === null && Date.now() < end) await new Promise(r => setTimeout(r, 100))
    sub.end(); pub.end()
    if (got !== null) return `${url}: OK`
    if (attempt === 2) return `${url}: DELIVERY_TIMEOUT`
  }
  return `${url}: ?`
}

void (async () => { for (const url of brokers) console.log(await probe(url)) })()
