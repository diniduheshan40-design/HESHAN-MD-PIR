const express = require('express');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// In-memory status store
const sessionStore = new Map();

app.get('/ping', (req, res) => res.send('PONG'));

// UI එක
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HESHAN-MD | PAIR CODE</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    :root {
      --primary: #ef4444;
      --primary-glow: rgba(239, 68, 68, 0.4);
      --accent: #38bdf8;
      --bg: #07090e;
      --card: rgba(15, 23, 42, 0.85);
      --border: rgba(255, 255, 255, 0.08);
      --text: #f8fafc;
      --dim: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--bg);
      background-image: 
        radial-gradient(at 0% 0%, rgba(239, 68, 68, 0.15) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(56, 189, 248, 0.1) 0px, transparent 50%);
      color: var(--text);
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: var(--card);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 32px 24px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 999px;
      color: var(--primary);
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 1px;
      margin-bottom: 16px;
    }
    h1 { font-size: 1.8rem; font-weight: 800; margin-bottom: 6px; }
    h1 span { color: var(--primary); text-shadow: 0 0 15px var(--primary-glow); }
    .desc { font-size: 0.85rem; color: var(--dim); margin-bottom: 24px; }
    .input-group { text-align: left; margin-bottom: 20px; }
    label { display: block; font-size: 0.8rem; font-weight: 600; color: #cbd5e1; margin-bottom: 8px; }
    .input-field { position: relative; display: flex; align-items: center; }
    .input-field i { position: absolute; left: 14px; color: #64748b; font-size: 0.95rem; }
    input {
      width: 100%;
      background: #090d16;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 14px 14px 14px 42px;
      color: #fff;
      font-size: 1rem;
      outline: none;
      transition: all 0.2s;
    }
    input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2); }
    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #ef4444, #b91c1c);
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 6px 20px var(--primary-glow);
    }
    button:disabled { background: #334155; cursor: not-allowed; box-shadow: none; }
    #result-box {
      display: none;
      margin-top: 24px;
      padding: 20px;
      background: #090d16;
      border: 1px dashed var(--accent);
      border-radius: 14px;
    }
    .code-label { font-size: 0.75rem; color: var(--dim); margin-bottom: 8px; text-transform: uppercase; }
    .code-display {
      font-size: 2rem;
      font-weight: 800;
      color: var(--accent);
      letter-spacing: 6px;
      cursor: pointer;
      user-select: all;
      text-shadow: 0 0 15px rgba(56, 189, 248, 0.4);
      display: inline-block;
    }
    .copy-alert { display: none; font-size: 0.75rem; color: #34d399; font-weight: 600; margin-top: 4px; }
    .instruction { font-size: 0.75rem; color: #64748b; margin-top: 10px; line-height: 1.4; }
    #status-msg { font-size: 0.8rem; color: #38bdf8; margin-top: 12px; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge"><i class="fa-solid fa-bolt"></i> Official Pairing Tool</div>
    <h1>HESHAN <span>MD</span></h1>
    <p class="desc">Enter your WhatsApp number with country code</p>
    <div class="input-group">
      <label for="phone">Phone Number (eg: 947xxxxxxxx)</label>
      <div class="input-field">
        <i class="fa-solid fa-phone"></i>
        <input type="text" id="phone" placeholder="94701234567" autocomplete="off" />
      </div>
    </div>
    <button id="get-btn" onclick="startPairProcess()">
      <i class="fa-solid fa-key"></i> GET PAIR CODE
    </button>
    <div id="status-msg">Connecting to WhatsApp... Please wait.</div>
    <div id="result-box">
      <div class="code-label">Click to Copy Code</div>
      <div id="code" class="code-display" title="Click to copy"></div>
      <div id="copy-msg" class="copy-alert"><i class="fa-solid fa-check"></i> Copied to clipboard!</div>
      <p class="instruction">
        Open <b>WhatsApp > Linked Devices > Link with phone number</b> and paste the code immediately.
      </p>
    </div>
  </div>
  <script>
    setInterval(() => { fetch('/ping').catch(() => {}); }, 25000);

    let pollInterval = null;

    async function startPairProcess() {
      const input = document.getElementById('phone');
      const btn = document.getElementById('get-btn');
      const box = document.getElementById('result-box');
      const codeField = document.getElementById('code');
      const copyMsg = document.getElementById('copy-msg');
      const statusMsg = document.getElementById('status-msg');

      const rawNum = input.value.replace(/[^0-9]/g, '');
      if (rawNum.length < 10) {
        alert('කරුණාකර රටේ කෝඩ් එකත් එක්ක number එකක් දෙන්න (eg: 947xxxxxxxx)');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> GENERATING...';
      box.style.display = 'none';
      copyMsg.style.display = 'none';
      statusMsg.style.display = 'block';
      statusMsg.innerText = 'Initializing connection with WhatsApp...';

      if (pollInterval) clearInterval(pollInterval);

      try {
        // Step 1: Start background session request
        const res = await fetch('/start?number=' + encodeURIComponent(rawNum));
        const initData = await res.json();

        if (initData.error) {
          alert(initData.error);
          resetBtn();
          return;
        }

        // Step 2: Poll every 2 seconds until code arrives
        let retries = 0;
        pollInterval = setInterval(async () => {
          retries++;
          try {
            const check = await fetch('/status?number=' + encodeURIComponent(rawNum));
            const stat = await check.json();

            if (stat.code) {
              clearInterval(pollInterval);
              codeField.innerText = stat.code;
              box.style.display = 'block';
              statusMsg.style.display = 'none';
              resetBtn();
            } else if (stat.error) {
              clearInterval(pollInterval);
              alert(stat.error);
              resetBtn();
            } else if (retries > 30) {
              clearInterval(pollInterval);
              alert('Timeout! WhatsApp එකෙන් response එකක් ලැබුනේ නෑ. කරුණාකර නැවත උත්සාහ කරන්න.');
              resetBtn();
            }
          } catch(e) {}
        }, 2000);

      } catch (e) {
        alert('Server unreachable. Re-trying...');
        resetBtn();
      }
    }

    function resetBtn() {
      const btn = document.getElementById('get-btn');
      const statusMsg = document.getElementById('status-msg');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-key"></i> GET PAIR CODE';
    }

    document.getElementById('code').addEventListener('click', function() {
      const pureCode = this.innerText.replace(/-/g, '');
      navigator.clipboard.writeText(pureCode).then(() => {
        const msg = document.getElementById('copy-msg');
        msg.style.display = 'block';
        setTimeout(() => { msg.style.display = 'none'; }, 2500);
      });
    });
  </script>
</body>
</html>`);
});

// Non-blocking Trigger route
app.get('/start', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: 'Phone number required' });

    num = num.replace(/[^0-9]/g, '');
    if (num.length < 10) return res.status(400).json({ error: 'Invalid phone number!' });

    // Store state
    sessionStore.set(num, { status: 'starting', code: null, error: null });
    res.json({ ok: true, message: 'Processing' });

    // Run socket in background
    runPairSession(num);
});

// Fast Status Checker Route
app.get('/status', (req, res) => {
    let num = req.query.number?.replace(/[^0-9]/g, '');
    if (!num || !sessionStore.has(num)) {
        return res.json({ status: 'none' });
    }
    res.json(sessionStore.get(num));
});

async function runPairSession(num) {
    const sessionId = `heshan_${num}_${Date.now()}`;
    const sessionDir = path.join(__dirname, 'temp', sessionId);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    try {
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
            },
            printQRInTerminal: false,
            logger: pino({ level: 'fatal' }),
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            syncFullHistory: false,
            markOnlineOnConnect: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 8000,
            emitOwnEvents: false
        });

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState.creds.registered) {
            await delay(2500);
            try {
                const code = await sock.requestPairingCode(num);
                const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
                sessionStore.set(num, { status: 'code_ready', code: formatted, error: null });
            } catch (err) {
                console.error('Code Gen Error:', err);
                sessionStore.set(num, { status: 'error', code: null, error: 'WhatsApp code request rejected' });
            }
        }

        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;

            if (connection === 'open') {
                console.log(`[+] SUCCESS: Device Linked for ${num}`);
                await delay(4000);

                try {
                    const credsPath = path.join(sessionDir, 'creds.json');
                    if (fs.existsSync(credsPath)) {
                        const credsData = fs.readFileSync(credsPath);
                        const base64Session = Buffer.from(credsData).toString('base64');
                        const finalSession = `HESHAN~${base64Session}`;
                        const targetJid = `${num}@s.whatsapp.net`;

                        await sock.sendMessage(targetJid, {
                            text: `*╔════════════════════╗*\n*  ⚡ HESHAN-MD CONNECTED ⚡*\n*╚════════════════════╝*\n\n*YOUR SESSION ID:*\n\`\`\`${finalSession}\`\`\`\n\n> ⚠️ *මෙම Session ID එක කාටවත් share කරන්න එපා.*\n\n*Created by Heshan* 🇱🇰`
                        });

                        console.log(`[+] Session ID sent to WhatsApp (${num})`);
                    }
                } catch (sendErr) {
                    console.error('Session send error:', sendErr);
                }

                await delay(2000);
                sock.ws?.close();
                sessionStore.delete(num);
                try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (e) {}
            }
        });

    } catch (e) {
        console.error('Socket Boot Error:', e);
        sessionStore.set(num, { status: 'error', code: null, error: 'Server initialization error' });
        try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (err) {}
    }
}

app.listen(PORT, () => {
    console.log(`[✓] HESHAN-MD Server running on port ${PORT}`);
});

