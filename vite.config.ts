import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { WebSocketServer } from 'ws';
import { handleRcrsViewer } from './rcrsProxy.js';

/**
 * Vite dev-server plugin: RCRS kernel → WebSocket proxy.
 *
 * ブラウザは ws://<host>/proxy?host=<tcp-host>&port=<tcp-port> に接続する。
 * 制御プロトコル (VKConnect → KVConnectOK → KVTimestep) を処理し、
 * JSON メッセージ {type:'INITIAL'|'TIMESTEP'|'ERROR'} としてブラウザに転送する。
 */
function rcrsProxyPlugin(): Plugin {
	return {
		name: 'rcrs-proxy',
		configureServer(server) {
			const wss = new WebSocketServer({ noServer: true });

			server.httpServer?.on('upgrade', (request, socket, head) => {
				const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
				if (url.pathname !== '/proxy') return;

				const tcpHost = url.searchParams.get('host') ?? 'localhost';
				const tcpPort = parseInt(url.searchParams.get('port') ?? '7001', 10);

				if (!tcpPort || tcpPort < 1 || tcpPort > 65535) {
					socket.destroy();
					return;
				}

				wss.handleUpgrade(request, socket, head, (ws) => {
					handleRcrsViewer(ws, tcpHost, tcpPort);
				});
			});
		},
	};
}

export default defineConfig({
	plugins: [sveltekit(), rcrsProxyPlugin()],
	assetsInclude: ['**/*.wasm'],
});
