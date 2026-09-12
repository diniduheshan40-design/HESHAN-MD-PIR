import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore, 
    Browsers,
    DisconnectReason 
} from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

const sessions = new Map();

// Temp folder clean up on startup
const tempRoot = path.join(__dirname, 'auth_info_baileys');
if (!fs.existsSync(tempRoot)) {
    fs.mkdirSync(tempRoot, { recursive: true });
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/code', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: 'දුරකථන අංකය ඇතුළත් කරන්න.' });

    num = num.replace(/[^0-9]/g, '');
    const userSessionDir = path.join(tempRoot, `session_${num}`);

    // කලින් තිබූ පරණ session files මකන්න
    if (fs.existsSync(userSessionDir)) {
        fs.rmSync(userSessionDir, { recursive: true, force: true });
    }
    fs.mkdirSync(userSessionDir, { recursive: true });

    try {
        const { state, saveCreds } = await useMultiFileAuthState(userSessionDir);
        
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
            },
            printQRInTerminal: false,
            logger: pino({ level: 'fatal' }),
            // WhatsApp එක block නොකරන standard Linux / Firefox browser signature
            browser: Browsers.macOS('Desktop'),
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false
        });

        sessions.set(num, { status: 'waiting', sessionId: null, sock });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log(`[+] WhatsApp Linked successfully for ${num}`);
                await delay(3000);

                const credsPath = path.join(userSessionDir, 'creds.json');
                if (fs.existsSync(credsPath)) {
                    const credsData = fs.readFileSync(credsPath, 'utf-8');
                    const base64Session = Buffer.from(credsData).toString('base64');
                    const fullSessionId = `HESHAN-MD~${base64Session}`;

                    sessions.set(num, { status: 'success', sessionId: fullSessionId });

                    // WhatsApp එකේ Saved Messages (You) වෙත කෙලින්ම යවයි
                    try {
                        await sock.sendMessage(sock.user.id, { 
                            text: `*╔════════════════════╗*\n       *HESHAN-MD V1*\n*╚════════════════════╝*\n\n*🔑 YOUR SESSION ID:*\n\n\`\`\`${fullSessionId}\`\`\`\n\n_⚠️ මෙම Session ID එක කාටවත් දෙන්න එපා._\n_Copy කර config.cjs එකට හෝ Render Environment එකට දාන්න._` 
                        });
                    } catch (e) {
                        console.log('Direct message failed, but session is live on UI.');
                    }

                    await delay(2000);
                    try { sock.end(); } catch {}
                    fs.rmSync(userSessionDir, { recursive: true, force: true });
                }
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason === DisconnectReason.loggedOut) {
                    sessions.set(num, { status: 'failed', error: 'Logged out' });
                    fs.rmSync(userSessionDir, { recursive: true, force: true });
                }
            }
        });

        // WhatsApp වෙතින් pairing code එක request කිරීම
        if (!sock.authState.creds.registered) {
            await delay(1500);
            const code = await sock.requestPairingCode(num);
            return res.json({ code: code, number: num });
        } else {
            return res.json({ error: 'අංකය දැනටමත් සම්බන්ධ වී ඇත.' });
        }

    } catch (err) {
        console.error('Error generating pairing code:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Pair Code ලබා ගැනීමට නොහැකි විය.' });
        if (fs.existsSync(userSessionDir)) fs.rmSync(userSessionDir, { recursive: true, force: true });
    }
});

// UI එකෙන් Session එක හැදිලද කියලා බලන endpoint එක
app.get('/session-status', (req, res) => {
    const num = req.query.number;
    if (sessions.has(num)) {
        res.json(sessions.get(num));
    } else {
        res.json({ status: 'none' });
    }
});

app.listen(PORT, () => {
    console.log(`[🚀] Pairing Service is active on port ${PORT}`);
});
