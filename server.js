/**
 * Production server: SvelteKit handler + RCRS kernel → WebSocket proxy.
 *
 * Usage:
 *   node server.js
 *
 * Environment variables:
 *   PORT=3000  (default: 3000)
 */

import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { handler } from './build/handler.js'
import { handleRcrsViewer } from './rcrsProxy.js'

const server = createServer(handler)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
  if (url.pathname !== '/proxy') return

  const tcpHost = url.searchParams.get('host') ?? 'localhost'
  const tcpPort = parseInt(url.searchParams.get('port') ?? '7001')

  wss.handleUpgrade(request, socket, head, (ws) => {
    handleRcrsViewer(ws, tcpHost, tcpPort)
  })
})

const PORT = parseInt(process.env.PORT ?? '3000')
server.listen(PORT, () => {
  console.log(`SimScope running at http://localhost:${PORT}`)
})
