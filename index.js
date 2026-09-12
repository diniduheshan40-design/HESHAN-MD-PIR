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
    Browsers 
} from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/code', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.json({ error: 'Phone number is required.' });

    num = num.replace(/[^0-9]/g, '');
    const sessionDir = path.join(__dirname, `temp_${Date.now()}`);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Desktop')
        });

        if (!sock.authState.creds.registered) {
            await delay(1500);
            const code = await sock.requestPairingCode(num);
            res.json({ code: code });
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;

            if (connection === 'open') {
                await delay(3000);
                const credsPath = path.join(sessionDir, 'creds.json');
                
                if (fs.existsSync(credsPath)) {
                    const credsData = fs.readFileSync(credsPath, 'utf-8');
                    const base64Session = Buffer.from(credsData).toString('base64');
                    const fullSessionId = `HESHAN-MD~${base64Session}`;

                    await sock.sendMessage(sock.user.id, { 
                        text: `*╔════════════════════╗*\n       *HESHAN-MD V1*\n*╚════════════════════╝*\n\n*🔑 YOUR SESSION ID:*\n\n\`\`\`${fullSessionId}\`\`\`\n\n_⚠️ මෙම Session ID එක කිසිවෙකුට ලබා නොදෙන්න!_` 
                    });

                    await delay(2000);
                    await sock.ws.close();
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                }
            }
        });

    } catch (err) {
        console.error(err);
        if (!res.headersSent) res.json({ error: 'Failed to generate code' });
        if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
    }
});

app.listen(PORT, () => {
    console.log(`Pairing Server active on port ${PORT}`);
});

