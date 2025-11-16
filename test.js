const net = require('net');
const crypto = require('crypto');

class AgarIoProtocol {
    constructor() {
        this.packetTypes = {
            SPECTATE: 1,
            PLAY: 2,
            RECONNECT: 3,
            MOVEMENT: 16,
            SPLIT: 17,
            Q_ACTION: 18  // Q key action
        };
    }

    // Encode packet for Agar.io protocol
    encodePacket(type, data = '') {
        const stringData = String(data);
        const buffer = Buffer.alloc(1 + 2 + stringData.length);
        
        buffer.writeUInt8(type, 0); // Packet type
        buffer.writeUInt16LE(stringData.length, 1); // Data length
        buffer.write(stringData, 3); // Data
        
        return buffer;
    }

    // Decode packet from Agar.io protocol
    decodePacket(buffer) {
        if (buffer.length < 3) return null;
        
        const type = buffer.readUInt8(0);
        const length = buffer.readUInt16LE(1);
        
        if (buffer.length < 3 + length) return null;
        
        const data = buffer.slice(3, 3 + length).toString();
        
        return { type, data, raw: buffer };
    }
}

class AgarIoTcpBot {
    constructor() {
        this.protocol = new AgarIoProtocol();
        this.socket = null;
        this.playerId = null;
        this.gameState = {
            cells: [],
            foods: [],
            viruses: [],
            leaderboard: []
        };
        
        this.config = {
            host: 'ec2-3-139-68-38.us-east-2.compute.amazonaws.com',
            port: 9001,
            reconnectDelay: 2000,
            botName: 'NodeJS_Bot'
        };
        
        this.isConnected = false;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            console.log(`🔗 Connecting to ${this.config.host}:${this.config.port}`);
            
            this.socket = new net.Socket();
            
            this.socket.on('connect', () => {
                console.log('✅ Connected to Agar.io server');
                this.isConnected = true;
                this.authenticate();
                resolve();
            });
            
            this.socket.on('data', (data) => {
                this.handleData(data);
            });
            
            this.socket.on('error', (error) => {
                console.error('❌ Socket error:', error.message);
                this.isConnected = false;
                reject(error);
            });
            
            this.socket.on('close', () => {
                console.log('🔌 Connection closed');
                this.isConnected = false;
                this.handleReconnect();
            });
            
            this.socket.connect(this.config.port, this.config.host);
        });
    }

    authenticate() {
        console.log('🔑 Authenticating...');
        
        // Send player name
        const playPacket = this.protocol.encodePacket(
            this.protocol.packetTypes.PLAY, 
            this.config.botName
        );
        this.socket.write(playPacket);
        
        console.log(`🎮 Joined as: ${this.config.botName}`);
    }

    handleData(data) {
        try {
            const packets = this.splitPackets(data);
            
            packets.forEach(packetBuffer => {
                const packet = this.protocol.decodePacket(packetBuffer);
                if (packet) {
                    this.processPacket(packet);
                }
            });
        } catch (error) {
            console.error('Error processing data:', error);
        }
    }

    splitPackets(data) {
        const packets = [];
        let offset = 0;
        
        while (offset < data.length) {
            if (data.length - offset < 3) break;
            
            const type = data.readUInt8(offset);
            const length = data.readUInt16LE(offset + 1);
            const packetEnd = offset + 3 + length;
            
            if (packetEnd > data.length) break;
            
            const packetData = data.slice(offset, packetEnd);
            packets.push(packetData);
            
            offset = packetEnd;
        }
        
        return packets;
    }

    processPacket(packet) {
        switch (packet.type) {
            case this.protocol.packetTypes.RECONNECT:
                this.handleReconnectPacket(packet.data);
                break;
                
            case 32: // Game state update
                this.handleGameState(packet.data);
                break;
                
            case 64: // Player ID assignment
                this.handlePlayerId(packet.data);
                break;
                
            default:
                // console.log(`Unknown packet type: ${packet.type}, Data: ${packet.data}`);
                break;
        }
    }

    handleReconnectPacket(data) {
        console.log('🔄 Received reconnect packet');
        
        try {
            // Parse reconnect information
            const reconnectInfo = JSON.parse(data);
            console.log('Reconnect info:', reconnectInfo);
            
            // Update connection to new server
            this.config.host = reconnectInfo.host;
            this.config.port = reconnectInfo.tcpPort || 9001;
            
            // Reconnect after delay
            setTimeout(() => {
                this.reconnect();
            }, this.config.reconnectDelay);
            
        } catch (error) {
            console.error('Error parsing reconnect packet:', error);
        }
    }

    handlePlayerId(data) {
        this.playerId = data;
        console.log(`👤 Player ID assigned: ${this.playerId}`);
    }

    handleGameState(data) {
        // Agar.io uses custom binary protocol for game state
        // This is a simplified version - real implementation would need full protocol docs
        try {
            this.parseGameStateBinary(data);
            this.makeBotDecision();
        } catch (error) {
            // console.log('Game state parsing error:', error.message);
        }
    }

    parseGameStateBinary(data) {
        // Simplified game state parser
        // Note: Real implementation requires full protocol documentation
        this.gameState = {
            cells: this.extractCells(data),
            foods: this.extractFoods(data),
            viruses: this.extractViruses(data),
            timestamp: Date.now()
        };
    }

    extractCells(data) {
        const cells = [];
        // Simplified cell extraction - real implementation would parse binary data properly
        return cells;
    }

    extractFoods(data) {
        const foods = [];
        // Simplified food extraction
        return foods;
    }

    extractViruses(data) {
        const viruses = [];
        // Simplified virus extraction
        return viruses;
    }

    makeBotDecision() {
        if (!this.gameState.cells || this.gameState.cells.length === 0) {
            // No cells found, send random movement
            this.sendRandomMovement();
            return;
        }

        // Simple bot logic
        if (this.gameState.foods && this.gameState.foods.length > 0) {
            this.moveToNearestFood();
        } else {
            this.sendRandomMovement();
        }
    }

    moveToNearestFood() {
        // Simplified movement logic
        const randomX = (Math.random() - 0.5) * 2;
        const randomY = (Math.random() - 0.5) * 2;
        
        this.sendMovement(randomX, randomY);
    }

    sendMovement(x, y) {
        // Normalize coordinates
        const mouseX = Math.max(-1, Math.min(1, x));
        const mouseY = Math.max(-1, Math.min(1, y));
        
        // Create movement data (protocol specific)
        const movementData = `${mouseX.toFixed(3)},${mouseY.toFixed(3)}`;
        
        const movementPacket = this.protocol.encodePacket(
            this.protocol.packetTypes.MOVEMENT,
            movementData
        );
        
        if (this.socket && this.isConnected) {
            this.socket.write(movementPacket);
        }
    }

    sendSplit() {
        console.log('🔪 Splitting cell');
        const splitPacket = this.protocol.encodePacket(
            this.protocol.packetTypes.SPLIT,
            ''
        );
        
        if (this.socket && this.isConnected) {
            this.socket.write(splitPacket);
        }
    }

    sendQAction() {
        console.log('⏩ Q action');
        const qPacket = this.protocol.encodePacket(
            this.protocol.packetTypes.Q_ACTION,
            ''
        );
        
        if (this.socket && this.isConnected) {
            this.socket.write(qPacket);
        }
    }

    sendRandomMovement() {
        const x = (Math.random() - 0.5) * 2;
        const y = (Math.random() - 0.5) * 2;
        this.sendMovement(x, y);
    }

    reconnect() {
        console.log('🔄 Attempting reconnect...');
        if (this.socket) {
            this.socket.destroy();
        }
        
        setTimeout(() => {
            this.connect().catch(error => {
                console.error('Reconnect failed:', error.message);
                this.reconnect();
            });
        }, this.config.reconnectDelay);
    }

    handleReconnect() {
        console.log('🔄 Handling reconnect...');
        setTimeout(() => {
            this.reconnect();
        }, this.config.reconnectDelay);
    }

    disconnect() {
        console.log('👋 Disconnecting...');
        this.isConnected = false;
        if (this.socket) {
            this.socket.destroy();
        }
    }
}

// Multi-bot manager
class AgarIoBotManager {
    constructor() {
        this.bots = [];
        this.config = {
            botCount: 5,
            namePrefix: 'NodeBot'
        };
    }

    async startBots() {
        console.log(`🤖 Starting ${this.config.botCount} bots...`);
        
        for (let i = 0; i < this.config.botCount; i++) {
            await this.delay(1000); // Stagger connections
            
            const bot = new AgarIoTcpBot();
            bot.config.botName = `${this.config.namePrefix}_${i + 1}`;
            
            bot.connect().then(() => {
                console.log(`✅ Bot ${i + 1} connected successfully`);
                
                // Start random actions
                setInterval(() => {
                    if (Math.random() < 0.3) {
                        bot.sendRandomMovement();
                    }
                    if (Math.random() < 0.1) {
                        bot.sendSplit();
                    }
                }, 2000 + Math.random() * 3000);
                
            }).catch(error => {
                console.error(`❌ Bot ${i + 1} failed:`, error.message);
            });
            
            this.bots.push(bot);
        }
        
        console.log('🎮 All bots launched');
    }

    stopAllBots() {
        console.log('🛑 Stopping all bots...');
        this.bots.forEach(bot => bot.disconnect());
        this.bots = [];
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Usage examples
async function main() {
    // Single bot
    const singleBot = new AgarIoTcpBot();
    
    // Or multiple bots
    const botManager = new AgarIoBotManager();
    await botManager.startBots();
    
    // Stop after 5 minutes
    setTimeout(() => {
        botManager.stopAllBots();
        process.exit(0);
    }, 5 * 60 * 1000);
}

// Handle process exit
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    process.exit(0);
});

module.exports = { AgarIoTcpBot, AgarIoBotManager };

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}