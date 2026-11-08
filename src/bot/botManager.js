const crypto = require('node:crypto');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  ActivityType,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

const {
  db,
  getSetting,
  setSetting,
  addActivityLog,
  getDashboardStats
} = require('../database/db');

const OWNER_DISCORD_ID = '790676969418522664';

class BotManager {
  constructor() {
    this.client = null;
    this.io = null;
    this.status = 'disconnected';
    this.lastError = '';
    this.limitedIntentsMode = false;
    this.subClients = new Map();
    this.pendingLoginRequests = new Map(); // requestId -> { code, createdAt, approved, sessionToken, user }
  }

  setSocketIO(io) {
    this.io = io;
  }

  emitUpdate(event = 'dashboard:update', payload = {}) {
    if (this.io) {
      this.io.emit(event, payload);
    }
  }

  getActivityTypeEnum(typeStr) {
    const map = {
      Playing: ActivityType.Playing,
      Watching: ActivityType.Watching,
      Listening: ActivityType.Listening,
      Competing: ActivityType.Competing
    };
    return map[typeStr] ?? ActivityType.Playing;
  }

  getButtonStyleEnum(styleStr) {
    const map = {
      Primary: ButtonStyle.Primary,
      Secondary: ButtonStyle.Secondary,
      Success: ButtonStyle.Success,
      Danger: ButtonStyle.Danger
    };
    return map[styleStr] ?? ButtonStyle.Secondary;
  }

  applyButtonEmoji(btn, emojiStr) {
    if (!emojiStr || !String(emojiStr).trim()) return btn;
    try {
      btn.setEmoji(String(emojiStr).trim());
    } catch (_) {}
    return btn;
  }

  async startMainBot(customToken = null) {
    const token = (customToken || getSetting('bot_token') || process.env.DISCORD_TOKEN || '').trim();
    if (!token) {
      this.status = 'disconnected';
      this.lastError = 'لم يتم إدخال توكن البوت بعد.';
      this.emitUpdate('bot:status', this.getBotStatusInfo());
      return { ok: false, message: this.lastError };
    }

    await this.stopMainBot();
    this.status = 'connecting';
    this.lastError = '';
    this.limitedIntentsMode = false;
    this.emitUpdate('bot:status', this.getBotStatusInfo());

    try {
      await this._loginWithIntents(token, true);
      return { ok: true, message: 'تم تشغيل البوت وربطه بالسيرفر بنجاح!' };
    } catch (err) {
      const errMsg = String(err?.message || err);
      if (errMsg.includes('DisallowedIntents') || errMsg.includes('privileged intents')) {
        try {
          this.limitedIntentsMode = true;
          await this._loginWithIntents(token, false);
          this.lastError = 'البوت متصل (يرجى تفعيل Server Members Intent و Message Content Intent من Discord Developer Portal لتعمل ميزة الترحيب والخط التلقائي).';
          this.emitUpdate('bot:status', this.getBotStatusInfo());
          return { ok: true, message: 'تم تشغيل البوت بنجاح.' };
        } catch (retryErr) {
          this.status = 'error';
          this.lastError = retryErr.message || 'فشل الاتصال بالديسكورد';
          this.emitUpdate('bot:status', this.getBotStatusInfo());
          return { ok: false, message: this.lastError };
        }
      }

      this.status = 'error';
      this.lastError = errMsg.includes('TokenInvalid')
        ? 'توكن البوت غير صالح (Invalid Token).'
        : errMsg;
      this.emitUpdate('bot:status', this.getBotStatusInfo());
      return { ok: false, message: this.lastError };
    }
  }

  async _loginWithIntents(token, fullIntents = true) {
    const intents = fullIntents
      ? [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMembers,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages
        ]
      : [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages
        ];

    const client = new Client({
      intents,
      partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember]
    });

    this._registerEvents(client);
    await client.login(token);
    this.client = client;
  }

  async stopMainBot() {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (_) {}
      this.client = null;
    }
    this.status = 'disconnected';
    this.emitUpdate('bot:status', this.getBotStatusInfo());
  }

  getBotStatusInfo() {
    const guild = this.getActiveGuild();
    return {
      status: this.status,
      lastError: this.lastError,
      limitedIntentsMode: this.limitedIntentsMode,
      user: this.client?.user
        ? {
            id: this.client.user.id,
            tag: this.client.user.tag,
            username: this.client.user.username,
            avatar: this.client.user.displayAvatarURL({ size: 128 }),
            ping: this.client.ws.ping
          }
        : null,
      guild: guild
        ? {
            id: guild.id,
            name: guild.name,
            memberCount: guild.memberCount,
            icon: guild.iconURL({ size: 128 })
          }
        : null,
      subBots: this.getSubBotsStatus()
    };
  }

  async getOwnerDiscordProfile() {
    if (this.client && this.client.isReady()) {
      try {
        const user = await this.client.users.fetch(OWNER_DISCORD_ID);
        if (user) {
          return {
            id: user.id,
            username: user.username,
            globalName: user.globalName || user.username,
            tag: user.tag,
            avatar: user.displayAvatarURL({ size: 128 })
          };
        }
      } catch (_) {}
    }
    return {
      id: OWNER_DISCORD_ID,
      username: 'Owner',
      globalName: 'مالك المتجر',
      tag: OWNER_DISCORD_ID,
      avatar: '/images/logo.png'
    };
  }

  // إرسال كود أو زر تأكيد الدخول لحساب ديسكورد الخاص بالمالك فقط (790676969418522664)
  async createOwnerLoginChallenge() {
    const requestId = crypto.randomBytes(12).toString('hex');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const profile = await this.getOwnerDiscordProfile();

    this.pendingLoginRequests.set(requestId, {
      code,
      createdAt: Date.now(),
      approved: false,
      sessionToken: null,
      user: profile
    });

    let dmSent = false;
    if (this.client && this.client.isReady()) {
      try {
        const ownerUser = await this.client.users.fetch(OWNER_DISCORD_ID);
        if (ownerUser) {
          const embed = new EmbedBuilder()
            .setTitle('🔐 طلب تسجيل دخول إلى لوحة تحكم Lab Store')
            .setDescription(
              `مرحباً <@${OWNER_DISCORD_ID}>!\n` +
              `تم طلب تسجيل الدخول إلى الداشبورد بحسابك الخاص.\n\n` +
              `🔑 **كود التحقق الفوري:** \`${code}\`\n\n` +
              `أو اضغط على الزر بالأسفل لفتح لوحة التحكم مباشرة في المتصفح بدون كتابة الكود:`
            )
            .setColor('#2b2d31')
            .setFooter({ text: 'Lab Store Security • مخصص للمالك فقط' })
            .setTimestamp();

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`approve_login_${requestId}`)
              .setLabel('تأكيد الدخول للداشبورد الآن')
              .setEmoji('✅')
              .setStyle(ButtonStyle.Success)
          );

          await ownerUser.send({ embeds: [embed], components: [row] });
          dmSent = true;
        }
      } catch (err) {
        console.warn('[Auth] Could not send DM to owner (DMs may be closed):', err.message);
      }
    }

    return {
      ok: true,
      requestId,
      dmSent,
      ownerProfile: profile,
      message: dmSent
        ? 'تم إرسال زر تأكيد الدخول وكود التحقق إلى خاص حسابك في الديسكورد!'
        : 'الخاص مغلق أو البوت قيد الاتصال — يمكنك كتابة أمر /login في أي روم بالسيرفر للحصول على كود الدخول فوراً!'
    };
  }

  approveLoginRequest(requestId, discordUser) {
    const reqData = this.pendingLoginRequests.get(requestId);
    const sessionToken = crypto.randomBytes(24).toString('hex');
    const username = discordUser?.username || reqData?.user?.username || 'Owner';
    const avatar = discordUser?.displayAvatarURL
      ? discordUser.displayAvatarURL({ size: 128 })
      : reqData?.user?.avatar || '/images/logo.png';

    db.prepare(`
      INSERT INTO auth_sessions (token, discord_id, username, avatar)
      VALUES (?, ?, ?, ?)
    `).run(sessionToken, OWNER_DISCORD_ID, username, avatar);

    if (reqData) {
      reqData.approved = true;
      reqData.sessionToken = sessionToken;
      reqData.user = { id: OWNER_DISCORD_ID, username, avatar };
    }

    this.emitUpdate('auth:approved', {
      requestId,
      sessionToken,
      user: { id: OWNER_DISCORD_ID, username, avatar }
    });

    return sessionToken;
  }

  getActiveGuild() {
    if (!this.client || !this.client.isReady()) return null;
    const configuredGuildId = getSetting('guild_id');
    if (configuredGuildId && this.client.guilds.cache.has(configuredGuildId)) {
      return this.client.guilds.cache.get(configuredGuildId);
    }
    const firstGuild = this.client.guilds.cache.first();
    if (firstGuild && !configuredGuildId) {
      setSetting('guild_id', firstGuild.id);
    }
    return firstGuild || null;
  }

  getGuildMeta() {
    const guild = this.getActiveGuild();
    if (!guild) {
      return {
        connected: false,
        guild: null,
        textChannels: [],
        categoryChannels: [],
        roles: []
      };
    }

    const textChannels = guild.channels.cache
      .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
      .map(c => ({ id: c.id, name: `#${c.name}`, parentId: c.parentId }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const categoryChannels = guild.channels.cache
      .filter(c => c.type === ChannelType.GuildCategory)
      .map(c => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const roles = guild.roles.cache
      .filter(r => r.name !== '@everyone' && !r.managed)
      .sort((a, b) => b.position - a.position)
      .map(r => ({ id: r.id, name: r.name, color: r.hexColor }));

    return {
      connected: true,
      guild: {
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        icon: guild.iconURL({ size: 128 })
      },
      textChannels,
      categoryChannels,
      roles
    };
  }

  applyPresence() {
    if (!this.client || !this.client.user) return;
    const status = getSetting('bot_status', 'online');
    const activityType = getSetting('bot_activity_type', 'Playing');
    const activityText = getSetting('bot_activity_text', 'Lab Store | خدمة العملاء 24/7');

    this.client.user.setPresence({
      status: status === 'invisible' ? 'invisible' : status,
      activities: activityText
        ? [{ name: activityText, type: this.getActivityTypeEnum(activityType) }]
        : []
    });
  }

  async registerSlashCommands() {
    if (!this.client || !this.client.user) return;
    const commands = [
      new SlashCommandBuilder()
        .setName('login')
        .setDescription('دخول لوحة تحكم الموقع (مخصص لمالك المتجر فقط)'),
      new SlashCommandBuilder()
        .setName('panel')
        .setDescription('إرسال لوحة فتح التذاكر التفاعلية في الروم الحالي'),
      new SlashCommandBuilder()
        .setName('products')
        .setDescription('عرض قائمة منتجات المتجر المتوفرة وأسعارها'),
      new SlashCommandBuilder()
        .setName('sale')
        .setDescription('تسجيل عملية بيع ناجحة في التذكرة الحالية وإرسال التقييم للعميل')
        .addNumberOption(opt => opt.setName('amount').setDescription('مبلغ عملية البيع').setRequired(true))
        .addStringOption(opt => opt.setName('product').setDescription('اسم المنتج أو الخدمة المباعة').setRequired(true))
        .addStringOption(opt => opt.setName('notes').setDescription('ملاحظات إضافية').setRequired(false)),
      new SlashCommandBuilder()
        .setName('purchase')
        .setDescription('تسجيل عملية شراء غرض/حساب من العميل لصالح المتجر')
        .addNumberOption(opt => opt.setName('amount').setDescription('المبلغ المدفوع للعميل').setRequired(true))
        .addStringOption(opt => opt.setName('item').setDescription('الغرض أو الحساب الذي تم شراؤه').setRequired(true))
        .addStringOption(opt => opt.setName('notes').setDescription('ملاحظات إضافية').setRequired(false)),
      new SlashCommandBuilder()
        .setName('nobuy')
        .setDescription('تسجيل عدم إتمام الشراء في التذكرة مع تحديد السبب للإحصائيات')
        .addStringOption(opt =>
          opt.setName('reason')
            .setDescription('سبب عدم الشراء')
            .setRequired(true)
            .addChoices(
              { name: 'السعر غير مناسب للعميل', value: 'السعر غير مناسب للعميل' },
              { name: 'المنتج غير متوفر حالياً', value: 'المنتج غير متوفر حالياً' },
              { name: 'عدم توفر طريقة الدفع المطلوبة', value: 'عدم توفر طريقة الدفع المطلوبة' },
              { name: 'العميل لم يرد / خمول بالتذكرة', value: 'العميل لم يرد / خمول بالتذكرة' },
              { name: 'تراجع العميل عن الطلب', value: 'تراجع العميل عن الطلب' },
              { name: 'سبب آخر', value: 'سبب آخر' }
            )
        ),
      new SlashCommandBuilder()
        .setName('review')
        .setDescription('إرسال طلب تقييم لعميل')
        .addUserOption(opt => opt.setName('user').setDescription('العميل المراد طلب التقييم منه').setRequired(true))
        .addStringOption(opt => opt.setName('product').setDescription('اسم المنتج').setRequired(false)),
      new SlashCommandBuilder()
        .setName('stats')
        .setDescription('عرض ملخص إحصائيات المبيعات والمشتريات والتقييمات في السيرفر'),
      new SlashCommandBuilder()
        .setName('line')
        .setDescription('إرسال الخط الفاصل الخاص بالمتجر'),
      new SlashCommandBuilder()
        .setName('clear')
        .setDescription('مسح عدد من الرسائل في الروم الحالي')
        .addIntegerOption(opt => opt.setName('count').setDescription('عدد الرسائل (1-100)').setRequired(true))
    ].map(c => c.toJSON());

    try {
      const rest = new REST({ version: '10' }).setToken(this.client.token);
      const guild = this.getActiveGuild();
      if (guild) {
        await rest.put(Routes.applicationGuildCommands(this.client.user.id, guild.id), { body: commands });
      } else {
        await rest.put(Routes.applicationCommands(this.client.user.id), { body: commands });
      }
      console.log('[BotManager] Slash commands registered successfully.');
    } catch (err) {
      console.warn('[BotManager] Failed to register slash commands:', err.message);
    }
  }

  _registerEvents(client) {
    client.once('clientReady', async () => {
      this.status = 'connected';
      setSetting('client_id', client.user.id);
      this.applyPresence();
      await this.registerSlashCommands();
      console.log(`[BotManager] Logged in as ${client.user.tag}`);
      addActivityLog({
        type: 'bot_control',
        title: 'اتصال البوت الأساسي',
        details: `تم تشغيل البوت ${client.user.tag} بنجاح`,
        staff_tag: 'النظام'
      });
      this.emitUpdate('bot:status', this.getBotStatusInfo());
      this.emitUpdate('dashboard:update', {});
    });

    client.on('error', err => {
      console.error('[BotManager] Client error:', err.message);
      this.lastError = err.message;
      this.emitUpdate('bot:status', this.getBotStatusInfo());
    });

    client.on('guildMemberAdd', async member => {
      try {
        const autoRoleId = getSetting('auto_role_id');
        if (autoRoleId && member.guild.roles.cache.has(autoRoleId)) {
          await member.roles.add(autoRoleId).catch(() => {});
        }

        const welcomeEnabled = getSetting('welcome_enabled', '1') === '1';
        const welcomeChannelId = getSetting('welcome_channel_id');
        if (welcomeEnabled && welcomeChannelId) {
          const channel = member.guild.channels.cache.get(welcomeChannelId);
          if (channel && channel.isTextBased()) {
            const rawMsg = getSetting('welcome_message', 'أهلاً بك {user} في **{server}**!');
            const formatted = rawMsg
              .replace(/\{user\}/g, `<@${member.id}>`)
              .replace(/\{username\}/g, member.user.username)
              .replace(/\{server\}/g, member.guild.name)
              .replace(/\{memberCount\}/g, String(member.guild.memberCount));

            const embed = new EmbedBuilder()
              .setTitle(`👋 مرحباً بك في ${member.guild.name}!`)
              .setDescription(formatted)
              .setColor(getSetting('welcome_embed_color', '#2b2d31'))
              .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
              .setFooter({ text: `العضو رقم #${member.guild.memberCount} • ${getSetting('store_name', 'Lab Store')}` })
              .setTimestamp();

            const banner = getSetting('welcome_banner_url');
            if (banner && banner.startsWith('http')) {
              embed.setImage(banner);
            }

            await channel.send({ content: `<@${member.id}>`, embeds: [embed] });
          }
        }

        addActivityLog({
          type: 'welcome',
          title: 'انضمام عضو جديد',
          details: `انضم العضو ${member.user.tag} للسيرفر`,
          user_tag: member.user.tag
        });
        this.emitUpdate('dashboard:update', {});
      } catch (err) {
        console.error('[BotManager] guildMemberAdd error:', err.message);
      }
    });

    client.on('messageCreate', async message => {
      if (!message.guild || message.author.bot) return;

      try {
        // 1) سجل محادثات التذكرة المفتوحة
        const activeTicket = db.prepare(`
          SELECT id, user_id, messages_log FROM tickets
          WHERE channel_id = ? AND status IN ('open', 'claimed')
        `).get(message.channel.id);

        if (activeTicket) {
          let logs = [];
          try {
            logs = JSON.parse(activeTicket.messages_log || '[]');
          } catch (_) {
            logs = [];
          }
          const isCustomer = message.author.id === activeTicket.user_id;
          const entry = {
            author: message.author.tag || message.author.username,
            role: isCustomer ? 'user' : 'staff',
            content: message.content || (message.attachments.size > 0 ? '[مرفق صورة/ملف]' : ''),
            time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
          };
          logs.push(entry);
          if (logs.length > 100) logs = logs.slice(-100);
          db.prepare('UPDATE tickets SET messages_log = ? WHERE id = ?').run(JSON.stringify(logs), activeTicket.id);
          this.emitUpdate('ticket:message', { ticketId: activeTicket.id, entry });
        }

        // 2) نظام الخط التلقائي في عدة رومات (Multi-Channel Auto-Line)
        if (getSetting('autoline_enabled', '0') === '1') {
          let autoChannels = [];
          try {
            autoChannels = JSON.parse(getSetting('autoline_channels', '[]'));
          } catch (_) {}
          if (Array.isArray(autoChannels) && autoChannels.includes(message.channel.id)) {
            const lineContent = getSetting('autoline_content', '━━━✦❘༻ **Lab Store** ༺❘✦━━━');
            if (lineContent) {
              await message.channel.send({ content: lineContent }).catch(() => {});
            }
          }
        }

        // 3) نظام الرد التلقائي
        const responders = db.prepare('SELECT * FROM auto_responders WHERE enabled = 1').all();
        const contentLower = (message.content || '').trim().toLowerCase();
        if (contentLower) {
          for (const ar of responders) {
            const trigger = (ar.trigger_word || '').trim().toLowerCase();
            if (!trigger) continue;
            let matched = false;
            if (ar.match_type === 'exact' && contentLower === trigger) matched = true;
            else if (ar.match_type === 'startsWith' && contentLower.startsWith(trigger)) matched = true;
            else if (ar.match_type === 'contains' && contentLower.includes(trigger)) matched = true;

            if (matched) {
              if (ar.is_embed) {
                const embed = new EmbedBuilder()
                  .setDescription(ar.response_text)
                  .setColor('#2b2d31')
                  .setFooter({ text: getSetting('store_name', 'Lab Store') });
                await message.reply({ embeds: [embed] }).catch(() => {});
              } else {
                await message.reply({ content: ar.response_text }).catch(() => {});
              }
              break;
            }
          }
        }
      } catch (err) {
        console.error('[BotManager] messageCreate error:', err.message);
      }
    });

    client.on('interactionCreate', async interaction => {
      try {
        if (interaction.isChatInputCommand()) {
          await this._handleSlashCommand(interaction);
        } else if (interaction.isStringSelectMenu()) {
          await this._handleSelectMenu(interaction);
        } else if (interaction.isButton()) {
          await this._handleButton(interaction);
        } else if (interaction.isModalSubmit()) {
          await this._handleModalSubmit(interaction);
        }
      } catch (err) {
        console.error('[BotManager] interactionCreate error:', err);
        const replyMsg = { content: `❌ حدث خطأ: ${err.message}`, flags: 64 };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(replyMsg).catch(() => {});
        } else {
          await interaction.reply(replyMsg).catch(() => {});
        }
      }
    });
  }

  async _handleSlashCommand(interaction) {
    const { commandName } = interaction;

    if (commandName === 'login') {
      if (interaction.user.id !== OWNER_DISCORD_ID) {
        return interaction.reply({
          content: `⛔ عذراً، الدخول للداشبورد مصرح فقط لمالك المتجر (<@${OWNER_DISCORD_ID}>).`,
          flags: 64
        });
      }
      // الموافقة على أحدث طلب دخول أو إنشاء جلسة فورية
      let latestReqId = null;
      for (const [k, v] of this.pendingLoginRequests.entries()) {
        if (!v.approved) latestReqId = k;
      }
      if (!latestReqId) {
        latestReqId = crypto.randomBytes(12).toString('hex');
        const code = String(Math.floor(100000 + Math.random() * 900000));
        this.pendingLoginRequests.set(latestReqId, {
          code,
          createdAt: Date.now(),
          approved: false,
          sessionToken: null,
          user: {
            id: interaction.user.id,
            username: interaction.user.username,
            avatar: interaction.user.displayAvatarURL({ size: 128 })
          }
        });
      }
      const reqInfo = this.pendingLoginRequests.get(latestReqId);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_login_${latestReqId}`)
          .setLabel('فتح لوحة التحكم في المتصفح الآن')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success)
      );
      return interaction.reply({
        content: `🔐 **أهلاً بك يا مالك المتجر!**\nكود الدخول السريع: \`${reqInfo.code}\`\nأو اضغط الزر بالأسفل ليتم تسجيل دخولك في المتصفح تلقائياً:`,
        components: [row],
        flags: 64
      });
    }

    if (commandName === 'panel') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && interaction.user.id !== OWNER_DISCORD_ID) {
        return interaction.reply({ content: '❌ هذا الأمر مخصص لإدارة السيرفر فقط.', flags: 64 });
      }
      await interaction.deferReply({ flags: 64 });
      const res = await this.sendTicketPanel(interaction.channel.id);
      return interaction.editReply({ content: res.message });
    }

    if (commandName === 'products') {
      const products = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY id DESC').all();
      if (products.length === 0) {
        return interaction.reply({ content: '📦 لا توجد منتجات مضافة حالياً في المتجر.', flags: 64 });
      }
      const embed = new EmbedBuilder()
        .setTitle(`🛍️ كتالوج منتجات ${getSetting('store_name', 'Lab Store')}`)
        .setColor(getSetting('default_product_embed_color', '#2b2d31'))
        .setDescription(
          products
            .map(
              (p, i) =>
                `**${i + 1}. ${p.name}** — \`${p.price} ${p.currency}\`\n` +
                `> ${p.description || 'متوفر للتسليم الفوري'} | المخزون: \`${p.stock === -1 ? 'غير محدود ∞' : p.stock}\``
            )
            .join('\n\n')
        )
        .setFooter({ text: 'للطلب يرجى فتح تذكرة شراء من روم التذاكر 🎫' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'stats') {
      const stats = getDashboardStats();
      const currency = getSetting('currency', 'ر.س');
      const embed = new EmbedBuilder()
        .setTitle(`📊 إحصائيات ${getSetting('store_name', 'Lab Store')}`)
        .setColor('#2b2d31')
        .addFields(
          { name: '✅ عمليات البيع', value: `${stats.sales.count} عملية (${stats.sales.total} ${currency})`, inline: true },
          { name: '🤝 عمليات الشراء للمتجر', value: `${stats.purchases.count} عملية (${stats.purchases.total} ${currency})`, inline: true },
          { name: '❌ عدم الشراء / ملغية', value: `${stats.noBuy.count} تذكرة`, inline: true },
          { name: '⭐ متوسط التقييمات', value: `${stats.reviews.average} / 5 (${stats.reviews.count} تقييم)`, inline: true },
          { name: '🎫 التذاكر المفتوحة حالياً', value: `${stats.tickets.open} تذكرة`, inline: true },
          { name: '📈 نسبة إتمام المبيعات', value: `${stats.tickets.conversionRate}%`, inline: true }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'line') {
      const lineContent = getSetting('autoline_content', '━━━✦❘༻ **Lab Store** ༺❘✦━━━');
      await interaction.reply({ content: '✅ تم إرسال الخط.', flags: 64 });
      await interaction.channel.send({ content: lineContent });
      return;
    }

    if (commandName === 'clear') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ content: '❌ لا تملك صلاحية مسح الرسائل.', flags: 64 });
      }
      const count = Math.min(Math.max(interaction.options.getInteger('count') || 10, 1), 100);
      await interaction.channel.bulkDelete(count, true);
      return interaction.reply({ content: `🧹 تم مسح ${count} رسالة بنجاح.`, flags: 64 });
    }

    if (commandName === 'sale' || commandName === 'purchase' || commandName === 'nobuy') {
      const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ هذا الروم ليس تذكرة مسجلة في النظام.', flags: 64 });
      }

      if (commandName === 'sale') {
        const amount = interaction.options.getNumber('amount');
        const product = interaction.options.getString('product');
        const notes = interaction.options.getString('notes') || '';
        await interaction.deferReply();
        await this.updateTicketOutcomeFromDashboard(ticket.id, {
          action: 'completed_sale',
          amount,
          productName: product,
          staffNotes: notes,
          staffName: interaction.user.tag,
          staffId: interaction.user.id,
          closeChannel: false
        });
        return interaction.editReply({ content: `✅ تم تسجيل عملية البيع بنجاح وإرسال طلب التقييم للعميل <@${ticket.user_id}>!` });
      }

      if (commandName === 'purchase') {
        const amount = interaction.options.getNumber('amount');
        const item = interaction.options.getString('item');
        const notes = interaction.options.getString('notes') || '';
        await interaction.deferReply();
        await this.updateTicketOutcomeFromDashboard(ticket.id, {
          action: 'completed_purchase',
          amount,
          productName: item,
          staffNotes: notes,
          staffName: interaction.user.tag,
          staffId: interaction.user.id,
          closeChannel: false
        });
        return interaction.editReply({ content: `🤝 تم تسجيل عملية الشراء من العميل بمبلغ **${amount}** بنجاح!` });
      }

      if (commandName === 'nobuy') {
        const reason = interaction.options.getString('reason');
        await interaction.deferReply();
        await this.updateTicketOutcomeFromDashboard(ticket.id, {
          action: 'cancelled_no_buy',
          amount: 0,
          cancelReason: reason,
          staffName: interaction.user.tag,
          staffId: interaction.user.id,
          closeChannel: false
        });
        return interaction.editReply({ content: `📌 تم تسجيل حالة التذكرة: **لم يتم الشراء** (السبب: ${reason}).` });
      }
    }

    if (commandName === 'review') {
      const targetUser = interaction.options.getUser('user');
      const product = interaction.options.getString('product') || 'خدمة المتجر';
      await this.sendReviewPromptToChannelOrUser(interaction.channel, targetUser.id, 0, product, interaction.user.tag);
      return interaction.reply({ content: `⭐ تم إرسال نموذج التقييم للعميل <@${targetUser.id}>!`, flags: 64 });
    }
  }

  async _handleSelectMenu(interaction) {
    if (interaction.customId === 'ticket_open_select') {
      const catId = Number(interaction.values[0]);
      await this._createTicketChannel(interaction, catId);
      return;
    }

    if (interaction.customId.startsWith('ticket_select_product_')) {
      const ticketId = Number(interaction.customId.replace('ticket_select_product_', ''));
      const prodId = Number(interaction.values[0]);
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(prodId);
      if (!product) {
        return interaction.reply({ content: '❌ لم يتم العثور على المنتج.', flags: 64 });
      }

      db.prepare('UPDATE tickets SET product_id = ?, product_name = ?, amount = ? WHERE id = ?')
        .run(product.id, product.name, product.price, ticketId);

      const embed = new EmbedBuilder()
        .setTitle('🛍️ تم تحديد المنتج في التذكرة')
        .setColor(product.embed_color || '#2b2d31')
        .addFields(
          { name: 'المنتج المختار', value: product.name, inline: true },
          { name: 'السعر', value: `${product.price} ${product.currency}`, inline: true },
          { name: 'المخزون المتاح', value: product.stock === -1 ? 'غير محدود' : String(product.stock), inline: true }
        )
        .setDescription(product.description || 'بانتظار إتمام الدفع والتسليم من قبل ممثل المبيعات.');

      await interaction.reply({ embeds: [embed] });
      this.emitUpdate('dashboard:update', {});
      return;
    }
  }

  async _handleButton(interaction) {
    const { customId } = interaction;

    // 0) زر تأكيد تسجيل الدخول للداشبورد (خاص بالمالك 790676969418522664 فقط)
    if (customId.startsWith('approve_login_')) {
      if (interaction.user.id !== OWNER_DISCORD_ID) {
        return interaction.reply({
          content: '⛔ غير مصرح لك بتأكيد الدخول. هذه اللوحة خاصة بمالك المتجر فقط.',
          flags: 64
        });
      }
      const requestId = customId.replace('approve_login_', '');
      this.approveLoginRequest(requestId, interaction.user);
      return interaction.reply({
        content: '✅ **تم تأكيد هويتك بنجاح!** تم فتح لوحة التحكم في المتصفح الآن.',
        flags: 64
      });
    }

    // 1) أزرار الرتب التفاعلية
    if (customId.startsWith('role_btn_')) {
      const roleId = customId.replace('role_btn_', '');
      const role = interaction.guild?.roles.cache.get(roleId);
      if (!role) {
        return interaction.reply({ content: '❌ هذه الرتبة غير موجودة في السيرفر.', flags: 64 });
      }
      const member = interaction.member;
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        return interaction.reply({ content: `🗑️ تمت إزالة رتبة **${role.name}** منك.`, flags: 64 });
      } else {
        await member.roles.add(roleId);
        return interaction.reply({ content: `✅ تم إعطاؤك رتبة **${role.name}** بنجاح!`, flags: 64 });
      }
    }

    // 2) فتح تذكرة عبر زر قسم (مثل زر نيتروهات 💎)
    if (customId.startsWith('ticket_open_btn_')) {
      const catId = Number(customId.replace('ticket_open_btn_', ''));
      await this._createTicketChannel(interaction, catId);
      return;
    }

    // 2.b) فتح تذكرة مباشرة لمنتج معين (من بطاقة المنتج)
    if (customId.startsWith('product_buy_btn_')) {
      const prodId = Number(customId.replace('product_buy_btn_', ''));
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(prodId);
      const buyCat = db.prepare(`SELECT id FROM ticket_categories WHERE type = 'buy' AND enabled = 1 LIMIT 1`).get()
        || db.prepare(`SELECT id FROM ticket_categories WHERE enabled = 1 LIMIT 1`).get();
      await this._createTicketChannel(interaction, buyCat ? buyCat.id : 0, product || null);
      return;
    }

    // 3) استلام التذكرة
    if (customId.startsWith('ticket_claim_')) {
      const ticketId = Number(customId.replace('ticket_claim_', ''));
      const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
      if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة.', flags: 64 });

      db.prepare(`
        UPDATE tickets SET status = 'claimed', claimed_by_id = ?, claimed_by_tag = ? WHERE id = ?
      `).run(interaction.user.id, interaction.user.tag, ticketId);

      addActivityLog({
        type: 'ticket_open',
        title: `استلام تذكرة #${ticket.ticket_number}`,
        details: `قام ${interaction.user.tag} باستلام تذكرة العميل ${ticket.user_tag}`,
        user_tag: ticket.user_tag,
        staff_tag: interaction.user.tag
      });

      this.emitUpdate('dashboard:update', {});
      return interaction.reply({
        content: `📌 تم استلام هذه التذكرة بواسطة الإداري <@${interaction.user.id}> لخدمتك!`
      });
    }

    // 4) زر إتمام بيع
    if (customId.startsWith('ticket_sale_')) {
      const ticketId = Number(customId.replace('ticket_sale_', ''));
      const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
      if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة.', flags: 64 });

      const modal = new ModalBuilder()
        .setCustomId(`modal_sale_${ticketId}`)
        .setTitle('✅ تسجيل عملية بيع ناجحة');

      const prodInput = new TextInputBuilder()
        .setCustomId('product_name')
        .setLabel('اسم المنتج أو الخدمة المباعة')
        .setStyle(TextInputStyle.Short)
        .setValue(ticket.product_name || '')
        .setPlaceholder('مثال: نيترو قيمنق شهر')
        .setRequired(true);

      const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel(`المبلغ الإجمالي (${getSetting('currency', 'ر.س')})`)
        .setStyle(TextInputStyle.Short)
        .setValue(ticket.amount ? String(ticket.amount) : '')
        .setPlaceholder('مثال: 35')
        .setRequired(true);

      const notesInput = new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('ملاحظات العملية (طريقة الدفع / الضمان)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('تم التحويل والتسليم بنجاح...')
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(prodInput),
        new ActionRowBuilder().addComponents(amountInput),
        new ActionRowBuilder().addComponents(notesInput)
      );

      return interaction.showModal(modal);
    }

    // 5) زر إتمام شراء من العميل
    if (customId.startsWith('ticket_purchase_')) {
      const ticketId = Number(customId.replace('ticket_purchase_', ''));
      const modal = new ModalBuilder()
        .setCustomId(`modal_purchase_${ticketId}`)
        .setTitle('🤝 تسجيل عملية شراء للمتجر من العميل');

      const itemInput = new TextInputBuilder()
        .setCustomId('product_name')
        .setLabel('الغرض أو الحساب الذي تم شراؤه من العميل')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('مثال: حساب ديسكورد 2016')
        .setRequired(true);

      const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel(`المبلغ المدفوع للعميل (${getSetting('currency', 'ر.س')})`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('مثال: 90')
        .setRequired(true);

      const notesInput = new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('ملاحظات الشراء')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(itemInput),
        new ActionRowBuilder().addComponents(amountInput),
        new ActionRowBuilder().addComponents(notesInput)
      );

      return interaction.showModal(modal);
    }

    // 6) زر لم يتم الشراء
    if (customId.startsWith('ticket_nobuy_')) {
      const ticketId = Number(customId.replace('ticket_nobuy_', ''));
      const modal = new ModalBuilder()
        .setCustomId(`modal_nobuy_${ticketId}`)
        .setTitle('❌ تسجيل عدم إتمام الشراء');

      const reasonInput = new TextInputBuilder()
        .setCustomId('cancel_reason')
        .setLabel('سبب عدم الشراء (يظهر في إحصائيات الموقع)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('السعر غير مناسب / المنتج غير متوفر / العميل لم يرد')
        .setRequired(true);

      const notesInput = new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('تفاصيل إضافية (اختياري)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(reasonInput),
        new ActionRowBuilder().addComponents(notesInput)
      );

      return interaction.showModal(modal);
    }

    // 7) زر إغلاق التذكرة
    if (customId.startsWith('ticket_close_')) {
      const ticketId = Number(customId.replace('ticket_close_', ''));
      const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
      if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة.', flags: 64 });

      if (ticket.status === 'open' || ticket.status === 'claimed') {
        db.prepare(`UPDATE tickets SET status = 'closed', closed_at = datetime('now', 'localtime') WHERE id = ?`).run(ticketId);
      } else {
        db.prepare(`UPDATE tickets SET closed_at = datetime('now', 'localtime') WHERE id = ?`).run(ticketId);
      }

      addActivityLog({
        type: 'ticket_close',
        title: `إغلاق تذكرة #${ticket.ticket_number}`,
        details: `تم إغلاق التذكرة بواسطة ${interaction.user.tag}`,
        user_tag: ticket.user_tag,
        staff_tag: interaction.user.tag
      });

      this.emitUpdate('dashboard:update', {});
      await interaction.reply({ content: '🔒 سيتم إغلاق وحذف روم التذكرة خلال 5 ثوانٍ... تم حفظ السجل في الداشبورد.' });
      setTimeout(() => {
        interaction.channel?.delete().catch(() => {});
      }, 5000);
      return;
    }

    // 8) أزرار التقييم (1 إلى 5 نجوم)
    if (customId.startsWith('rate_ticket_')) {
      const parts = customId.split('_');
      const ticketId = Number(parts[2]);
      const stars = Number(parts[3]);

      const modal = new ModalBuilder()
        .setCustomId(`modal_review_${ticketId}_${stars}`)
        .setTitle(`⭐ تقييم الخدمة (${stars} من 5 نجوم)`);

      const commentInput = new TextInputBuilder()
        .setCustomId('review_comment')
        .setLabel('اكتب رأيك وتجربتك مع المتجر')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('سرعة في التسليم وتعامل راقي...')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(commentInput));
      return interaction.showModal(modal);
    }
  }

  async _handleModalSubmit(interaction) {
    const { customId } = interaction;

    if (customId.startsWith('modal_sale_')) {
      const ticketId = Number(customId.replace('modal_sale_', ''));
      const productName = interaction.fields.getTextInputValue('product_name');
      const amount = parseFloat(interaction.fields.getTextInputValue('amount')) || 0;
      const notes = interaction.fields.getTextInputValue('notes') || '';

      await interaction.deferReply();
      await this.updateTicketOutcomeFromDashboard(ticketId, {
        action: 'completed_sale',
        amount,
        productName,
        staffNotes: notes,
        staffName: interaction.user.tag,
        staffId: interaction.user.id,
        closeChannel: false
      });

      return interaction.editReply({
        content: `✅ **تم توثيق عملية البيع بنجاح!**\n📦 المنتج: **${productName}**\n💰 المبلغ: **${amount} ${getSetting('currency', 'ر.س')}**\n⭐ تم إرسال نموذج التقييم للعميل.`
      });
    }

    if (customId.startsWith('modal_purchase_')) {
      const ticketId = Number(customId.replace('modal_purchase_', ''));
      const productName = interaction.fields.getTextInputValue('product_name');
      const amount = parseFloat(interaction.fields.getTextInputValue('amount')) || 0;
      const notes = interaction.fields.getTextInputValue('notes') || '';

      await interaction.deferReply();
      await this.updateTicketOutcomeFromDashboard(ticketId, {
        action: 'completed_purchase',
        amount,
        productName,
        staffNotes: notes,
        staffName: interaction.user.tag,
        staffId: interaction.user.id,
        closeChannel: false
      });

      return interaction.editReply({
        content: `🤝 **تم توثيق عملية الشراء لصالح المتجر بنجاح!**\n📦 الغرض المشترى: **${productName}**\n💵 المبلغ المدفوع: **${amount} ${getSetting('currency', 'ر.س')}**`
      });
    }

    if (customId.startsWith('modal_nobuy_')) {
      const ticketId = Number(customId.replace('modal_nobuy_', ''));
      const cancelReason = interaction.fields.getTextInputValue('cancel_reason');
      const notes = interaction.fields.getTextInputValue('notes') || '';

      await interaction.deferReply();
      await this.updateTicketOutcomeFromDashboard(ticketId, {
        action: 'cancelled_no_buy',
        amount: 0,
        cancelReason,
        staffNotes: notes,
        staffName: interaction.user.tag,
        staffId: interaction.user.id,
        closeChannel: false
      });

      return interaction.editReply({
        content: `📌 **تم تسجيل حالة التذكرة: لم يتم الشراء**\n❌ السبب المسجل في الإحصائيات: **${cancelReason}**`
      });
    }

    if (customId.startsWith('modal_review_')) {
      const parts = customId.split('_');
      const ticketId = Number(parts[2]);
      const rating = Math.min(Math.max(Number(parts[3]) || 5, 1), 5);
      const comment = interaction.fields.getTextInputValue('review_comment');

      const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
      const productName = ticket?.product_name || 'منتجات المتجر';
      const staffTag = ticket?.claimed_by_tag || 'فريق المبيعات';

      db.prepare(`
        INSERT INTO reviews (ticket_id, user_id, user_tag, user_avatar, staff_tag, product_name, rating, comment, is_demo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        ticketId || null,
        interaction.user.id,
        interaction.user.tag,
        interaction.user.displayAvatarURL({ size: 128 }),
        staffTag,
        productName,
        rating,
        comment
      );

      addActivityLog({
        type: 'review',
        title: `تقييم جديد ${rating}⭐`,
        details: `${comment} (${productName})`,
        user_tag: interaction.user.tag,
        staff_tag: staffTag
      });

      const reviewsChannelId = getSetting('reviews_channel_id');
      const guild = this.getActiveGuild();
      if (reviewsChannelId && guild) {
        const revChannel = guild.channels.cache.get(reviewsChannelId);
        if (revChannel && revChannel.isTextBased()) {
          const starsVisual = '⭐'.repeat(rating) + '☆'.repeat(5 - rating);
          const revEmbed = new EmbedBuilder()
            .setTitle(`🌟 تقييم عميل جديد — ${getSetting('store_name', 'Lab Store')}`)
            .setColor('#2b2d31')
            .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
            .addFields(
              { name: '👤 العميل', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
              { name: '🛍️ المنتج / الخدمة', value: productName, inline: true },
              { name: '🎖️ المسؤول', value: staffTag, inline: true },
              { name: '⭐ التقييم', value: `${starsVisual} (**${rating}/5**)`, inline: false },
              { name: '💬 رأي العميل', value: `> ${comment}`, inline: false }
            )
            .setTimestamp();
          await revChannel.send({ embeds: [revEmbed] }).catch(() => {});
        }
      }

      this.emitUpdate('dashboard:update', {});
      return interaction.reply({
        content: `❤️ شكراً جزيلاً لك على تقييمك (**${rating}/5 ⭐**)! تم نشر تقييمك في المتجر والداشبورد.`,
        flags: 64
      });
    }
  }

  async _createTicketChannel(interaction, catId, preselectedProduct = null) {
    await interaction.deferReply({ flags: 64 });

    const category = db.prepare('SELECT * FROM ticket_categories WHERE id = ?').get(catId) || {
      id: 0,
      name: preselectedProduct ? preselectedProduct.name : 'تذكرة طلب',
      emoji: '💎',
      type: 'buy',
      embed_color: '#2b2d31',
      welcome_message: 'أهلاً بك! كيف يمكننا مساعدتك؟'
    };

    const existingOpen = db.prepare(`
      SELECT channel_id FROM tickets
      WHERE user_id = ? AND status IN ('open', 'claimed') AND is_demo = 0
    `).get(interaction.user.id);

    if (existingOpen && existingOpen.channel_id && interaction.guild.channels.cache.has(existingOpen.channel_id)) {
      return interaction.editReply({
        content: `⚠️ لديك تذكرة مفتوحة بالفعل: <#${existingOpen.channel_id}>`
      });
    }

    const lastNumRow = db.prepare('SELECT COALESCE(MAX(ticket_number), 100) as max_num FROM tickets').get();
    const nextNum = (lastNumRow.max_num || 100) + 1;

    const permissionOverwrites = [
      {
        id: interaction.guild.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      {
        id: interaction.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.EmbedLinks
        ]
      }
    ];

    const staffRoleIds = (getSetting('staff_role_ids') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (category.staff_role_id) staffRoleIds.push(category.staff_role_id);

    for (const rId of [...new Set(staffRoleIds)]) {
      if (interaction.guild.roles.cache.has(rId)) {
        permissionOverwrites.push({
          id: rId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages
          ]
        });
      }
    }

    const channelOptions = {
      name: `ticket-${nextNum}`,
      type: ChannelType.GuildText,
      topic: `تذكرة ${category.name} | العميل: ${interaction.user.tag} | رقم #${nextNum}`,
      permissionOverwrites
    };

    if (category.discord_category_id && interaction.guild.channels.cache.has(category.discord_category_id)) {
      channelOptions.parent = category.discord_category_id;
    }

    const ticketChannel = await interaction.guild.channels.create(channelOptions);

    const initialLog = JSON.stringify([
      {
        author: 'النظام',
        role: 'system',
        content: `تم فتح التذكرة #${nextNum} في قسم (${category.name}) بواسطة ${interaction.user.tag}`,
        time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
      }
    ]);

    const insertRes = db.prepare(`
      INSERT INTO tickets (
        ticket_number, channel_id, guild_id, user_id, user_tag, user_avatar,
        category_id, category_name, ticket_type, product_id, product_name, amount,
        status, deal_type, currency, messages_log, is_demo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'none', ?, ?, 0)
    `).run(
      nextNum,
      ticketChannel.id,
      interaction.guild.id,
      interaction.user.id,
      interaction.user.tag,
      interaction.user.displayAvatarURL({ size: 128 }),
      category.id,
      category.name,
      category.type || 'buy',
      preselectedProduct ? preselectedProduct.id : null,
      preselectedProduct ? preselectedProduct.name : '',
      preselectedProduct ? preselectedProduct.price : 0,
      getSetting('currency', 'ر.س'),
      initialLog
    );

    const ticketId = Number(insertRes.lastInsertRowid);

    const embedColor = preselectedProduct?.embed_color || category.embed_color || getSetting('ticket_panel_color', '#2b2d31');
    const embed = new EmbedBuilder()
      .setTitle(`${category.emoji || '💎'} تذكرة #${nextNum} — ${category.name}`)
      .setDescription(
        `${category.welcome_message || 'أهلاً بك! سيقوم فريق المبيعات بالرد عليك في أقرب وقت.'}\n\n` +
        `👤 **العميل:** <@${interaction.user.id}>\n` +
        `📂 **القسم:** ${category.name}\n` +
        (preselectedProduct ? `🛍️ **المنتج المطلوب:** ${preselectedProduct.name} (\`${preselectedProduct.price} ${preselectedProduct.currency}\`)\n` : '') +
        `📊 **الحالة:** مفتوحة بانتظار الاستلام`
      )
      .setColor(embedColor)
      .setFooter({ text: `${getSetting('store_name', 'Lab Store')} • لوحة التحكم بالتذكرة` })
      .setTimestamp();

    if (category.banner_url && category.banner_url.startsWith('http')) {
      embed.setImage(category.banner_url);
    }

    const components = [];

    const products = db.prepare('SELECT * FROM products WHERE active = 1 LIMIT 25').all();
    if (products.length > 0 && category.type !== 'sell') {
      const prodSelect = new StringSelectMenuBuilder()
        .setCustomId(`ticket_select_product_${ticketId}`)
        .setPlaceholder(preselectedProduct ? `✅ المنتج المحدد: ${preselectedProduct.name}` : '🛒 اختر المنتج المطلوب من قائمة المتجر (اختياري)')
        .addOptions(
          products.map(p => ({
            label: `${p.name} (${p.price} ${p.currency})`,
            description: (p.description || 'متوفر في المتجر').slice(0, 90),
            value: String(p.id),
            emoji: '🛍️'
          }))
        );
      components.push(new ActionRowBuilder().addComponents(prodSelect));
    }

    const actionButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_claim_${ticketId}`)
        .setLabel('استلام التذكرة')
        .setEmoji('📌')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ticket_sale_${ticketId}`)
        .setLabel('تم البيع')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ticket_purchase_${ticketId}`)
        .setLabel('تم الشراء من العميل')
        .setEmoji('🤝')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ticket_nobuy_${ticketId}`)
        .setLabel('لم يتم الشراء')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`ticket_close_${ticketId}`)
        .setLabel('إغلاق')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Secondary)
    );
    components.push(actionButtons);

    await ticketChannel.send({
      content: `<@${interaction.user.id}> ${staffRoleIds.map(r => `<@&${r}>`).join(' ')}`,
      embeds: [embed],
      components
    });

    addActivityLog({
      type: 'ticket_open',
      title: `تذكرة جديدة #${nextNum}`,
      details: `فتح ${interaction.user.tag} تذكرة في قسم ${category.name}`,
      user_tag: interaction.user.tag
    });

    this.emitUpdate('dashboard:update', {});

    return interaction.editReply({
      content: `✅ تم فتح تذكرتك بنجاح! تفضل بالدخول هنا: <#${ticketChannel.id}>`
    });
  }

  async sendReviewPromptToChannelOrUser(channel, userId, ticketId, productName, staffName) {
    const row = new ActionRowBuilder().addComponents(
      [1, 2, 3, 4, 5].map(stars =>
        new ButtonBuilder()
          .setCustomId(`rate_ticket_${ticketId || 0}_${stars}`)
          .setLabel(`${stars} ⭐`)
          .setStyle(stars >= 4 ? ButtonStyle.Success : stars === 3 ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    );

    const embed = new EmbedBuilder()
      .setTitle('⭐ قيّم تجربتك مع المتجر!')
      .setDescription(
        `مرحباً <@${userId}>! 🎉\n` +
        `تم إتمام طلبك (**${productName || 'منتج المتجر'}**) بواسطة **${staffName || 'فريق المبيعات'}**.\n` +
        `يسعدنا جداً اختيار عدد النجوم بالأسفل وكتابة رأيك في الخدمة!`
      )
      .setColor('#2b2d31');

    if (channel && channel.isTextBased()) {
      await channel.send({ content: `<@${userId}>`, embeds: [embed], components: [row] }).catch(() => {});
    }

    if (this.client && userId) {
      const user = await this.client.users.fetch(userId).catch(() => null);
      if (user) {
        await user.send({ embeds: [embed], components: [row] }).catch(() => {});
      }
    }
  }

  async updateTicketOutcomeFromDashboard(ticketId, {
    action,
    amount = 0,
    productName = '',
    cancelReason = '',
    staffNotes = '',
    staffName = 'لوحة التحكم (Dashboard)',
    staffId = '',
    closeChannel = false
  }) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) throw new Error('التذكرة غير موجودة');

    const finalProduct = productName || ticket.product_name || 'منتج عام';
    const finalAmount = Number(amount) || 0;
    let dealType = 'none';
    if (action === 'completed_sale') dealType = 'sale';
    else if (action === 'completed_purchase') dealType = 'purchase';
    else if (action === 'cancelled_no_buy') dealType = 'no_deal';

    db.prepare(`
      UPDATE tickets
      SET status = ?,
          deal_type = ?,
          amount = ?,
          product_name = ?,
          cancel_reason = ?,
          staff_notes = ?,
          claimed_by_tag = COALESCE(NULLIF(claimed_by_tag, ''), ?),
          claimed_by_id = COALESCE(NULLIF(claimed_by_id, ''), ?),
          closed_at = CASE WHEN ? IN ('completed_sale', 'completed_purchase', 'cancelled_no_buy', 'closed') THEN datetime('now', 'localtime') ELSE closed_at END
      WHERE id = ?
    `).run(
      action,
      dealType,
      finalAmount,
      finalProduct,
      cancelReason || '',
      staffNotes || '',
      staffName,
      staffId,
      action,
      ticketId
    );

    if (action === 'completed_sale') {
      if (ticket.product_id) {
        db.prepare(`
          UPDATE products
          SET sales_count = sales_count + 1,
              stock = CASE WHEN stock > 0 THEN stock - 1 ELSE stock END
          WHERE id = ?
        `).run(ticket.product_id);
      } else if (finalProduct) {
        db.prepare(`
          UPDATE products
          SET sales_count = sales_count + 1,
              stock = CASE WHEN stock > 0 THEN stock - 1 ELSE stock END
          WHERE name = ?
        `).run(finalProduct);
      }

      addActivityLog({
        type: 'sale',
        title: `عملية بيع ناجحة #${ticket.ticket_number}`,
        details: `بيع (${finalProduct}) للعميل ${ticket.user_tag}`,
        user_tag: ticket.user_tag,
        staff_tag: staffName,
        amount: finalAmount
      });
    } else if (action === 'completed_purchase') {
      addActivityLog({
        type: 'purchase',
        title: `عملية شراء للمتجر #${ticket.ticket_number}`,
        details: `شراء (${finalProduct}) من ${ticket.user_tag}`,
        user_tag: ticket.user_tag,
        staff_tag: staffName,
        amount: finalAmount
      });
    } else if (action === 'cancelled_no_buy') {
      addActivityLog({
        type: 'no_buy',
        title: `عدم إتمام شراء #${ticket.ticket_number}`,
        details: `السبب: ${cancelReason || 'غير محدد'}`,
        user_tag: ticket.user_tag,
        staff_tag: staffName,
        amount: 0
      });
    }

    const guild = this.getActiveGuild();
    if (guild && ticket.channel_id) {
      const ticketChannel = guild.channels.cache.get(ticket.channel_id);
      if (ticketChannel && ticketChannel.isTextBased()) {
        if (action === 'completed_sale') {
          await this.sendReviewPromptToChannelOrUser(
            ticketChannel,
            ticket.user_id,
            ticket.id,
            finalProduct,
            staffName
          );
        }

        if (closeChannel) {
          await ticketChannel.send('🔒 تم إغلاق التذكرة من لوحة التحكم، سيتم حذف الروم خلال 5 ثوانٍ...').catch(() => {});
          setTimeout(() => ticketChannel.delete().catch(() => {}), 5000);
        }
      }
    }

    if (guild) {
      const salesLogChannelId = getSetting('sales_log_channel_id') || getSetting('logs_channel_id');
      if (salesLogChannelId) {
        const logCh = guild.channels.cache.get(salesLogChannelId);
        if (logCh && logCh.isTextBased()) {
          const colorMap = {
            completed_sale: '#10b981',
            completed_purchase: '#3b82f6',
            cancelled_no_buy: '#ef4444',
            closed: '#6b7280'
          };
          const titleMap = {
            completed_sale: `✅ فاتورة بيع جديدة — تذكرة #${ticket.ticket_number}`,
            completed_purchase: `🤝 فاتورة شراء للمتجر — تذكرة #${ticket.ticket_number}`,
            cancelled_no_buy: `❌ تذكرة لم يتم الشراء — #${ticket.ticket_number}`,
            closed: `🔒 إغلاق تذكرة — #${ticket.ticket_number}`
          };
          const logEmbed = new EmbedBuilder()
            .setTitle(titleMap[action] || `تحديث تذكرة #${ticket.ticket_number}`)
            .setColor(colorMap[action] || '#2b2d31')
            .addFields(
              { name: '👤 العميل', value: ticket.user_tag, inline: true },
              { name: '🎖️ المسؤول', value: staffName, inline: true },
              { name: '📦 المنتج / الغرض', value: finalProduct || '-', inline: true },
              { name: '💰 المبلغ', value: `${finalAmount} ${getSetting('currency', 'ر.س')}`, inline: true }
            )
            .setTimestamp();

          if (cancelReason) {
            logEmbed.addFields({ name: '📌 سبب عدم الشراء', value: cancelReason, inline: false });
          }
          if (staffNotes) {
            logEmbed.addFields({ name: '📝 ملاحظات', value: staffNotes, inline: false });
          }
          await logCh.send({ embeds: [logEmbed] }).catch(() => {});
        }
      }
    }

    this.emitUpdate('dashboard:update', {});
    return { ok: true };
  }

  async sendTicketMessageFromDashboard(ticketId, messageText, staffName = 'الإدارة (عبر الموقع)') {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) throw new Error('التذكرة غير موجودة');

    let logs = [];
    try {
      logs = JSON.parse(ticket.messages_log || '[]');
    } catch (_) {
      logs = [];
    }

    const entry = {
      author: staffName,
      role: 'staff',
      content: messageText,
      time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
    };
    logs.push(entry);
    db.prepare('UPDATE tickets SET messages_log = ? WHERE id = ?').run(JSON.stringify(logs), ticketId);

    const guild = this.getActiveGuild();
    let sentToDiscord = false;
    if (guild && ticket.channel_id) {
      const ch = guild.channels.cache.get(ticket.channel_id);
      if (ch && ch.isTextBased()) {
        const embed = new EmbedBuilder()
          .setAuthor({ name: `💬 رسالة من ${staffName}` })
          .setDescription(messageText)
          .setColor('#2b2d31')
          .setTimestamp();
        await ch.send({ content: `<@${ticket.user_id}>`, embeds: [embed] });
        sentToDiscord = true;
      }
    }

    this.emitUpdate('ticket:message', { ticketId, entry });
    return { ok: true, sentToDiscord, entry };
  }

  // إرسال بانل التذاكر (يدعم ستايل الصورة فقط + الأزرار بالأسفل كما في الصورة المرفقة تماماً!)
  async sendTicketPanel(channelId) {
    const guild = this.getActiveGuild();
    if (!guild) return { ok: false, message: 'البوت غير متصل بأي سيرفر ديسكورد حالياً.' };

    const targetChannelId = channelId || getSetting('ticket_panel_channel_id');
    const channel = guild.channels.cache.get(targetChannelId);
    if (!channel || !channel.isTextBased()) {
      return { ok: false, message: 'يرجى اختيار روم نصي صحيح لإرسال لوحة التذاكر.' };
    }

    const categories = db.prepare('SELECT * FROM ticket_categories WHERE enabled = 1 ORDER BY id ASC').all();
    if (categories.length === 0) {
      return { ok: false, message: 'لا توجد أقسام تذاكر مفعلة حالياً.' };
    }

    const banner = getSetting('ticket_panel_banner');
    const color = getSetting('ticket_panel_color', '#2b2d31');
    const bannerOnly = getSetting('ticket_panel_banner_only', '1') === '1';
    const panelMode = getSetting('ticket_panel_mode', 'buttons'); // 'buttons' أو 'select'

    const embed = new EmbedBuilder().setColor(color || '#2b2d31');

    if (bannerOnly && banner && banner.startsWith('http')) {
      // ستايل متاجر الديسكورد الاحترافية: الإيمبد يحتوي على صورة البانر فقط بدون أي كلام زائد!
      embed.setImage(banner);
    } else {
      const title = getSetting('ticket_panel_title', 'خدمة العملاء والطلبات — Lab Store');
      const desc = getSetting('ticket_panel_description', 'اضغط على الزر بالأسفل لفتح تذكرة:');
      if (title) embed.setTitle(title);
      if (desc) embed.setDescription(desc);
      if (banner && banner.startsWith('http')) {
        embed.setImage(banner);
      }
    }

    const components = [];
    if (panelMode === 'select') {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('ticket_open_select')
        .setPlaceholder('👇 اختر قسم التذكرة من هنا...')
        .addOptions(
          categories.map(cat => ({
            label: cat.name,
            description: (cat.description || 'اضغط لفتح تذكرة في هذا القسم').slice(0, 95),
            value: String(cat.id),
            emoji: cat.emoji || '💎'
          }))
        );
      components.push(new ActionRowBuilder().addComponents(selectMenu));
    } else {
      // أزرار تحت البانر مباشرة مثل الصورة (مثال: [ نيتروهات 💎 ])
      const buttons = categories.slice(0, 25).map(cat => {
        const btn = new ButtonBuilder()
          .setCustomId(`ticket_open_btn_${cat.id}`)
          .setLabel(cat.name)
          .setStyle(this.getButtonStyleEnum(cat.button_style || 'Secondary'));
        return this.applyButtonEmoji(btn, cat.emoji || '💎');
      });

      for (let i = 0; i < buttons.length; i += 5) {
        components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
      }
    }

    await channel.send({ embeds: [embed], components });
    setSetting('ticket_panel_channel_id', channel.id);

    addActivityLog({
      type: 'bot_control',
      title: 'نشر لوحة التذاكر',
      details: `تم إرسال بانل التذاكر إلى روم #${channel.name}`,
      staff_tag: 'لوحة التحكم'
    });

    return { ok: true, message: `✅ تم إرسال لوحة التذاكر إلى #${channel.name} بنجاح!` };
  }

  // إرسال بانل قسم واحد مخصص (صورة البانر + الزر تحته مثل: خدمة النيترو -> زر نيتروهات 💎)
  async sendSingleCategoryPanel(categoryId, channelId) {
    const guild = this.getActiveGuild();
    if (!guild) return { ok: false, message: 'البوت غير متصل بالسيرفر حالياً.' };

    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) {
      return { ok: false, message: 'يرجى اختيار روم نصي صحيح.' };
    }

    const cat = db.prepare('SELECT * FROM ticket_categories WHERE id = ?').get(categoryId);
    if (!cat) return { ok: false, message: 'القسم غير موجود.' };

    const embed = new EmbedBuilder().setColor(cat.embed_color || getSetting('ticket_panel_color', '#2b2d31'));
    const bannerUrl = cat.banner_url || getSetting('ticket_panel_banner');

    if (Number(cat.banner_only) === 1 && bannerUrl && bannerUrl.startsWith('http')) {
      embed.setImage(bannerUrl);
    } else {
      embed.setTitle(cat.name);
      if (cat.description) embed.setDescription(cat.description);
      if (bannerUrl && bannerUrl.startsWith('http')) embed.setImage(bannerUrl);
    }

    const btn = new ButtonBuilder()
      .setCustomId(`ticket_open_btn_${cat.id}`)
      .setLabel(cat.name)
      .setStyle(this.getButtonStyleEnum(cat.button_style || 'Secondary'));
    this.applyButtonEmoji(btn, cat.emoji || '💎');

    const row = new ActionRowBuilder().addComponents(btn);
    await channel.send({ embeds: [embed], components: [row] });

    return { ok: true, message: `✅ تم إرسال بانل قسم (${cat.name}) إلى #${channel.name} بنجاح!` };
  }

  // إرسال بطاقة منتج مع لون الإيمبد المخصص وستايل البانر أو التفاصيل
  async sendProductCard(productId, channelId) {
    const guild = this.getActiveGuild();
    if (!guild) return { ok: false, message: 'البوت غير متصل بالسيرفر حالياً.' };

    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) {
      return { ok: false, message: 'يرجى تحديد روم صحيح في السيرفر.' };
    }

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) return { ok: false, message: 'المنتج غير موجود.' };

    const embedColor = product.embed_color || getSetting('default_product_embed_color', '#2b2d31');
    const embed = new EmbedBuilder().setColor(embedColor);

    if (Number(product.banner_only) === 1 && product.image_url && product.image_url.startsWith('http')) {
      // ستايل الصورة المرفقة: صورة البانر فقط داخل الإيمبد بلون الإيمبد المختار!
      embed.setImage(product.image_url);
    } else {
      embed
        .setTitle(`${product.button_emoji || '💎'} ${product.name}`)
        .setDescription(product.description || 'منتج أصلي ومضمون من المتجر.')
        .addFields(
          { name: '💰 السعر', value: `**${product.price} ${product.currency}**`, inline: true },
          { name: '📂 التصنيف', value: product.category || 'عام', inline: true },
          { name: '📦 المخزون المتوفر', value: product.stock === -1 ? 'غير محدود ∞' : `${product.stock} قطع`, inline: true }
        )
        .setFooter({ text: getSetting('store_name', 'Lab Store') });

      if (product.image_url && product.image_url.startsWith('http')) {
        embed.setImage(product.image_url);
      }
    }

    const btnLabel = (product.button_label && product.button_label.trim()) ? product.button_label.trim() : product.name;
    const btnEmoji = product.button_emoji || '💎';
    const btnStyle = this.getButtonStyleEnum(product.button_style || 'Secondary');

    const buyBtn = new ButtonBuilder()
      .setCustomId(`product_buy_btn_${product.id}`)
      .setLabel(btnLabel)
      .setStyle(btnStyle);
    this.applyButtonEmoji(buyBtn, btnEmoji);

    const row = new ActionRowBuilder().addComponents(buyBtn);

    await channel.send({ embeds: [embed], components: [row] });
    return { ok: true, message: `✅ تم نشر بطاقة "${product.name}" في #${channel.name} بنجاح!` };
  }

  async sendRolePanel(panelId, channelId) {
    const guild = this.getActiveGuild();
    if (!guild) return { ok: false, message: 'البوت غير متصل بالسيرفر حالياً.' };

    const panel = db.prepare('SELECT * FROM role_panels WHERE id = ?').get(panelId);
    if (!panel) return { ok: false, message: 'لوحة الرتب غير موجودة.' };

    const targetChannelId = channelId || panel.channel_id;
    const channel = guild.channels.cache.get(targetChannelId);
    if (!channel || !channel.isTextBased()) {
      return { ok: false, message: 'يرجى اختيار روم نصي صحيح.' };
    }

    let rolesList = [];
    try {
      rolesList = JSON.parse(panel.roles_json || '[]');
    } catch (_) {}

    if (rolesList.length === 0) {
      return { ok: false, message: 'لا توجد رتب مضافة داخل هذه اللوحة.' };
    }

    const embed = new EmbedBuilder()
      .setTitle(panel.title || '🎭 اختر الرتب الخاصة بك')
      .setDescription(panel.description || 'اضغط على الزر الخاص بالرتبة لإضافتها أو إزالتها من حسابك تلقائياً.')
      .setColor(panel.color || '#2b2d31')
      .setFooter({ text: getSetting('store_name', 'Lab Store') });

    const buttons = rolesList.slice(0, 25).map(r => {
      const btn = new ButtonBuilder()
        .setCustomId(`role_btn_${r.role_id}`)
        .setLabel(r.label || 'رتبة')
        .setStyle(this.getButtonStyleEnum(r.style || 'Secondary'));
      return this.applyButtonEmoji(btn, r.emoji);
    });

    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }

    const sent = await channel.send({ embeds: [embed], components: rows });
    db.prepare('UPDATE role_panels SET channel_id = ?, message_id = ? WHERE id = ?')
      .run(channel.id, sent.id, panelId);

    return { ok: true, message: `✅ تم إرسال لوحة الرتب التفاعلية إلى #${channel.name}!` };
  }

  async sendCustomEmbed({ channelId, content, title, description, color, imageUrl, footer }) {
    const guild = this.getActiveGuild();
    if (!guild) return { ok: false, message: 'البوت غير متصل بالسيرفر حالياً.' };

    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) {
      return { ok: false, message: 'يرجى اختيار روم نصي صحيح.' };
    }

    const embed = new EmbedBuilder().setColor(color || '#2b2d31');

    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (imageUrl && imageUrl.startsWith('http')) embed.setImage(imageUrl);
    if (footer || title || description) {
      embed.setFooter({ text: footer || getSetting('store_name', 'Lab Store') });
    }

    await channel.send({
      content: content || undefined,
      embeds: title || description || imageUrl ? [embed] : []
    });

    addActivityLog({
      type: 'bot_control',
      title: 'إرسال إعلان / إيمبد',
      details: `تم إرسال رسالة إيمبد إلى #${channel.name}`,
      staff_tag: 'لوحة التحكم'
    });

    return { ok: true, message: `✅ تم إرسال الإيمبد إلى #${channel.name} بنجاح!` };
  }

  async sendWelcomeTest(channelId) {
    const guild = this.getActiveGuild();
    if (!guild) return { ok: false, message: 'البوت غير متصل بالسيرفر حالياً.' };

    const targetChannelId = channelId || getSetting('welcome_channel_id');
    const channel = guild.channels.cache.get(targetChannelId);
    if (!channel || !channel.isTextBased()) {
      return { ok: false, message: 'يرجى تحديد روم الترحيب أولاً.' };
    }

    const rawMsg = getSetting('welcome_message', 'أهلاً بك {user} في **{server}**!');
    const formatted = rawMsg
      .replace(/\{user\}/g, `<@${this.client.user.id}>`)
      .replace(/\{username\}/g, this.client.user.username)
      .replace(/\{server\}/g, guild.name)
      .replace(/\{memberCount\}/g, String(guild.memberCount));

    const embed = new EmbedBuilder()
      .setTitle(`👋 مرحباً بك في ${guild.name}! (معاينة تجريبية)`)
      .setDescription(formatted)
      .setColor(getSetting('welcome_embed_color', '#2b2d31'))
      .setThumbnail(this.client.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: `العضو رقم #${guild.memberCount} • ${getSetting('store_name', 'Lab Store')}` })
      .setTimestamp();

    const banner = getSetting('welcome_banner_url');
    if (banner && banner.startsWith('http')) {
      embed.setImage(banner);
    }

    await channel.send({ embeds: [embed] });
    return { ok: true, message: `✅ تم إرسال رسالة الترحيب التجريبية في #${channel.name}!` };
  }

  async startAllSubBots() {
    const rows = db.prepare('SELECT * FROM sub_bots WHERE enabled = 1').all();
    for (const row of rows) {
      await this.startSubBot(row.id).catch(() => {});
    }
  }

  async startSubBot(subBotId) {
    const row = db.prepare('SELECT * FROM sub_bots WHERE id = ?').get(subBotId);
    if (!row || !row.token) return { ok: false, message: 'بيانات البوت الإضافي غير مكتملة.' };

    await this.stopSubBot(subBotId);

    try {
      const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
      });

      client.once('clientReady', () => {
        client.user.setPresence({
          status: row.status || 'online',
          activities: row.activity_text
            ? [{ name: row.activity_text, type: this.getActivityTypeEnum(row.activity_type) }]
            : []
        });
        this.subClients.set(subBotId, {
          client,
          status: 'connected',
          error: '',
          tag: client.user.tag,
          avatar: client.user.displayAvatarURL({ size: 128 })
        });
        this.emitUpdate('bot:status', this.getBotStatusInfo());
      });

      await client.login(row.token.trim());
      db.prepare('UPDATE sub_bots SET enabled = 1 WHERE id = ?').run(subBotId);
      return { ok: true, message: `تم تشغيل البوت (${row.name}) بنجاح!` };
    } catch (err) {
      this.subClients.set(subBotId, {
        client: null,
        status: 'error',
        error: err.message,
        tag: row.name,
        avatar: ''
      });
      this.emitUpdate('bot:status', this.getBotStatusInfo());
      return { ok: false, message: `فشل تشغيل البوت (${row.name}): ${err.message}` };
    }
  }

  async stopSubBot(subBotId) {
    const existing = this.subClients.get(subBotId);
    if (existing && existing.client) {
      try {
        await existing.client.destroy();
      } catch (_) {}
    }
    this.subClients.delete(subBotId);
    this.emitUpdate('bot:status', this.getBotStatusInfo());
  }

  getSubBotsStatus() {
    const rows = db.prepare('SELECT id, name, role_type, status, activity_type, activity_text, enabled, created_at FROM sub_bots ORDER BY id ASC').all();
    return rows.map(r => {
      const live = this.subClients.get(r.id);
      return {
        ...r,
        liveStatus: live?.status || 'disconnected',
        liveTag: live?.tag || '',
        liveAvatar: live?.avatar || '',
        liveError: live?.error || ''
      };
    });
  }
}

const botManager = new BotManager();
module.exports = botManager;
