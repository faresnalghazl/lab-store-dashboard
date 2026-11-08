require('dotenv').config();
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const apiRoutes = require('./routes/api');
const botManager = require('./bot/botManager');
const { getSetting } = require('./database/db');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

botManager.setSocketIO(io);

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// تقديم ملفات لوحة التحكم (الفرونت إند)
app.use(express.static(path.join(__dirname, '..', 'public')));

// مسار فحص الحالة لمنصة Render و UptimeRobot
app.get('/ping', (req, res) => {
  res.status(200).json({ ok: true, status: 'alive' });
});

// مسارات API
app.use('/api', apiRoutes);

// توجيه أي مسار غير معروف إلى الواجهة الرئيسية
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

io.on('connection', socket => {
  socket.emit('bot:status', botManager.getBotStatusInfo());
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, async () => {
  console.log('====================================================');
  console.log(`🚀 Lab Store Dashboard is running on: http://localhost:${PORT}`);
  console.log('====================================================');

  // تشغيل البوت الأساسي تلقائياً إن كان التوكن محفوظاً
  const savedToken = getSetting('bot_token') || process.env.DISCORD_TOKEN;
  if (savedToken && savedToken.trim().length > 10) {
    console.log('[Startup] Starting main Discord bot...');
    await botManager.startMainBot(savedToken.trim());
  } else {
    console.log('[Startup] No Discord bot token configured yet. Open http://localhost:' + PORT + ' to connect your bot.');
  }

  // تشغيل أي بوتات إضافية مفعلة
  await botManager.startAllSubBots();
});
