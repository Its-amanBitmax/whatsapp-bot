// ================================
// WHATSAPP BOT - FULLY WORKING 2025 EDITION
// ================================
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import qrcode from 'qrcode';
import dotenv from 'dotenv';
dotenv.config();

import puppeteer from "puppeteer";

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, 'uploads');

// ✅ ensure folder exists
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const app = express();

// Support large files
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

const PORT = process.env.PORT || 4001;
const API_KEY = process.env.API_KEY || 'SECRET123';

const ALLOWED_ORIGINS = [
    'https://www.bitmaxgroup.com',
    'https://bot.bitmaxgroup.com',
    'http://127.0.0.1:8000',
    'http://localhost:8000',
    'https://dohelp.newhopeindia17.com/',
    'http://localhost:5173/'
];

// CORS
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    allowedHeaders: ['Content-Type', 'x-api-key'],
}));

// API Key Check
const auth = (req, res, next) => {
    if (req.headers['x-api-key'] !== API_KEY) {
        return res.status(401).json({ error: 'Invalid API Key' });
    }
    next();
};

// Uploads Folder + Multer
const upload = multer({
    storage: multer.diskStorage({
        destination: uploadDir,   // ✅ SAME VARIABLE
        filename: (req, file, cb) => {
            cb(null, Date.now() + '-' + file.originalname);
        }
    }),
    limits: { fileSize: 20 * 1024 * 1024 }
});


// WhatsApp Client
let client = null;
let clientReady = false;
let lastQr = null;

function createClient() {
    if (client) client.destroy().catch(() => {});

client = new Client({
  puppeteer: {
    headless: false, // 👈 local me QR dekhne ke liye
    executablePath: puppeteer.executablePath(),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox"
    ]
  }
});

    client.on('qr', async (qr) => {
        lastQr = await qrcode.toDataURL(qr);
        clientReady = false;
        console.log('QR Ready → Scan Now!');
    });

    client.on('ready', () => {
        clientReady = true;
        lastQr = null;
        console.log('WhatsApp Connected & Ready!');
    });

    client.on('authenticated', () => console.log('Authenticated'));
    client.on('disconnected', (reason) => {
        console.log('Disconnected:', reason);
        clientReady = false;
        if (reason !== 'intentional') setTimeout(createClient, 8000);
    });

    client.initialize();
}

createClient();

// Auto cleanup old files
setInterval(() => {
    fs.readdir(uploadDir, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(uploadDir, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && Date.now() - stats.mtimeMs > 600000) {
                    fs.unlink(filePath, () => {});
                }
            });
        });
    });
}, 600000);

// ================================
// ALL ROUTES (100% WORKING)
// ================================

app.get('/status', auth, (req, res) => {
    if (!clientReady || !client.info) return res.json({ status: 'disconnected' });
    res.json({
        status: 'connected',
        user: {
            name: client.info.pushname || 'User',
            number: client.info.wid.user,
            platform: 'WhatsApp Web'
        }
    });
});

app.get('/qr', auth, (req, res) => {
    res.json({ qr: lastQr || null });
});

app.get('/groups', auth, async (req, res) => {
    if (!clientReady) return res.json([]);
    try {
        const chats = await client.getChats();
        const groups = chats.filter(c => c.isGroup).map(g => ({
            id: g.id._serialized,
            name: g.name || 'Unknown Group'
        }));
        res.json(groups);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/delete-session', auth, async (req, res) => {
    try {
        if (client) {
            await client.logout();
            await client.destroy();
        }
        const sessionPath = path.join(__dirname, '.wwebjs_auth');
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
        lastQr = null;
        clientReady = false;
        createClient();
        res.json({ success: true, message: 'Session deleted. New QR generated!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/start', auth, (req, res) => {
    createClient();
    res.json({ success: true, message: 'Bot restarted' });
});

// TEXT + MEDIA (supports file upload & base64)
app.post('/send', auth, upload.any(), async (req, res) => {
    if (!clientReady) return res.status(400).json({ error: 'Bot not ready' });

    const { number, message, media_base64, media_mime, media_name } = req.body;
    const file = req.files && req.files.length > 0 ? req.files[0] : null;

    try {
        const chatId = number.replace(/\D/g, '') + '@c.us';
        let media = null;

        if (file) media = MessageMedia.fromFilePath(file.path);
        else if (media_base64) {
            const base64 = media_base64.replace(/^data:.+;base64,/, '');
            media = new MessageMedia(media_mime, base64, media_name);
        }

        if (media) {
            await client.sendMessage(chatId, media, { caption: message || '' });
            if (file) fs.unlinkSync(file.path);
        } else if (message) {
            await client.sendMessage(chatId, message);
        }

        res.json({ success: true, message: 'Sent!' });
    } catch (err) {
        if (file) fs.unlinkSync(file.path);
        res.status(500).json({ error: err.message });
    }
});

// Add this new route BEFORE the server start section (app.listen ke pehle)

// ================================
// OTP GENERATOR & SENDER (NEW ROUTE)
// ================================
app.post('/send-otp', auth, async (req, res) => {
    if (!clientReady) {
        return res.status(400).json({ error: 'WhatsApp not connected' });
    }

    try {
        const { number } = req.body;
        if (!number) {
            return res.status(400).json({ error: 'Number is required' });
        }

        // Normalize number
        const formattedNumber = number.replace(/\D/g, '');

        // 1️⃣ Resolve WhatsApp number ID (CRITICAL)
        const numberId = await client.getNumberId(formattedNumber);
        if (!numberId) {
            return res.status(400).json({
                error: 'Number is not registered on WhatsApp'
            });
        }

        // 2️⃣ Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        const otpMessage =
`🔐 *OTP Verification*

Your 6-digit OTP is:

🔹 *${otp}*

⏰ Valid for 10 minutes only.

*Do not share this OTP with anyone.*

Regards,
Bitmax Group`;

        // 3️⃣ Send message WITHOUT triggering sendSeen
        await client.sendMessage(
            numberId._serialized,
            otpMessage,
            {
                sendSeen: false,     // 🔥 PREVENTS markedUnread crash
                linkPreview: false
            }
        );

        console.log(`✅ OTP ${otp} sent to ${formattedNumber}`);

        res.json({
            success: true,
            message: 'OTP sent successfully',
            details: {
                otp_sent: otp, // ❗ REMOVE IN PRODUCTION
                to_number: formattedNumber,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('OTP Send Error:', error);
        res.status(500).json({
            error: 'Failed to send OTP',
            details: error.message
        });
    }
});


// BULK SEND (Anti-Ban)
app.post('/send-bulk', auth, upload.any(), async (req, res) => {
    if (!clientReady) return res.status(400).json({ error: 'Bot not ready' });

    const { phone_numbers, message, media_base64, media_mime, media_name } = req.body;
    const file = req.files && req.files.length > 0 ? req.files[0] : null;

    const numbers = phone_numbers?.split('\n').map(n => n.trim()).filter(Boolean);
    if (!numbers?.length) return res.status(400).json({ error: 'No numbers' });

    let media = null;
    if (file) media = MessageMedia.fromFilePath(file.path);
    else if (media_base64) {
        const base64 = media_base64.replace(/^data:.+;base64,/, '');
        media = new MessageMedia(media_mime, base64, media_name);
    }

    let sent = 0, failed = 0;
    for (const num of numbers) {
        try {
            const chatId = num.replace(/\D/g, '') + '@c.us';
            if (media) await client.sendMessage(chatId, media, { caption: message || '' });
            else await client.sendMessage(chatId, message || 'Hello');
            sent++;
            await new Promise(r => setTimeout(r, 5000 + Math.random() * 7000)); // 5-12 sec delay
        } catch (err) {
            failed++;
        }
    }

    if (file) fs.unlinkSync(file.path);
    res.json({ success: true, sent, failed, total: numbers.length });
});

// GROUP SEND
app.post('/send-group', auth, upload.any(), async (req, res) => {
    if (!clientReady) return res.status(400).json({ error: 'Bot not ready' });

    const { groupId, message, media_base64, media_mime, media_name } = req.body;
    const file = req.files && req.files.length > 0 ? req.files[0] : null;

    try {
        let media = null;
        if (file) media = MessageMedia.fromFilePath(file.path);
        else if (media_base64) {
            const base64 = media_base64.replace(/^data:.+;base64,/, '');
            media = new MessageMedia(media_mime, base64, media_name);
        }

        if (media) {
            await client.sendMessage(groupId, media, { caption: message || '' });
            if (file) fs.unlinkSync(file.path);
        } else {
            await client.sendMessage(groupId, message || '');
        }

        res.json({ success: true, message: 'Sent to group!' });
    } catch (err) {
        if (file) fs.unlinkSync(file.path);
        res.status(500).json({ error: err.message });
    }
});

// CURL SE MEDIA SEND KARNE KA ROUTE (Tumhara original command ab chalega)
// =============== SEND MEDIA (100% WORKING 2025 VERSION) ===============
app.post('/send-media', auth, upload.single('media'), async (req, res) => {
    try {
        console.log('BODY:', req.body);
        console.log('FILE:', req.file);

        if (!clientReady)
            return res.status(400).json({ error: 'WhatsApp not connected' });

        const { number, caption } = req.body;

        if (!number || !req.file)
            return res.status(400).json({ error: 'Number or media missing' });

        const chatId = number.includes('@c.us')
            ? number
            : number + '@c.us';

        const media = MessageMedia.fromFilePath(req.file.path);

        await client.sendMessage(chatId, media, { caption });

        res.json({
            success: true,
            message: 'Media sent successfully'
        });

    } catch (e) {
        console.error('Send media error:', e);
        res.status(500).json({ error: e.message });
    }
});


// Server Start
app.listen(PORT, '0.0.0.0', () => {
    console.log(`WhatsApp Bot LIVE → http://localhost:4001`);
    console.log(`Port: 4001 | API Key: SECRET123`);
});
