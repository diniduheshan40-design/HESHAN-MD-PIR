const express = require('express');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Server sleep වීම වැළැක්වීමට ping endpoint එකක්
app.get('/ping', (req, res) => res.send('OK'));

app.get('/code', async (req, res) => {
    let num = req.query.number;

    if (!num) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    // Number එක clean කරගැනීම (+, spaces අයින් කරලා)
    num = num.replace(/[^0-9]/g, '');

    if (num.length < 10) {
        return res.status(400).json({ error: 'Invalid number! Include country code (e.g. 947...)' });
    }

    // අලුත් unique session path එකක්
    const sessionId = `heshan_${Date.now()}`;
    const sessionDir = path.join(__dirname, 'temp', sessionId);
    
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    let codeSent = false;
    let isConnected = false;

    try {
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
            },
            printQRInTerminal: false,
            logger: pino({ level: 'fatal' }),
            // WhatsApp Web standard browser signature එක
            browser: ['Chrome (Linux)', 'Chrome', '122.0.6261.128'],
            syncFullHistory: false,
            markOnlineOnConnect: false,
            connectTimeoutMs: 180000,        // Timeout එක විනාඩි 3ක් දක්වා වැඩි කර ඇත
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 8000,       // Connection drop නොවී තියාගන්න ping interval එක
            emitOwnEvents: false
        });

        sock.ev.on('creds.update', saveCreds);

        // Code එක generate කර frontend එකට යැවීම
        if (!sock.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(num);
                    const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!codeSent && !res.headersSent) {
                        codeSent = true;
                        res.json({ code: formatted });
                    }
                } catch (codeErr) {
                    console.error('Pairing Code Request Error:', codeErr);
                    if (!codeSent && !res.headersSent) {
                        codeSent = true;
                        res.status(500).json({ error: 'WhatsApp rejected code request. Please retry.' });
                    }
                }
            }, 2500);
        }

        // WhatsApp එකෙන් Code එක link කළ පසු ක්‍රියාත්මක වන කොටස
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                isConnected = true;
                console.log(`[+] SUCCESS! Device Linked for ${num}`);
                
                // WhatsApp creds.json එක disk එකට write වෙනකල් තත්පර 5ක් ඉවසීම
                await delay(5000);

                try {
                    const credsPath = path.join(sessionDir, 'creds.json');
                    if (fs.existsSync(credsPath)) {
                        const credsData = fs.readFileSync(credsPath);
                        const base64Session = Buffer.from(credsData).toString('base64');
                        const finalSession = `HESHAN~${base64Session}`;

                        const targetJid = `${num}@s.whatsapp.net`;

                        // User ගේ WhatsApp chat එකට Session ID එක send කිරීම
                        await sock.sendMessage(targetJid, {
                            text: `*╔════════════════════╗*\n*  ⚡ HESHAN-MD CONNECTED ⚡*\n*╚════════════════════╝*\n\n*YOUR SESSION ID:*\n\`\`\`${finalSession}\`\`\`\n\n> ⚠️ *මෙම Session ID එක කාටවත් share කරන්න එපා.*\n\n*Created by Heshan* 🇱🇰`
                        });

                        console.log(`[+] Session ID sent successfully to ${num}`);
                    }
                } catch (sendErr) {
                    console.error('Session send error:', sendErr);
                }

                // Temporary files safetly delete කිරීම
                await delay(3000);
                sock.ws?.close();
                try {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                } catch (e) {}

            } else if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                console.log(`[-] Connection closed. Code: ${reason}`);

                // Device එක සාර්ථකව link නොවී disconnect වුණොත් folder එක clear කිරීම
                if (!isConnected) {
                    try {
                        fs.rmSync(sessionDir, { recursive: true, force: true });
                    } catch (e) {}
                }
            }
        });

    } catch (err) {
        console.error('Core Socket Error:', err);
        if (!codeSent && !res.headersSent) {
            res.status(500).json({ error: 'Server initialization error. Try again.' });
        }
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (e) {}
    }
});

app.listen(PORT, () => {
    console.log(`[✓] HESHAN-MD Pair Server running on port ${PORT}`);
});

