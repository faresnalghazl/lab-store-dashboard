const crypto = require('node:crypto');
const express = require('express');
const router = express.Router();
const {
  db,
  getSetting,
  setSetting,
  getAllSettings,
  addActivityLog,
  getDashboardStats,
  seedDemoData,
  clearDemoData
} = require('../database/db');
const botManager = require('../bot/botManager');

const OWNER_DISCORD_ID = '790676969418522664';

// ==========================================================
// مسارات المصادقة عبر حساب الديسكورد الخاص بالمالك فقط (790676969418522664)
// ==========================================================

function getSessionFromRequest(req) {
  const token = (req.headers['x-auth-token'] || req.query.token || '').trim();
  if (!token) return null;
  const session = db.prepare('SELECT * FROM auth_sessions WHERE token = ? AND discord_id = ?').get(token, OWNER_DISCORD_ID);
  return session || null;
}

router.get('/auth/status', async (req, res) => {
  try {
    const session = getSessionFromRequest(req);
    const ownerProfile = await botManager.getOwnerDiscordProfile();
    const clientId = getSetting('client_id') || botManager.client?.user?.id || '';
    const clientSecret = getSetting('discord_client_secret') || process.env.DISCORD_CLIENT_SECRET || '';

    res.json({
      ok: true,
      authenticated: Boolean(session),
      ownerDiscordId: OWNER_DISCORD_ID,
      ownerProfile,
      sessionUser: session
        ? { id: session.discord_id, username: session.username, avatar: session.avatar }
        : null,
      botConnected: botManager.status === 'connected',
      oauthReady: Boolean(clientId && clientSecret)
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// إرسال طلب تسجيل دخول عبر بوت الديسكورد لحساب المالك 790676969418522664 فقط
router.post('/auth/discord-challenge', async (req, res) => {
  try {
    const result = await botManager.createOwnerLoginChallenge();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// التحقق من الكود المرسل لحساب المالك 790676969418522664
router.post('/auth/verify-code', async (req, res) => {
  try {
    const { requestId, code } = req.body;
    const cleanCode = String(code || '').trim();
    if (!cleanCode) {
      return res.status(400).json({ ok: false, message: 'يرجى إدخال كود التحقق المرسل لحسابك في الديسكورد.' });
    }

    let matchedReqId = null;
    if (requestId && botManager.pendingLoginRequests.has(requestId)) {
      const r = botManager.pendingLoginRequests.get(requestId);
      if (r.code === cleanCode) matchedReqId = requestId;
    } else {
      for (const [k, v] of botManager.pendingLoginRequests.entries()) {
        if (v.code === cleanCode) {
          matchedReqId = k;
          break;
        }
      }
    }

    if (!matchedReqId) {
      return res.status(401).json({ ok: false, message: 'كود التحقق غير صحيح أو منتهي الصلاحية.' });
    }

    const profile = await botManager.getOwnerDiscordProfile();
    const sessionToken = botManager.approveLoginRequest(matchedReqId, {
      username: profile.username,
      displayAvatarURL: () => profile.avatar
    });

    res.json({
      ok: true,
      sessionToken,
      user: { id: OWNER_DISCORD_ID, username: profile.username, avatar: profile.avatar },
      message: 'تم تسجيل الدخول بحساب الديسكورد بنجاح!'
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// تسجيل الدخول الرسمي عبر Discord OAuth2 (مقتصر على 790676969418522664)
router.get('/auth/discord/login', (req, res) => {
  const clientId = getSetting('client_id') || botManager.client?.user?.id || process.env.CLIENT_ID;
  if (!clientId) {
    return res.redirect('/?auth_error=' + encodeURIComponent('يرجى التأكد من اتصال البوت أولاً أو استخدام زر تأكيد الدخول عبر البوت.'));
  }
  const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/discord/callback`;
  const url = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify`;
  res.redirect(url);
});

router.get('/auth/discord/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.redirect('/?auth_error=' + encodeURIComponent('لم يتم استلام رمز المصادقة من الديسكورد'));

    const clientId = getSetting('client_id') || botManager.client?.user?.id || process.env.CLIENT_ID;
    const clientSecret = getSetting('discord_client_secret') || process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/discord/callback`;

    if (!clientSecret) {
      return res.redirect('/?auth_error=' + encodeURIComponent('لم يتم ضبط Discord Client Secret بعد — استخدم زر "تأكيد الدخول الفوري عبر البوت" للدخول مباشرة!'));
    }

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.redirect('/?auth_error=' + encodeURIComponent('فشل التحقق من جلسة OAuth2 مع ديسكورد'));
    }

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const discordUser = await userRes.json();

    if (!discordUser || discordUser.id !== OWNER_DISCORD_ID) {
      return res.redirect(
        '/?auth_error=' +
          encodeURIComponent(`⛔ غير مصرح بالدخول! هذا الموقع خاص بمالك المتجر فقط (${OWNER_DISCORD_ID}). الحساب الذي حاول الدخول: ${discordUser?.id || 'غير معروف'}`)
      );
    }

    const sessionToken = crypto.randomBytes(24).toString('hex');
    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=128`
      : '/images/logo.png';

    db.prepare('INSERT INTO auth_sessions (token, discord_id, username, avatar) VALUES (?, ?, ?, ?)')
      .run(sessionToken, OWNER_DISCORD_ID, discordUser.username, avatarUrl);

    res.redirect(`/?session_token=${sessionToken}`);
  } catch (err) {
    res.redirect('/?auth_error=' + encodeURIComponent(err.message));
  }
});

router.post('/auth/logout', (req, res) => {
  const token = (req.headers['x-auth-token'] || '').trim();
  if (token) {
    db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
  }
  res.json({ ok: true });
});

// حماية جميع مسارات الداشبورد بحيث لا يعمل أي مسار إلا لجلسة حساب الديسكورد 790676969418522664
router.use((req, res, next) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({
      ok: false,
      unauthorized: true,
      message: `يرجى تسجيل الدخول بحساب الديسكورد الخاص بمالك المتجر (${OWNER_DISCORD_ID}).`
    });
  }
  req.ownerSession = session;
  next();
});

// ==========================================================
// مسارات الداشبورد المحمية
// ==========================================================

// 1) نظرة عامة شاملة للداشبورد
router.get('/overview', (req, res) => {
  try {
    const stats = getDashboardStats();
    const botStatus = botManager.getBotStatusInfo();
    const guildMeta = botManager.getGuildMeta();
    const recentLogs = db.prepare('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 20').all();
    const recentTickets = db.prepare('SELECT * FROM tickets ORDER BY id DESC LIMIT 10').all();
    const recentReviews = db.prepare('SELECT * FROM reviews ORDER BY id DESC LIMIT 8').all();
    const hasDemoData = db.prepare('SELECT COUNT(*) as c FROM tickets WHERE is_demo = 1').get().c > 0;

    res.json({
      ok: true,
      storeName: getSetting('store_name', 'Lab Store'),
      currency: getSetting('currency', 'ر.س'),
      hasDemoData,
      stats,
      botStatus,
      guildMeta,
      recentLogs,
      recentTickets,
      recentReviews
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 2) التذاكر وعمليات البيع والشراء وعدم الشراء
router.get('/tickets', (req, res) => {
  try {
    const { status, search } = req.query;
    let sql = 'SELECT * FROM tickets WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      sql += ' AND (user_tag LIKE ? OR product_name LIKE ? OR cancel_reason LIKE ? OR CAST(ticket_number AS TEXT) LIKE ?)';
      params.push(q, q, q, q);
    }

    sql += ' ORDER BY id DESC LIMIT 200';
    const tickets = db.prepare(sql).all(...params);
    res.json({ ok: true, tickets });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.get('/tickets/:id', (req, res) => {
  try {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(req.params.id));
    if (!ticket) return res.status(404).json({ ok: false, message: 'التذكرة غير موجودة' });
    let messages = [];
    try {
      messages = JSON.parse(ticket.messages_log || '[]');
    } catch (_) {}
    res.json({ ok: true, ticket, messages });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/tickets', (req, res) => {
  try {
    const {
      user_tag,
      staff_tag = 'الإدارة',
      category_name = 'عملية مسجلة من الداشبورد',
      product_name = '',
      status = 'completed_sale',
      amount = 0,
      cancel_reason = '',
      staff_notes = ''
    } = req.body;

    if (!user_tag) {
      return res.status(400).json({ ok: false, message: 'يرجى إدخال اسم العميل.' });
    }

    const lastNumRow = db.prepare('SELECT COALESCE(MAX(ticket_number), 100) as max_num FROM tickets').get();
    const nextNum = (lastNumRow.max_num || 100) + 1;

    let dealType = 'none';
    if (status === 'completed_sale') dealType = 'sale';
    else if (status === 'completed_purchase') dealType = 'purchase';
    else if (status === 'cancelled_no_buy') dealType = 'no_deal';

    const insertRes = db.prepare(`
      INSERT INTO tickets (
        ticket_number, user_id, user_tag, claimed_by_tag, category_name,
        ticket_type, product_name, status, deal_type, amount, currency,
        cancel_reason, staff_notes, messages_log, is_demo, closed_at
      ) VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, CASE WHEN ? = 'open' THEN NULL ELSE datetime('now', 'localtime') END)
    `).run(
      nextNum,
      user_tag,
      staff_tag,
      category_name,
      status === 'completed_purchase' ? 'sell' : 'buy',
      product_name,
      status,
      dealType,
      Number(amount) || 0,
      getSetting('currency', 'ر.س'),
      cancel_reason,
      staff_notes,
      status
    );

    addActivityLog({
      type: dealType === 'sale' ? 'sale' : dealType === 'purchase' ? 'purchase' : 'no_buy',
      title: `عملية مسجلة #${nextNum}`,
      details: `${product_name || category_name} (${user_tag})`,
      user_tag,
      staff_tag,
      amount: Number(amount) || 0
    });

    botManager.emitUpdate('dashboard:update', {});
    res.json({ ok: true, id: Number(insertRes.lastInsertRowid), message: 'تم تسجيل العملية في قاعدة البيانات بنجاح!' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/tickets/:id/outcome', async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const {
      action,
      amount,
      productName,
      cancelReason,
      staffNotes,
      staffName,
      closeChannel
    } = req.body;

    await botManager.updateTicketOutcomeFromDashboard(ticketId, {
      action,
      amount,
      productName,
      cancelReason,
      staffNotes,
      staffName: staffName || req.ownerSession?.username || 'لوحة التحكم',
      closeChannel: Boolean(closeChannel)
    });

    res.json({ ok: true, message: 'تم تحديث حالة التذكرة والإحصائيات بنجاح!' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/tickets/:id/message', async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const { message, staffName } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ ok: false, message: 'يرجى كتابة نص الرسالة.' });
    }
    const result = await botManager.sendTicketMessageFromDashboard(
      ticketId,
      message.trim(),
      staffName || req.ownerSession?.username || 'الإدارة (الموقع)'
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.delete('/tickets/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM tickets WHERE id = ?').run(Number(req.params.id));
    botManager.emitUpdate('dashboard:update', {});
    res.json({ ok: true, message: 'تم حذف التذكرة من السجل.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 3) أقسام التذاكر (Ticket Categories) + إرسال بانل مخصص لكل قسم أو بانل موحد
router.get('/categories', (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM ticket_categories ORDER BY id ASC').all();
    res.json({ ok: true, categories });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/categories', (req, res) => {
  try {
    const {
      name,
      emoji = '💎',
      description = '',
      type = 'buy',
      discord_category_id = '',
      staff_role_id = '',
      welcome_message = '',
      button_style = 'Secondary',
      banner_url = '',
      embed_color = '#2b2d31',
      banner_only = 1
    } = req.body;

    if (!name) return res.status(400).json({ ok: false, message: 'يرجى إدخال اسم القسم / الزر.' });

    db.prepare(`
      INSERT INTO ticket_categories (
        name, emoji, description, type, discord_category_id, staff_role_id,
        welcome_message, button_style, banner_url, embed_color, banner_only, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      name,
      emoji,
      description,
      type,
      discord_category_id,
      staff_role_id,
      welcome_message,
      button_style,
      banner_url,
      embed_color || '#2b2d31',
      banner_only ? 1 : 0
    );

    res.json({ ok: true, message: 'تمت إضافة قسم التذاكر بنجاح!' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/categories/:id/publish', async (req, res) => {
  try {
    const { channelId } = req.body;
    const result = await botManager.sendSingleCategoryPanel(Number(req.params.id), channelId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.delete('/categories/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM ticket_categories WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true, message: 'تم حذف القسم بنجاح.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/tickets/send-panel', async (req, res) => {
  try {
    const { channelId, title, description, color, banner, mode, bannerOnly } = req.body;
    if (title !== undefined) setSetting('ticket_panel_title', title);
    if (description !== undefined) setSetting('ticket_panel_description', description);
    if (color !== undefined) setSetting('ticket_panel_color', color);
    if (banner !== undefined) setSetting('ticket_panel_banner', banner);
    if (mode !== undefined) setSetting('ticket_panel_mode', mode);
    if (bannerOnly !== undefined) setSetting('ticket_panel_banner_only', bannerOnly ? '1' : '0');

    const result = await botManager.sendTicketPanel(channelId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 4) كتالوج المنتجات (مع لون الإيمبد المخصص لكل منتج وستايل البانر/الزر)
router.get('/products', (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
    res.json({ ok: true, products });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/products', (req, res) => {
  try {
    const {
      name,
      description = '',
      price = 0,
      category = 'عام',
      stock = -1,
      image_url = '',
      embed_color = '#2b2d31',
      banner_only = 0,
      button_label = '',
      button_emoji = '💎',
      button_style = 'Secondary'
    } = req.body;

    if (!name) return res.status(400).json({ ok: false, message: 'اسم المنتج مطلوب.' });

    db.prepare(`
      INSERT INTO products (
        name, description, price, currency, category, stock, image_url,
        embed_color, banner_only, button_label, button_emoji, button_style, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      name,
      description,
      Number(price) || 0,
      getSetting('currency', 'ر.س'),
      category,
      Number(stock),
      image_url,
      embed_color || '#2b2d31',
      banner_only ? 1 : 0,
      button_label || name,
      button_emoji || '💎',
      button_style || 'Secondary'
    );

    botManager.emitUpdate('dashboard:update', {});
    res.json({ ok: true, message: 'تمت إضافة المنتج إلى كتالوج المتجر!' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.patch('/products/:id/color', (req, res) => {
  try {
    const { embed_color, banner_only, button_style } = req.body;
    const id = Number(req.params.id);
    if (embed_color) {
      db.prepare('UPDATE products SET embed_color = ? WHERE id = ?').run(embed_color, id);
    }
    if (banner_only !== undefined) {
      db.prepare('UPDATE products SET banner_only = ? WHERE id = ?').run(banner_only ? 1 : 0, id);
    }
    if (button_style) {
      db.prepare('UPDATE products SET button_style = ? WHERE id = ?').run(button_style, id);
    }
    botManager.emitUpdate('dashboard:update', {});
    res.json({ ok: true, message: 'تم تحديث لون وإعدادات إيمبد المنتج بنجاح!' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.put('/products/:id', (req, res) => {
  try {
    const {
      name,
      description,
      price,
      category,
      stock,
      image_url,
      embed_color = '#2b2d31',
      banner_only = 0,
      button_label = '',
      button_emoji = '💎',
      button_style = 'Secondary',
      active = 1
    } = req.body;

    db.prepare(`
      UPDATE products
      SET name = ?, description = ?, price = ?, category = ?, stock = ?,
          image_url = ?, embed_color = ?, banner_only = ?, button_label = ?,
          button_emoji = ?, button_style = ?, active = ?
      WHERE id = ?
    `).run(
      name,
      description || '',
      Number(price) || 0,
      category || 'عام',
      Number(stock),
      image_url || '',
      embed_color || '#2b2d31',
      banner_only ? 1 : 0,
      button_label || name,
      button_emoji || '💎',
      button_style || 'Secondary',
      active ? 1 : 0,
      Number(req.params.id)
    );

    botManager.emitUpdate('dashboard:update', {});
    res.json({ ok: true, message: 'تم تحديث بيانات المنتج بنجاح.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.delete('/products/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
    botManager.emitUpdate('dashboard:update', {});
    res.json({ ok: true, message: 'تم حذف المنتج من الكتالوج.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/products/:id/publish', async (req, res) => {
  try {
    const { channelId } = req.body;
    const result = await botManager.sendProductCard(Number(req.params.id), channelId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 5) التقييمات (Reviews)
router.get('/reviews', (req, res) => {
  try {
    const reviews = db.prepare('SELECT * FROM reviews ORDER BY id DESC LIMIT 200').all();
    const stats = getDashboardStats().reviews;
    res.json({ ok: true, reviews, stats });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/reviews', (req, res) => {
  try {
    const { user_tag, staff_tag = 'فريق المبيعات', product_name = 'منتج المتجر', rating = 5, comment = '' } = req.body;
    if (!user_tag || !comment) return res.status(400).json({ ok: false, message: 'يرجى إدخال اسم العميل والتعليق.' });

    db.prepare(`
      INSERT INTO reviews (user_id, user_tag, staff_tag, product_name, rating, comment, is_demo)
      VALUES ('manual', ?, ?, ?, ?, ?, 0)
    `).run(user_tag, staff_tag, product_name, Math.min(Math.max(Number(rating) || 5, 1), 5), comment);

    botManager.emitUpdate('dashboard:update', {});
    res.json({ ok: true, message: 'تمت إضافة التقييم بنجاح!' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.delete('/reviews/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM reviews WHERE id = ?').run(Number(req.params.id));
    botManager.emitUpdate('dashboard:update', {});
    res.json({ ok: true, message: 'تم حذف التقييم.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 6) الإعدادات العامة والترحيب والرتب والخط التلقائي المتعدد
router.get('/settings', (req, res) => {
  try {
    const all = getAllSettings();
    const hasToken = Boolean(all.bot_token && all.bot_token.length > 10);
    const maskedToken = hasToken
      ? `${all.bot_token.slice(0, 8)}••••••••••••••••••••${all.bot_token.slice(-4)}`
      : '';

    const hasSecret = Boolean(all.discord_client_secret && all.discord_client_secret.length > 5);
    const maskedSecret = hasSecret
      ? `${all.discord_client_secret.slice(0, 4)}••••••••••••${all.discord_client_secret.slice(-3)}`
      : '';

    res.json({
      ok: true,
      settings: {
        ...all,
        bot_token: undefined,
        discord_client_secret: undefined,
        has_token: hasToken,
        masked_token: maskedToken,
        has_secret: hasSecret,
        masked_secret: maskedSecret
      },
      guildMeta: botManager.getGuildMeta()
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/settings', (req, res) => {
  try {
    const updates = req.body || {};
    for (const [k, v] of Object.entries(updates)) {
      if (k === 'bot_token') {
        if (v && !String(v).includes('••••')) {
          setSetting('bot_token', String(v).trim());
        }
        continue;
      }
      if (k === 'discord_client_secret') {
        if (v && !String(v).includes('••••')) {
          setSetting('discord_client_secret', String(v).trim());
        }
        continue;
      }
      if (typeof v === 'object') {
        setSetting(k, JSON.stringify(v));
      } else {
        setSetting(k, String(v ?? ''));
      }
    }

    botManager.applyPresence();
    botManager.emitUpdate('dashboard:update', {});
    res.json({ ok: true, message: 'تم حفظ الإعدادات وتطبيقها بنجاح!' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 7) التحكم المباشر بالبوت
router.post('/bot/control', async (req, res) => {
  try {
    const { action, token, guildId, clientSecret, channelId, embedData, status, activityType, activityText } = req.body;

    if (action === 'save_token_and_start') {
      if (token && !String(token).includes('••••')) {
        setSetting('bot_token', String(token).trim());
      }
      if (guildId !== undefined) {
        setSetting('guild_id', String(guildId).trim());
      }
      if (clientSecret && !String(clientSecret).includes('••••')) {
        setSetting('discord_client_secret', String(clientSecret).trim());
      }
      const result = await botManager.startMainBot();
      return res.json(result);
    }

    if (action === 'start' || action === 'restart') {
      const result = await botManager.startMainBot();
      return res.json(result);
    }

    if (action === 'stop') {
      await botManager.stopMainBot();
      return res.json({ ok: true, message: 'تم إيقاف البوت مؤقتاً.' });
    }

    if (action === 'update_presence') {
      if (status) setSetting('bot_status', status);
      if (activityType) setSetting('bot_activity_type', activityType);
      if (activityText !== undefined) setSetting('bot_activity_text', activityText);
      botManager.applyPresence();
      return res.json({ ok: true, message: 'تم تحديث حالة ونشاط البوت في الديسكورد!' });
    }

    if (action === 'welcome_test') {
      const result = await botManager.sendWelcomeTest(channelId);
      return res.json(result);
    }

    if (action === 'send_embed') {
      const result = await botManager.sendCustomEmbed(embedData || {});
      return res.json(result);
    }

    res.status(400).json({ ok: false, message: 'إجراء غير معروف' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 8) الرد التلقائي
router.get('/auto-responders', (req, res) => {
  try {
    const list = db.prepare('SELECT * FROM auto_responders ORDER BY id DESC').all();
    res.json({ ok: true, responders: list });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/auto-responders', (req, res) => {
  try {
    const { trigger_word, response_text, match_type = 'contains', is_embed = 1 } = req.body;
    if (!trigger_word || !response_text) {
      return res.status(400).json({ ok: false, message: 'يرجى إدخال الكلمة المفتاحية ونص الرد.' });
    }
    db.prepare(`
      INSERT INTO auto_responders (trigger_word, response_text, match_type, is_embed, enabled)
      VALUES (?, ?, ?, ?, 1)
    `).run(trigger_word.trim(), response_text.trim(), match_type, is_embed ? 1 : 0);

    res.json({ ok: true, message: 'تمت إضافة الرد التلقائي بنجاح!' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.delete('/auto-responders/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM auto_responders WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true, message: 'تم حذف الرد التلقائي.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 9) لوحات الرتب التفاعلية
router.get('/role-panels', (req, res) => {
  try {
    const panels = db.prepare('SELECT * FROM role_panels ORDER BY id DESC').all();
    res.json({ ok: true, panels });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/role-panels', (req, res) => {
  try {
    const { title, description = '', channel_id = '', color = '#2b2d31', roles = [] } = req.body;
    if (!title) return res.status(400).json({ ok: false, message: 'عنوان اللوحة مطلوب.' });

    const insertRes = db.prepare(`
      INSERT INTO role_panels (title, description, channel_id, color, roles_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(title, description, channel_id, color, JSON.stringify(roles));

    res.json({ ok: true, id: Number(insertRes.lastInsertRowid), message: 'تم حفظ لوحة الرتب التفاعلية!' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/role-panels/:id/publish', async (req, res) => {
  try {
    const { channelId } = req.body;
    const result = await botManager.sendRolePanel(Number(req.params.id), channelId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.delete('/role-panels/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM role_panels WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true, message: 'تم حذف لوحة الرتب.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 10) البوتات الإضافية
router.get('/sub-bots', (req, res) => {
  try {
    res.json({ ok: true, subBots: botManager.getSubBotsStatus() });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/sub-bots', async (req, res) => {
  try {
    const { name, role_type = 'custom', token, status = 'online', activity_type = 'Playing', activity_text = 'Lab Store' } = req.body;
    if (!name || !token) return res.status(400).json({ ok: false, message: 'اسم البوت والتوكن مطلوبان.' });

    const insertRes = db.prepare(`
      INSERT INTO sub_bots (name, role_type, token, status, activity_type, activity_text, enabled)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(name, role_type, token.trim(), status, activity_type, activity_text);

    const newId = Number(insertRes.lastInsertRowid);
    const startRes = await botManager.startSubBot(newId);
    res.json(startRes);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/sub-bots/:id/action', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { action } = req.body;
    if (action === 'start') {
      const r = await botManager.startSubBot(id);
      return res.json(r);
    }
    if (action === 'stop') {
      await botManager.stopSubBot(id);
      db.prepare('UPDATE sub_bots SET enabled = 0 WHERE id = ?').run(id);
      return res.json({ ok: true, message: 'تم إيقاف البوت الإضافي.' });
    }
    res.status(400).json({ ok: false, message: 'إجراء غير معروف' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.delete('/sub-bots/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await botManager.stopSubBot(id);
    db.prepare('DELETE FROM sub_bots WHERE id = ?').run(id);
    res.json({ ok: true, message: 'تم حذف البوت الإضافي.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 11) البيانات التجريبية
router.post('/demo/seed', (req, res) => {
  try {
    seedDemoData();
    botManager.emitUpdate('dashboard:update', {});
    res.json({ ok: true, message: 'تم توليد بيانات تجريبية للمعاينة بنجاح!' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/demo/clear', (req, res) => {
  try {
    clearDemoData();
    botManager.emitUpdate('dashboard:update', {});
    res.json({ ok: true, message: 'تم مسح جميع البيانات التجريبية!' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
