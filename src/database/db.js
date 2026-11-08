const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'labstore.sqlite');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      discord_id TEXT NOT NULL,
      username TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      role TEXT DEFAULT 'admin',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS site_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE NOT NULL,
      username TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      role TEXT DEFAULT 'admin',
      note TEXT DEFAULT '',
      added_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS ticket_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '💎',
      description TEXT DEFAULT '',
      type TEXT DEFAULT 'buy',
      discord_category_id TEXT DEFAULT '',
      staff_role_id TEXT DEFAULT '',
      welcome_message TEXT DEFAULT '',
      button_style TEXT DEFAULT 'Secondary',
      banner_url TEXT DEFAULT '',
      embed_color TEXT DEFAULT '#2b2d31',
      banner_only INTEGER DEFAULT 1,
      enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'ر.س',
      category TEXT DEFAULT 'عام',
      stock INTEGER DEFAULT -1,
      image_url TEXT DEFAULT '',
      embed_color TEXT DEFAULT '#2b2d31',
      banner_only INTEGER DEFAULT 0,
      button_label TEXT DEFAULT '',
      button_emoji TEXT DEFAULT '💎',
      button_style TEXT DEFAULT 'Secondary',
      staff_role_id TEXT DEFAULT '',
      welcome_message TEXT DEFAULT '',
      welcome_image TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      sales_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number INTEGER NOT NULL,
      channel_id TEXT DEFAULT '',
      guild_id TEXT DEFAULT '',
      user_id TEXT NOT NULL,
      user_tag TEXT NOT NULL,
      user_avatar TEXT DEFAULT '',
      claimed_by_id TEXT DEFAULT '',
      claimed_by_tag TEXT DEFAULT '',
      category_id INTEGER,
      category_name TEXT DEFAULT 'عام',
      ticket_type TEXT DEFAULT 'buy',
      product_id INTEGER,
      product_name TEXT DEFAULT '',
      status TEXT DEFAULT 'open',
      deal_type TEXT DEFAULT 'none',
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'ر.س',
      cancel_reason TEXT DEFAULT '',
      staff_notes TEXT DEFAULT '',
      messages_log TEXT DEFAULT '[]',
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER,
      user_id TEXT NOT NULL,
      user_tag TEXT NOT NULL,
      user_avatar TEXT DEFAULT '',
      staff_id TEXT DEFAULT '',
      staff_tag TEXT DEFAULT '',
      product_name TEXT DEFAULT '',
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT DEFAULT '',
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS auto_responders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_word TEXT NOT NULL,
      response_text TEXT NOT NULL,
      match_type TEXT DEFAULT 'contains',
      is_embed INTEGER DEFAULT 1,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS role_panels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      channel_id TEXT DEFAULT '',
      message_id TEXT DEFAULT '',
      color TEXT DEFAULT '#2b2d31',
      roles_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS sub_bots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role_type TEXT DEFAULT 'custom',
      token TEXT NOT NULL,
      status TEXT DEFAULT 'online',
      activity_type TEXT DEFAULT 'Playing',
      activity_text TEXT DEFAULT 'Lab Store',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      details TEXT DEFAULT '',
      user_tag TEXT DEFAULT '',
      staff_tag TEXT DEFAULT '',
      amount REAL DEFAULT 0,
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS broadcasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT DEFAULT '',
      message TEXT NOT NULL,
      image_url TEXT DEFAULT '',
      button_text TEXT DEFAULT '',
      button_url TEXT DEFAULT '',
      target_role_id TEXT DEFAULT '',
      embed_color TEXT DEFAULT '#5865F2',
      status TEXT DEFAULT 'pending',
      total_count INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      finished_at TEXT DEFAULT ''
    );
  `);

  // ترقية الجداول الحالية بأمان دون فقدان أي بيانات
  ensureColumn('ticket_categories', 'button_style', "TEXT DEFAULT 'Secondary'");
  ensureColumn('ticket_categories', 'banner_url', "TEXT DEFAULT ''");
  ensureColumn('ticket_categories', 'embed_color', "TEXT DEFAULT '#2b2d31'");
  ensureColumn('ticket_categories', 'banner_only', 'INTEGER DEFAULT 1');

  ensureColumn('products', 'embed_color', "TEXT DEFAULT '#2b2d31'");
  ensureColumn('products', 'banner_only', 'INTEGER DEFAULT 0');
  ensureColumn('products', 'button_label', "TEXT DEFAULT ''");
  ensureColumn('products', 'button_emoji', "TEXT DEFAULT '💎'");
  ensureColumn('products', 'button_style', "TEXT DEFAULT 'Secondary'");
  ensureColumn('products', 'staff_role_id', "TEXT DEFAULT ''");
  ensureColumn('products', 'welcome_message', "TEXT DEFAULT ''");
  ensureColumn('products', 'welcome_image', "TEXT DEFAULT ''");
  ensureColumn('broadcasts', 'embed_color', "TEXT DEFAULT '#5865F2'");
  ensureColumn('auth_sessions', 'role', "TEXT DEFAULT 'admin'");

  // تثبيت المالك الأساسي في جدول الإداريين (غير قابل للحذف)
  const PRIMARY_OWNER_ID = '790676969418522664';
  db.prepare(`
    INSERT INTO site_admins (discord_id, username, role, note, added_by)
    VALUES (?, 'xfazq', 'primary', 'المالك والإداري الأساسي', 'النظام')
    ON CONFLICT(discord_id) DO UPDATE SET role = 'primary'
  `).run(PRIMARY_OWNER_ID);

  const defaultSettings = {
    store_name: 'Lab Store',
    currency: 'ر.س',
    owner_discord_id: process.env.OWNER_DISCORD_ID || '790676969418522664',
    discord_client_secret: process.env.DISCORD_CLIENT_SECRET || '',
    bot_token: process.env.DISCORD_TOKEN || '',
    guild_id: process.env.GUILD_ID || '',
    client_id: process.env.CLIENT_ID || '',
    bot_status: 'online',
    bot_activity_type: 'Playing',
    bot_activity_text: 'Lab Store | خدمة العملاء 24/7',
    ticket_panel_channel_id: '',
    ticket_panel_title: 'خدمة العملاء والطلبات — Lab Store',
    ticket_panel_description: 'ارتقِ بتجربتك مع **Lab Store**.\nاضغط على الزر بالأسفل لفتح تذكرة طلب فورية.',
    ticket_panel_color: '#2b2d31',
    ticket_panel_banner: '',
    ticket_panel_mode: 'buttons',
    ticket_panel_banner_only: '1',
    ticket_transcript_channel_id: '',
    staff_role_ids: '',
    default_product_embed_color: '#2b2d31',
    welcome_enabled: '1',
    welcome_channel_id: '',
    welcome_message: 'أهلاً بك {user} في سيرفر **{server}**! 🎉\nأنت العضو رقم **#{memberCount}**، نتمنى لك تجربة تسوق ممتعة وآمنة معنا!',
    welcome_embed_color: '#2b2d31',
    welcome_banner_url: '',
    auto_role_id: '',
    reviews_channel_id: '',
    logs_channel_id: '',
    sales_log_channel_id: '',
    autoline_enabled: '0',
    autoline_channels: '[]',
    autoline_content: '━━━✦❘༻ **Lab Store** ༺❘✦━━━'
  };

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaultSettings)) {
    insertSetting.run(k, String(v));
  }

  // تثبيت الآيدي الخاص بالمالك الوحيد المصرح له
  setSetting('owner_discord_id', '790676969418522664');

  const catCount = db.prepare('SELECT COUNT(*) as count FROM ticket_categories').get().count;
  if (catCount === 0) {
    const insertCat = db.prepare(`
      INSERT INTO ticket_categories (name, emoji, description, type, welcome_message, button_style, embed_color, banner_only, enabled)
      VALUES (?, ?, ?, ?, ?, 'Secondary', '#2b2d31', 1, 1)
    `);
    insertCat.run(
      'نيتروهات',
      '💎',
      'شراء اشتراكات النيترو والخدمات',
      'buy',
      'مرحباً بك! يرجى تحديد المنتج المطلوب وطريقة الدفع المفضلة، وسيقوم أحد ممثلي المبيعات بالرد عليك فوراً.'
    );
    insertCat.run(
      'بيع غرض للمتجر',
      '💰',
      'اعرض ما لديك للبيع ليقوم فريق المتجر بشرائه منك',
      'sell',
      'أهلاً بك في قسم الشراء من الأعضاء! يرجى إرسال مواصفات وصور الغرض أو الحساب والسعر المطلوب.'
    );
    insertCat.run(
      'الدعم الفني',
      '🛠️',
      'للاستفسارات العامة أو الضمان والتعويضات',
      'support',
      'أهلاً بك في الدعم الفني! اشرح استفسارك أو المشكلة بالتفصيل.'
    );
  }
}

function seedDemoData() {
  clearDemoData();

  const demoTickets = [
    {
      num: 101, user_id: '100001', user_tag: 'khalid_99', staff_id: '900001', staff_tag: 'Fares (Owner)',
      cat_name: 'نيتروهات', type: 'buy', prod_name: 'نيترو قيمنق (شهر كامل)',
      status: 'completed_sale', deal_type: 'sale', amount: 35, reason: '',
      notes: 'تم التحويل عبر الراجحي وتسليم الرابط للعميل', offsetDays: -5
    },
    {
      num: 102, user_id: '100002', user_tag: 'sultan.dev', staff_id: '900001', staff_tag: 'Fares (Owner)',
      cat_name: 'نيتروهات', type: 'buy', prod_name: 'تصميم وبرمجة بوت متجر خاص',
      status: 'completed_sale', deal_type: 'sale', amount: 190, reason: '',
      notes: 'تم تسليم السورس والربط بالكامل', offsetDays: -4
    },
    {
      num: 103, user_id: '100003', user_tag: 'mishal_x', staff_id: '900002', staff_tag: 'Saad (Sales)',
      cat_name: 'نيتروهات', type: 'buy', prod_name: 'حساب ديسكورد قديم (2017)',
      status: 'cancelled_no_buy', deal_type: 'no_deal', amount: 0, reason: 'السعر غير مناسب للعميل',
      notes: 'العميل طلب خصم 50% وتم الاعتذار منه', offsetDays: -3
    },
    {
      num: 104, user_id: '100004', user_tag: 'abo_fahad', staff_id: '900002', staff_tag: 'Saad (Sales)',
      cat_name: 'بيع غرض للمتجر', type: 'sell', prod_name: 'شراء حساب ثلاثي من العميل',
      status: 'completed_purchase', deal_type: 'purchase', amount: 95, reason: '',
      notes: 'تم فحص الحساب واستلام الإيميل الأساسي وتحويل المبلغ للبائع', offsetDays: -2
    },
    {
      num: 105, user_id: '100005', user_tag: 'nawaf_gamer', staff_id: '900001', staff_tag: 'Fares (Owner)',
      cat_name: 'نيتروهات', type: 'buy', prod_name: 'بوستات سيرفر 14 بوست (3 أشهر)',
      status: 'completed_sale', deal_type: 'sale', amount: 65, reason: '',
      notes: 'تم تنفيذ 14 بوست لسيرفر العميل فوراً', offsetDays: -1
    }
  ];

  const insertTicket = db.prepare(`
    INSERT INTO tickets (
      ticket_number, user_id, user_tag, claimed_by_id, claimed_by_tag,
      category_name, ticket_type, product_name, status, deal_type,
      amount, currency, cancel_reason, staff_notes, messages_log, is_demo, created_at, closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ر.س', ?, ?, ?, 1, datetime('now', 'localtime', ?), CASE WHEN ? = 'open' THEN NULL ELSE datetime('now', 'localtime', ?) END)
  `);

  for (const t of demoTickets) {
    const sampleMessages = JSON.stringify([
      { author: t.user_tag, role: 'user', content: `السلام عليكم، أرغب بخصوص: ${t.prod_name}`, time: '14:10' },
      { author: t.staff_tag, role: 'staff', content: `وعليكم السلام أهلاً بك يا ${t.user_tag}! أبشر، متوفر وجاهز للتنفيذ الفوري.`, time: '14:11' }
    ]);
    const dayMod = `${t.offsetDays} days`;
    insertTicket.run(
      t.num, t.user_id, t.user_tag, t.staff_id, t.staff_tag,
      t.cat_name, t.type, t.prod_name, t.status, t.deal_type,
      t.amount, t.reason, t.notes, sampleMessages, dayMod, t.status, dayMod
    );
  }
}

function clearDemoData() {
  db.exec(`
    DELETE FROM tickets WHERE is_demo = 1;
    DELETE FROM reviews WHERE is_demo = 1;
    DELETE FROM activity_logs WHERE is_demo = 1;
  `);
}

function getSetting(key, defaultValue = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value ?? ''));
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  for (const r of rows) {
    result[r.key] = r.value;
  }
  return result;
}

function addActivityLog({ type, title, details = '', user_tag = '', staff_tag = '', amount = 0, is_demo = 0 }) {
  db.prepare(`
    INSERT INTO activity_logs (type, title, details, user_tag, staff_tag, amount, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(type, title, details, user_tag, staff_tag, Number(amount) || 0, is_demo ? 1 : 0);
}

function getDashboardStats() {
  const salesRow = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
    FROM tickets WHERE status = 'completed_sale' OR deal_type = 'sale'
  `).get();

  const purchasesRow = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
    FROM tickets WHERE status = 'completed_purchase' OR deal_type = 'purchase'
  `).get();

  const noBuyRow = db.prepare(`
    SELECT COUNT(*) as count
    FROM tickets WHERE status = 'cancelled_no_buy' OR deal_type = 'no_deal'
  `).get();

  const openTicketsRow = db.prepare(`
    SELECT COUNT(*) as count
    FROM tickets WHERE status IN ('open', 'claimed')
  `).get();

  const totalTicketsRow = db.prepare(`SELECT COUNT(*) as count FROM tickets`).get();

  const reviewsStats = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(ROUND(AVG(rating), 2), 0) as avg_rating
    FROM reviews
  `).get();

  const starDistRows = db.prepare(`
    SELECT rating, COUNT(*) as count
    FROM reviews
    GROUP BY rating
  `).all();
  const starDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of starDistRows) {
    starDistribution[r.rating] = r.count;
  }

  const cancelReasons = db.prepare(`
    SELECT COALESCE(NULLIF(cancel_reason, ''), 'غير محدد') as reason, COUNT(*) as count
    FROM tickets
    WHERE status = 'cancelled_no_buy' OR deal_type = 'no_deal'
    GROUP BY reason
    ORDER BY count DESC
  `).all();

  const dailyStats = db.prepare(`
    SELECT
      date(created_at) as day,
      SUM(CASE WHEN status = 'completed_sale' OR deal_type = 'sale' THEN amount ELSE 0 END) as sales_amount,
      SUM(CASE WHEN status = 'completed_sale' OR deal_type = 'sale' THEN 1 ELSE 0 END) as sales_count,
      SUM(CASE WHEN status = 'completed_purchase' OR deal_type = 'purchase' THEN amount ELSE 0 END) as purchases_amount,
      SUM(CASE WHEN status = 'completed_purchase' OR deal_type = 'purchase' THEN 1 ELSE 0 END) as purchases_count,
      SUM(CASE WHEN status = 'cancelled_no_buy' OR deal_type = 'no_deal' THEN 1 ELSE 0 END) as nobuy_count
    FROM tickets
    GROUP BY date(created_at)
    ORDER BY day ASC
    LIMIT 14
  `).all();

  const topStaff = db.prepare(`
    SELECT
      COALESCE(NULLIF(claimed_by_tag, ''), 'الإدارة العامة') as staff_name,
      SUM(CASE WHEN status = 'completed_sale' THEN 1 ELSE 0 END) as sales_count,
      SUM(CASE WHEN status = 'completed_sale' THEN amount ELSE 0 END) as sales_total,
      SUM(CASE WHEN status = 'completed_purchase' THEN 1 ELSE 0 END) as purchases_count,
      COUNT(*) as total_handled
    FROM tickets
    WHERE claimed_by_tag != '' OR status IN ('completed_sale', 'completed_purchase')
    GROUP BY staff_name
    ORDER BY sales_total DESC
    LIMIT 6
  `).all();

  const topProducts = db.prepare(`
    SELECT id, name, price, currency, category, stock, sales_count, active
    FROM products
    ORDER BY sales_count DESC
    LIMIT 6
  `).all();

  const decidedDeals = salesRow.count + noBuyRow.count;
  const conversionRate = decidedDeals > 0 ? Math.round((salesRow.count / decidedDeals) * 100) : 100;

  return {
    sales: { count: salesRow.count, total: salesRow.total },
    purchases: { count: purchasesRow.count, total: purchasesRow.total },
    noBuy: { count: noBuyRow.count, reasons: cancelReasons },
    tickets: { open: openTicketsRow.count, total: totalTicketsRow.count, conversionRate },
    reviews: { count: reviewsStats.count, average: reviewsStats.avg_rating, distribution: starDistribution },
    dailyStats,
    topStaff,
    topProducts,
    netProfit: salesRow.total - purchasesRow.total
  };
}

function getAdmins() {
  return db.prepare(`SELECT * FROM site_admins ORDER BY CASE WHEN role = 'primary' THEN 0 ELSE 1 END, id ASC`).all();
}

function addAdmin({ discord_id, username = '', avatar = '', note = '', added_by = 'المالك' }) {
  const cleanId = String(discord_id || '').trim();
  if (!cleanId || !/^\d{16,21}$/.test(cleanId)) {
    throw new Error('معرف الديسكورد (Discord User ID) غير صالح. يجب أن يتكون من 17-20 رقماً.');
  }
  const existing = db.prepare('SELECT * FROM site_admins WHERE discord_id = ?').get(cleanId);
  if (existing) {
    throw new Error('هذا الحساب مضاف مسبقاً في قائمة الإدارة.');
  }
  db.prepare(`
    INSERT INTO site_admins (discord_id, username, avatar, role, note, added_by)
    VALUES (?, ?, ?, 'admin', ?, ?)
  `).run(cleanId, username || '', avatar || '', note || 'إداري متجر', added_by);
  return db.prepare('SELECT * FROM site_admins WHERE discord_id = ?').get(cleanId);
}

function removeAdmin(id, operatorDiscordId) {
  const admin = db.prepare('SELECT * FROM site_admins WHERE id = ?').get(Number(id));
  if (!admin) throw new Error('الإداري غير موجود.');
  if (admin.discord_id === '790676969418522664' || admin.role === 'primary') {
    throw new Error('لا يمكن حذف أو تعديل الإداري الأساسي للمتجر.');
  }
  db.prepare('DELETE FROM site_admins WHERE id = ?').run(Number(id));
  db.prepare('DELETE FROM auth_sessions WHERE discord_id = ?').run(admin.discord_id);
  return true;
}

function isAuthorizedAdmin(discord_id) {
  if (discord_id === '790676969418522664') return true;
  const admin = db.prepare('SELECT id FROM site_admins WHERE discord_id = ?').get(String(discord_id).trim());
  return Boolean(admin);
}

initDatabase();

module.exports = {
  db,
  getSetting,
  setSetting,
  getAllSettings,
  addActivityLog,
  getDashboardStats,
  seedDemoData,
  clearDemoData,
  getAdmins,
  addAdmin,
  removeAdmin,
  isAuthorizedAdmin
};
