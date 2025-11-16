import { config } from './config/index.js';
import Client from './core/Client.js';
import { helper, logger } from "./utils/index.js";
import { WebSocketServer } from 'ws';
import TokenManager from './core/TokenManager.js';
const manager = new TokenManager();
const server = helper.createServer();
const wss = new WebSocketServer({ server: server });
manager.checkTokens((v) => {
    logger.info(`Checking token done ${v} of ${manager.ts.length} tokens`, 'TokenManager');
    server.listen(config.serverSettings.port, () => {
        logger.info(`Server started on port ${config.serverSettings.port}.`);
    });
    wss.on('connection', (ws) => {
        const client = new Client(ws);
        logger.info(`Client Connected`);
        const handleDisconnect = () => {
            client.stopBots();
            logger.warn("Client Disconnected!");
        };
        ws.on('message', (buffer) => {
            client.handleMessage(buffer);
        });
        ws.on('close', handleDisconnect);
        ws.on('error', handleDisconnect);
    });
});
export { manager };
