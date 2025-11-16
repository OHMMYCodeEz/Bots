import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import { config } from "../config/index.js";
import { fileURLToPath } from 'url';
import { HttpsProxyAgent } from "https-proxy-agent";
import crypto from 'crypto';
import { Agent, request } from 'undici';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MASS_BOOST_FILE = path.join(__dirname, '../data/boost.json');
const PROXY_URL = 'https://raw.githubusercontent.com/vmheaven/VMHeaven-Free-Proxy-Updated/refs/heads/main/https.txt';
const PROXY_FILE = path.join(__dirname, '../config/proxies.txt');

// Logger with colors
const logger = {
    info: (m) => console.log(`\x1b[36m[INFO]\x1b[0m ${m}`),
    warn: (m) => console.log(`\x1b[33m[WARN]\x1b[0m ${m}`),
    error: (m) => console.log(`\x1b[31m[ERROR]\x1b[0m ${m}`),
    success: (m) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${m}`)
};

class CircuitBreaker {
    constructor(failureThreshold = 5, resetTimeout = 60000) {
        this.failureThreshold = failureThreshold;
        this.resetTimeout = resetTimeout;
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.state = 'CLOSED';
    }
    canExecute() {
        if (this.state === 'OPEN' && Date.now() - this.lastFailureTime > this.resetTimeout) {
            this.state = 'HALF_OPEN';
            return true;
        }
        return this.state !== 'OPEN';
    }
    onSuccess() { this.failureCount = 0; this.lastFailureTime = null; this.state = 'CLOSED'; }
    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
            logger.warn(`Circuit Breaker opened (${this.failureCount} failures)`);
        }
    }
}

class RateLimiter {
    constructor(maxRequests, timeWindow) {
        this.maxRequests = maxRequests;
        this.timeWindow = timeWindow;
        this.requests = [];
    }
    canMakeRequest() {
        const now = Date.now();
        this.requests = this.requests.filter(t => now - t < this.timeWindow);
        if (this.requests.length < this.maxRequests) {
            this.requests.push(now);
            return true;
        }
        return false;
    }
    getWaitTime() {
        const now = Date.now();
        this.requests = this.requests.filter(t => now - t < this.timeWindow);
        return this.requests.length > 0 ? Math.max(0, this.requests[0] + this.timeWindow - now) : 0;
    }
}

export const helper = {
    proxies: [],
    previousProxies: new Set(),
    circuitBreaker: new CircuitBreaker(500, 60000),
    rateLimiter: new RateLimiter(6000, 60000),
    proxyHealth: new Map(),
    currentProxyIndex: 0,
    _proxyUpdateTimer: null,

    secureRandom() {
        return Number(crypto.randomBytes(8).readBigUInt64LE()) / Number(BigInt('0x10000000000000000'));
    },

    async init() {
        try {
            // บังคับลบไฟล์เก่าเพื่อดาวน์โหลดใหม่ทุกครั้ง (ทดสอบ)
            if (fs.existsSync(PROXY_FILE)) {
                logger.info('Deleting old proxies.txt for fresh download...');
                fs.unlinkSync(PROXY_FILE);
            }

            await this.downloadProxiesIfNeeded();
            this.setupProxies();
            this.clearExpiredMassBoosts();
            this.startProxyHealthCheck();
            this.startAutoProxyUpdate(); // ต้องเรียกที่นี่

            logger.info('Helper loaded successfully');
        } catch (error) {
            logger.error('Helper init failed: ' + error.message);
            logger.warn('Running without proxies');
        }
    },

    async downloadProxiesIfNeeded() {
        logger.info(`Checking for proxy file: ${PROXY_FILE}`);
        if (fs.existsSync(PROXY_FILE)) {
            logger.info('proxies.txt exists. Skipping download.');
            return;
        }
        logger.info('proxies.txt not found. Downloading from GitHub...');
        await this.updateProxyList();
    },

    async updateProxyList() {
        const oldCount = this.proxies.length;
        const oldSet = new Set(this.proxies);

        logger.info(`Fetching proxy list from: ${PROXY_URL}`);

        try {
            const response = await request(PROXY_URL, { method: 'GET' });
            logger.info(`Response status: ${response.statusCode}`);

            if (!response.body) {
                logger.error('No response body');
                return false;
            }

            const text = await response.body.text();
            logger.info(`Downloaded ${text.length} bytes`);

            const newProxies = text.split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('#') && /^[\d.]+:\d+$/.test(l));

            logger.info(`Parsed ${newProxies.length} valid proxies`);

            if (newProxies.length === 0) {
                logger.warn('No valid proxies found in downloaded list');
                return false;
            }

            const dir = path.dirname(PROXY_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(PROXY_FILE, newProxies.join('\n') + '\n');
            logger.info(`Saved to ${PROXY_FILE}`);

            this.setupProxies();
            this.proxyHealth.clear();
            this.currentProxyIndex = 0;
            await this.checkProxyHealth();

            const newSet = new Set(this.proxies);
            const added = [...newSet].filter(p => !oldSet.has(p)).length;
            const removed = [...oldSet].filter(p => !newSet.has(p)).length;
            const kept = [...newSet].filter(p => oldSet.has(p)).length;

            logger.success(`Proxy list updated: ${oldCount} → ${this.proxies.length} (+${added} / -${removed} / =${kept})`);
            this.previousProxies = oldSet;
            return true;

        } catch (err) {
            logger.error(`Failed to download proxy list: ${err.message}`);
            if (err.cause) logger.error(`Cause: ${err.cause}`);
            return false;
        }
    },

    startAutoProxyUpdate() {
        const INTERVAL = 10 * 60 * 1000; // 10 นาที
        logger.info(`Auto proxy update scheduled every ${INTERVAL / 60000} minutes`);

        let updateCount = 0;
        this._proxyUpdateTimer = setInterval(async () => {
            updateCount++;
            logger.info(`Scheduled update #${updateCount} triggered`);
            const success = await this.updateProxyList();
            if (success) {
                logger.success(`Update #${updateCount} completed`);
            } else {
                logger.warn(`Update #${updateCount} failed`);
            }
        }, INTERVAL);
    },

    setupProxies() {
        try {
            if (!fs.existsSync(PROXY_FILE)) {
                logger.warn('proxies.txt missing');
                this.proxies = [];
                return;
            }
            const data = fs.readFileSync(PROXY_FILE, 'utf-8');
            const lines = data.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
            this.proxies = lines.filter(p => /^([\d]{1,3}\.){3}[\d]{1,3}:[\d]{1,5}$/.test(p));

            this.proxies.forEach(p => {
                if (!this.proxyHealth.has(p)) {
                    this.proxyHealth.set(p, { healthy: true, lastCheck: 0, failures: 0 });
                }
            });

            logger.info(`Proxies loaded: ${this.proxies.length}`);
        } catch (e) {
            logger.warn('Failed to load proxies: ' + e.message);
            this.proxies = [];
        }
    },

    startProxyHealthCheck() {
        if (this.proxies.length === 0) return;
        setInterval(() => this.checkProxyHealth(), 300000); // 5 นาที
        logger.info('Proxy health check scheduled every 5 minutes');
    },

    async checkProxyHealth() {
        if (this.proxies.length === 0) return;
        const testUrl = 'https://httpbin.org/ip';
        const healthy = [];

        const test = (proxy) => new Promise(resolve => {
            const agent = new HttpsProxyAgent(`http://${proxy}`);
            const req = https.get(testUrl, { agent, timeout: 60000 }, (res) => {
                if (res.statusCode === 200) {
                    this.markProxyHealthy(proxy);
                    healthy.push(proxy);
                    resolve(true);
                } else {
                    this.markProxyUnhealthy(proxy);
                    resolve(false);
                }
            });
            req.on('error', () => { this.markProxyUnhealthy(proxy); resolve(false); });
            req.on('timeout', () => { req.destroy(); this.markProxyUnhealthy(proxy); resolve(false); });
        });

        const batchSize = 50;
        for (let i = 0; i < this.proxies.length; i += batchSize) {
            await Promise.all(this.proxies.slice(i, i + batchSize).map(test));
        }

        for (const [proxy, health] of this.proxyHealth.entries()) {
            if (health.failures >= 10 && !healthy.includes(proxy)) {
                this.proxyHealth.delete(proxy);
                this.proxies = this.proxies.filter(p => p !== proxy);
                logger.info(`Removed dead proxy: ${proxy}`);
            }
        }

        logger.info(`Healthy proxies: ${healthy.length}/${this.proxies.length}`);
    },

    markProxyHealthy(proxy) {
        const h = this.proxyHealth.get(proxy) || { failures: 0 };
        h.healthy = true; h.lastCheck = Date.now(); h.failures = 0;
        this.proxyHealth.set(proxy, h);
    },

    markProxyUnhealthy(proxy) {
        const h = this.proxyHealth.get(proxy) || { failures: 0 };
        h.failures++; h.lastCheck = Date.now();
        if (h.failures >= 5) h.healthy = false;
        this.proxyHealth.set(proxy, h);
    },

    getProxy() {
        if (this.proxies.length === 0) return undefined;
        const healthy = this.proxies.filter(p => this.proxyHealth.get(p)?.healthy !== false);
        const list = healthy.length > 0 ? healthy : this.proxies;
        const proxy = list[this.currentProxyIndex % list.length];
        this.currentProxyIndex++;
        return this.createProxyAgent(proxy);
    },

    createProxyAgent(proxy) {
        try { return new HttpsProxyAgent(`http://${proxy}`); }
        catch (e) { logger.warn(`Bad proxy agent: ${proxy}`); this.markProxyUnhealthy(proxy); return undefined; }
    },

    sleep(ms) {
        const jitter = Math.floor(this.secureRandom() * 50000);
        return new Promise(r => setTimeout(r, ms + jitter));
    },

    validateUrl(url) { try { new URL(url); return true; } catch { return false; } },

    generateHeaders(targetUrl = 'https://agar.io') {
        if (!this.validateUrl(targetUrl)) throw new Error('Invalid URL');
        const url = new URL(targetUrl);
        const uas = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0',
        ];
        const langs = [['en-US', 'en'], ['ja-JP', 'ja'], ['de-DE', 'de']];
        const rand = this.secureRandom.bind(this);
        const ua = uas[Math.floor(rand() * uas.length)];
        const [p, f] = langs[Math.floor(rand() * langs.length)];
        const sessionId = crypto.randomUUID();
        const short = sessionId.replace(/-/g, '').slice(0, 16);
        return {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Accept-Language': `${p},${f};q=${(0.1 + rand() * 0.9).toFixed(2)}`,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'User-Agent': ua,
            'Sec-CH-UA': '"Not/A)Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
            'Sec-CH-UA-Mobile': ua.includes('Mobile') ? '?1' : '?0',
            'Sec-CH-UA-Platform': '"Windows"',
            'DNT': '1',
            'Referer': `${url.origin}/?t=${Date.now()}`,
            'Origin': url.origin,
            'X-Session-ID': sessionId,
            'Client-Session': short,
            'X-Request-ID': crypto.randomUUID(),
        };
    },

    async requestWithCloudflareBypass(url, options = {}, retries = 6) {
        if (!this.circuitBreaker.canExecute()) throw new Error('Circuit Breaker OPEN');
        const wait = this.rateLimiter.getWaitTime();
        if (wait > 0) { logger.warn(`Rate limit: wait ${wait}ms`); await this.sleep(wait); }
        if (!this.rateLimiter.canMakeRequest()) throw new Error('Rate limit exceeded');
        if (!this.validateUrl(url)) throw new Error('Invalid URL');

        const proxyAgent = this.getProxy();
        for (let i = 1; i <= retries; i++) {
            try {
                const headers = this.generateHeaders(url);
                const dispatcher = proxyAgent ? new Agent({ connect: { proxy: proxyAgent } }) : undefined;
                const res = await request(url, { method: options.method || 'GET', headers, body: options.body, dispatcher, maxRedirections: 0 });
                const data = await res.body.text();

                if (res.headers['cf-ray'] && res.headers['server'] === 'cloudflare') {
                    if (res.statusCode === 403 || res.statusCode === 1020) throw new Error('CF 403/1020');
                    if (data.includes('cdn-cgi/challenge') || data.includes('Checking your browser')) throw new Error('CF JS Challenge');
                }

                this.circuitBreaker.onSuccess();
                return { data, headers: Object.fromEntries(res.headers.entries()), status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300 };
            } catch (e) {
                logger.warn(`Request failed (${i}/${retries}): ${e.message}`);
                this.circuitBreaker.onFailure();
                if (i === retries) throw e;
                await this.sleep(Math.min(1000 * Math.pow(2, i), 10000));
            }
        }
    },

    intToHex(c) { let h = c.toString(16); while (h.length < 6) h = "0" + h; return "#" + h; },
    size2mass(s) { return s * s / 100; },
    createServer() {
        if (config.serverSettings.secure) {
            if (!fs.existsSync(config.serverSettings.keyPath) || !fs.existsSync(config.serverSettings.certPath)) throw new Error('SSL files not found');
            return https.createServer({ key: fs.readFileSync(config.serverSettings.keyPath), cert: fs.readFileSync(config.serverSettings.certPath) });
        }
        return http.createServer();
    },
    loadMassBoostData() { try { return fs.existsSync(MASS_BOOST_FILE) ? JSON.parse(fs.readFileSync(MASS_BOOST_FILE, 'utf8')) : {}; } catch { return {}; } },
    saveMassBoostData(d) { try { const dir = path.dirname(MASS_BOOST_FILE); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(MASS_BOOST_FILE, JSON.stringify(d, null, 2)); } catch (e) { console.error(e); } },
    getMassBoostExpire(n) { return this.loadMassBoostData()[n] ?? null; },
    setMassBoostExpire(n, e) { const d = this.loadMassBoostData(); d[n] = e; this.saveMassBoostData(d); },
    clearExpiredMassBoosts() {
        const now = Date.now();
        const data = this.loadMassBoostData();
        let changed = false;
        for (const [k, v] of Object.entries(data)) {
            if (v < now) { delete data[k]; changed = true; }
        }
        if (changed) this.saveMassBoostData(data);
    },
    calculateDistance(x1,y1,x2,y2) { return Math.hypot(x2-x1, y2-y1); },
    rotateKey(k) { k = Math.imul(k, 1540483477) >>> 0; k = (Math.imul(k >>> 24 ^ k, 1540483477) >>> 0) ^ 114296087; k = Math.imul(k >>> 13 ^ k, 1540483477) >>> 0; return k >>> 15 ^ k; },
    xorBuffer(b, k) { if (!Buffer.isBuffer(b)) b = Buffer.from(b); for (let i = 0; i < b.length; i++) b[i] ^= (k >>> (i % 4 * 8)) & 255; return b; },

    uncompressBuffer(input, output) {
        if (!Buffer.isBuffer(input)) input = Buffer.from(input);
        for (let i = 0, j = 0; i < input.length;) {
            const byte = input[i++];
            let literalsLength = byte >> 4;
            if (literalsLength > 0) {
                let length = literalsLength + 240;
                while (length === 255) { length = input[i++]; literalsLength += length; }
                const end = i + literalsLength;
                while (i < end) output[j++] = input[i++];
                if (i === input.length) return output;
            }
            const offset = input[i++] | (input[i++] << 8);
            if (offset === 0 || offset > j) return -(i - 2);
            let matchLength = byte & 15;
            let length = matchLength + 240;
            while (length === 255) { length = input[i++]; matchLength += length; }
            let pos = j - offset;
            const end = j + matchLength + 4;
            while (j < end) output[j++] = output[pos++];
        }
        return output;
    },
    murmur2(str, seed) {
        let l = str.length, h = seed ^ l, i = 0, k;
        while (l >= 4) {
            k = (str.charCodeAt(i) & 0xff) | ((str.charCodeAt(++i) & 0xff) << 8) | ((str.charCodeAt(++i) & 0xff) << 16) | ((str.charCodeAt(++i) & 0xff) << 24);
            k = (k & 0xffff) * 0x5bd1e995 + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16);
            k ^= k >>> 24;
            k = (k & 0xffff) * 0x5bd1e995 + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16);
            h = ((h & 0xffff) * 0x5bd1e995 + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)) ^ k;
            l -= 4; ++i;
        }
        switch (l) {
            case 3: h ^= (str.charCodeAt(i + 2) & 0xff) << 16;
            case 2: h ^= (str.charCodeAt(i + 1) & 0xff) << 8;
            case 1: h ^= str.charCodeAt(i) & 0xff; h = (h & 0xffff) * 0x5bd1e995 + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16);
        }
        h ^= h >>> 13;
        h = (h & 0xffff) * 0x5bd1e995 + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16);
        h ^= h >>> 15;
        return h >>> 0;
    },

    getHealthStatus() {
        const healthy = this.proxies.filter(p => this.proxyHealth.get(p)?.healthy);
        return {
            circuitBreaker: this.circuitBreaker.state,
            failureCount: this.circuitBreaker.failureCount,
            proxyCount: this.proxies.length,
            healthyProxyCount: healthy.length,
            rateLimitStatus: `${this.rateLimiter.requests.length}/${this.rateLimiter.maxRequests}`,
            currentProxyIndex: this.currentProxyIndex,
            autoUpdateTimer: this._proxyUpdateTimer ? 'running' : 'stopped',
            updateInterval: '10 minutes'
        };
    },

    async forceProxyUpdate() {
        logger.info('Force updating proxy list...');
        await this.updateProxyList();
    },

    forceProxyCheck() { this.checkProxyHealth(); }
};

// Auto-init
helper.init();
export default helper;