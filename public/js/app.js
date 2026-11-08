/* ==========================================================
   Lab Store Dashboard — Frontend Controller (app.js)
   Restricted exclusively to Discord ID: 790676969418522664
   ========================================================== */

const socket = io();

let currentView = 'overview';
let currentTicketStatusFilter = 'all';
let activeTicketId = null;
let storeCurrency = 'ر.س';
let guildMetaCache = { connected: false, textChannels: [], categoryChannels: [], roles: [] };
let tempRoleButtons = [];
let selectedAutoLineChannels = [];
let currentLoginRequestId = null;

let salesTrendChartInstance = null;
let noBuyReasonsChartInstance = null;

const viewTitles = {
  'overview': {
    title: 'لوحة الإحصائيات والمراقبة المباشرة',
    sub: 'متابعة حية لجميع عمليات البيع، الشراء، عدم الشراء، والتقييمات في سيرفر الديسكورد'
  },
  'tickets': {
    title: 'إدارة ومراقبة التذاكر (البيع • الشراء • عدم الشراء)',
    sub: 'تحكم كامل بحالة التذاكر ومشاهدة المحادثات المباشرة والرد على العملاء من الموقع'
  },
  'reviews': {
    title: 'مركز التقييمات وآراء العملاء ⭐',
    sub: 'مراقبة تقييمات المشترين ونشرها التلقائي في روم التقييمات بالسيرفر'
  },
  'products': {
    title: 'كتالوج منتجات وخدمات المتجر 🛍️',
    sub: 'إدارة المنتجات وتعديل لون الإيمبد ونشر بطاقات البانر والشراء في الديسكورد'
  },
  'ticket-setup': {
    title: 'إعدادات وأقسام نظام التذاكر 🎫',
    sub: 'تصميم بانل التذاكر (صورة البانر + أزرار الأقسام بالأسفل مثل نيتروهات 💎)'
  },
  'welcome-roles': {
    title: 'نظام الترحيب والرتب التلقائية والتفاعلية 👋',
    sub: 'تخصيص ترحيب الأعضاء الجدد، الرتبة التلقائية، ولوحات الرتب بالأزرار'
  },
  'broadcast': {
    title: 'البرودكاست ورسائل الخاص للأعضاء 📢',
    sub: 'إرسال رسائل جماعية في الخاص (DM) لجميع أعضاء السيرفر أو رتبة معينة مع تتبع فوري للتقدم'
  },
  'bot-control': {
    title: 'مركز التحكم بالبوتات والأدوات الذكية 🤖',
    sub: 'ربط التوكن، التحكم بحالة البوتات، الخط التلقائي متعدد الرومات، والرد التلقائي'
  },
  'admins': {
    title: 'طاقم الإدارة والصلاحيات 👥',
    sub: 'إدارة وتصريح حسابات الإداريين لدخول لوحة التحكم وتوزيع الصلاحيات'
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  initFilterPills();
  handleOAuthUrlParams();
  await checkDiscordAuthStatus();

  socket.on('auth:approved', ({ requestId, sessionToken, user }) => {
    if (!currentLoginRequestId || currentLoginRequestId === requestId) {
      localStorage.setItem('labstore_discord_token', sessionToken);
      document.getElementById('authOverlay').classList.add('hidden');
      if (user) {
        updateUserSidebarProfile(user);
      }
      showToast('تم تأكيد الدخول من حسابك في الديسكورد بنجاح! 🎉');
      refreshAllData();
    }
  });

  socket.on('dashboard:update', () => {
    if (!getAuthToken()) return;
    loadOverview();
    if (currentView === 'tickets') loadTickets();
    if (currentView === 'reviews') loadReviews();
    if (currentView === 'products') loadProducts();
    if (currentView === 'admins') loadAdminsList();
    if (currentView === 'broadcast') loadBroadcastStatus();
  });

  socket.on('broadcast:update', data => {
    if (data && data.active) {
      renderBroadcastState(data.active, data.history || []);
    }
  });

  socket.on('bot:status', statusInfo => {
    updateBotStatusUI(statusInfo);
  });

  socket.on('ticket:message', ({ ticketId, entry }) => {
    if (activeTicketId === Number(ticketId)) {
      appendChatMessageToModal(entry);
    }
  });
});

// ==========================================================
// نظام المصادقة وإدارة حسابات الإداريين
// ==========================================================
function getAuthToken() {
  return localStorage.getItem('labstore_discord_token') || '';
}

function handleOAuthUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const sessionToken = params.get('session_token');
  const authError = params.get('auth_error');

  if (sessionToken) {
    localStorage.setItem('labstore_discord_token', sessionToken);
    window.history.replaceState({}, document.title, '/');
  }
  if (authError) {
    const errBox = document.getElementById('authErrorBox');
    if (errBox) {
      errBox.style.display = 'block';
      errBox.textContent = authError;
    }
    window.history.replaceState({}, document.title, '/');
  }
}

function updateUserSidebarProfile(user) {
  if (!user) return;
  const avatarEl = document.getElementById('sidebarUserAvatar');
  const nameEl = document.getElementById('sidebarUserName');
  const roleEl = document.getElementById('sidebarUserRole');
  const dotEl = document.getElementById('sidebarUserStatusDot');

  if (avatarEl && user.avatar) avatarEl.src = user.avatar;
  if (nameEl) nameEl.textContent = user.username || user.id || 'إداري المتجر';
  if (roleEl) {
    roleEl.textContent = user.isPrimary ? '👑 إداري أساسي' : '🛡️ إداري المتجر';
    roleEl.style.color = user.isPrimary ? '#ffd700' : 'var(--text-secondary)';
  }
  if (dotEl) {
    dotEl.className = 'status-dot connected';
    dotEl.title = 'حساب ديسكورد متصل';
  }

  const addNotice = document.getElementById('adminAddNotice');
  const addBtn = document.getElementById('btnAddAdmin');
  if (addNotice && addBtn) {
    if (user.isPrimary) {
      addNotice.style.display = 'none';
      addBtn.style.display = 'inline-flex';
    } else {
      addNotice.style.display = 'block';
      addBtn.style.display = 'none';
    }
  }
}

async function checkDiscordAuthStatus() {
  try {
    const res = await fetch('/api/auth/status', {
      headers: { 'x-auth-token': getAuthToken() }
    });
    const data = await res.json();

    if (data.authenticated && data.sessionUser) {
      document.getElementById('authOverlay').classList.add('hidden');
      updateUserSidebarProfile(data.sessionUser);
      await refreshAllData();
    } else {
      document.getElementById('authOverlay').classList.remove('hidden');
    }
  } catch (err) {
    console.error('Auth status check failed:', err);
  }
}

async function triggerDiscordBotLogin() {
  try {
    const res = await fetch('/api/auth/discord-challenge', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      currentLoginRequestId = data.requestId;
      const box = document.getElementById('authChallengeBox');
      const msg = document.getElementById('authChallengeMsg');
      if (box) box.style.display = 'block';
      if (msg) msg.textContent = data.message;
      showToast(data.message);
    } else {
      showToast(data.message || 'تعذر إرسال طلب التحقق', 'error');
    }
  } catch (err) {
    showToast('حدث خطأ أثناء الاتصال بالخادم', 'error');
  }
}

async function verifyDiscordCode() {
  const codeInput = document.getElementById('authVerifyCodeInput');
  const code = codeInput ? codeInput.value.trim() : '';
  if (!code) return showToast('يرجى إدخال الكود المكون من 6 أرقام', 'error');

  const res = await fetch('/api/auth/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: currentLoginRequestId, code })
  });
  const data = await res.json();
  if (data.ok && data.sessionToken) {
    localStorage.setItem('labstore_discord_token', data.sessionToken);
    document.getElementById('authOverlay').classList.add('hidden');
    if (data.user) {
      updateUserSidebarProfile(data.user);
    }
    showToast('تم تسجيل الدخول بنجاح! أهلاً بك في Lab Store');
    await refreshAllData();
  } else {
    showToast(data.message || 'كود التحقق غير صحيح', 'error');
  }
}

async function logoutDiscordSession() {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'x-auth-token': getAuthToken() }
  });
  localStorage.removeItem('labstore_discord_token');
  document.getElementById('authOverlay').classList.remove('hidden');
  showToast('تم تسجيل الخروج بنجاح');
}

function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-view');
      switchView(target);
    });
  });
}

function switchView(viewName) {
  currentView = viewName;
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
  });
  document.querySelectorAll('.view-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === `view-${viewName}`);
  });

  const headerInfo = viewTitles[viewName] || viewTitles['overview'];
  document.getElementById('pageHeaderTitle').textContent = headerInfo.title;
  document.getElementById('pageHeaderSub').textContent = headerInfo.sub;

  if (viewName === 'overview') loadOverview();
  if (viewName === 'tickets') loadTickets();
  if (viewName === 'reviews') loadReviews();
  if (viewName === 'products') loadProducts();
  if (viewName === 'ticket-setup') {
    loadCategories();
    loadSettingsIntoForms();
  }
  if (viewName === 'welcome-roles') {
    loadSettingsIntoForms();
    loadRolePanels();
  }
  if (viewName === 'broadcast') {
    loadBroadcastView();
  }
  if (viewName === 'bot-control') {
    loadSettingsIntoForms();
    loadAutoResponders();
    loadSubBots();
  }
  if (viewName === 'admins') {
    loadAdminsList();
  }
}

function initFilterPills() {
  document.querySelectorAll('#ticketFilterPills .filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#ticketFilterPills .filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentTicketStatusFilter = pill.getAttribute('data-status');
      loadTickets();
    });
  });
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
  toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

async function apiFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-auth-token': getAuthToken(),
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  if (res.status === 401 && data.unauthorized) {
    document.getElementById('authOverlay').classList.remove('hidden');
  }
  return data;
}

async function refreshAllData() {
  if (!getAuthToken()) return;
  await loadOverview();
  await loadSettingsIntoForms();
  if (currentView === 'tickets') await loadTickets();
  if (currentView === 'products') await loadProducts();
  if (currentView === 'reviews') await loadReviews();
  if (currentView === 'ticket-setup') await loadCategories();
  if (currentView === 'admins') await loadAdminsList();
}

// ==========================================================
// 1. نظرة عامة والإحصائيات والرسوم البيانية
// ==========================================================
async function loadOverview() {
  try {
    const data = await apiFetch('/api/overview');
    if (!data.ok) return;

    storeCurrency = data.currency || 'ر.س';
    const storeNameEl = document.getElementById('sidebarStoreName');
    if (storeNameEl) storeNameEl.textContent = data.storeName || 'Lab Store';
    const demoBannerEl = document.getElementById('demoBanner');
    if (demoBannerEl) demoBannerEl.style.display = data.hasDemoData ? 'flex' : 'none';

    if (data.guildMeta) {
      guildMetaCache = data.guildMeta;
      populateDiscordSelectors();
    }

    if (data.botStatus) {
      updateBotStatusUI(data.botStatus);
    }

    const s = data.stats;
    if (s) {
      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      setEl('kpiSalesTotal', `${s.sales?.total || 0} ${storeCurrency}`);
      setEl('kpiSalesCount', s.sales?.count || 0);
      setEl('kpiPurchasesTotal', `${s.purchases?.total || 0} ${storeCurrency}`);
      setEl('kpiPurchasesCount', s.purchases?.count || 0);
      setEl('kpiNoBuyCount', `${s.noBuy?.count || 0} تذكرة`);
      setEl('kpiConversionRate', `${s.tickets?.conversionRate ?? 100}%`);
      setEl('kpiAvgRating', `${s.reviews?.average || 0} ⭐`);
      setEl('kpiReviewsCount', s.reviews?.count || 0);
      setEl('kpiNetProfit', `${s.netProfit || 0} ${storeCurrency}`);
      setEl('kpiOpenTickets', s.tickets?.open || 0);
      setEl('navOpenTicketsBadge', s.tickets?.open || 0);

      renderSalesTrendChart(s.dailyStats || []);
      renderNoBuyReasonsChart(s.noBuy?.reasons || []);
      renderTopStaffTable(s.topStaff || []);
      renderLiveActivityFeed(data.recentLogs || []);
    }
  } catch (err) {
    console.error('loadOverview error:', err);
  }
}

function renderSalesTrendChart(dailyStats) {
  const ctx = document.getElementById('salesTrendChart');
  if (!ctx) return;

  const labels = dailyStats.map(d => d.day || 'اليوم');
  const salesAmounts = dailyStats.map(d => Number(d.sales_amount) || 0);
  const purchasesAmounts = dailyStats.map(d => Number(d.purchases_amount) || 0);
  const noBuyCounts = dailyStats.map(d => Number(d.nobuy_count) || 0);

  if (salesTrendChartInstance) {
    salesTrendChartInstance.destroy();
  }

  salesTrendChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length ? labels : ['لا توجد بيانات بعد'],
      datasets: [
        {
          label: `المبيعات (${storeCurrency})`,
          data: salesAmounts.length ? salesAmounts : [0],
          backgroundColor: 'rgba(220, 220, 214, 0.85)',
          borderColor: '#e5e5e0',
          borderWidth: 1,
          borderRadius: 6
        },
        {
          label: `مشتريات المتجر (${storeCurrency})`,
          data: purchasesAmounts.length ? purchasesAmounts : [0],
          backgroundColor: 'rgba(16, 185, 129, 0.75)',
          borderColor: '#10b981',
          borderWidth: 1,
          borderRadius: 6
        },
        {
          label: 'عدد تذاكر عدم الشراء',
          data: noBuyCounts.length ? noBuyCounts : [0],
          type: 'line',
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.2)',
          borderWidth: 2.5,
          tension: 0.35,
          pointRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#d1d5db', font: { family: 'Cairo', weight: 'bold' } }
        }
      },
      scales: {
        x: {
          ticks: { color: '#9ca3af', font: { family: 'Cairo' } },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y: {
          ticks: { color: '#9ca3af', font: { family: 'Cairo' } },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

function renderNoBuyReasonsChart(reasons) {
  const ctx = document.getElementById('noBuyReasonsChart');
  const listEl = document.getElementById('noBuyReasonsList');
  if (!ctx || !listEl) return;

  if (noBuyReasonsChartInstance) {
    noBuyReasonsChartInstance.destroy();
  }

  const hasReasons = reasons && reasons.length > 0;
  const labels = hasReasons ? reasons.map(r => r.reason) : ['لا توجد حالات عدم شراء'];
  const counts = hasReasons ? reasons.map(r => r.count) : [1];
  const colors = ['#ef4444', '#f59e0b', '#d4d4ce', '#3b82f6', '#ec4899', '#6b7280'];

  noBuyReasonsChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        {
          data: counts,
          backgroundColor: hasReasons ? colors.slice(0, labels.length) : ['rgba(255,255,255,0.08)'],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '66%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#d1d5db', font: { family: 'Cairo', size: 11 } }
        }
      }
    }
  });

  if (!hasReasons) {
    listEl.innerHTML = `<div style="font-size: 12.5px; color: var(--text-muted); text-align: center;">لا توجد حالات عدم شراء مسجلة حالياً 🎉</div>`;
    return;
  }

  listEl.innerHTML = reasons
    .map(
      r => `
      <div style="display:flex; justify-content:space-between; font-size:12.5px; padding:6px 10px; background:rgba(239,68,68,0.08); border-radius:8px; border:1px solid rgba(239,68,68,0.2);">
        <span>❌ ${escapeHtml(r.reason)}</span>
        <strong style="color:#f87171;">${r.count} تذكرة</strong>
      </div>
    `
    )
    .join('');
}

function renderTopStaffTable(topStaff) {
  const tbody = document.getElementById('topStaffTableBody');
  if (!tbody) return;

  if (!topStaff.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">لا توجد عمليات مسجلة بعد</td></tr>`;
    return;
  }

  tbody.innerHTML = topStaff
    .map(
      (st, idx) => `
      <tr>
        <td><strong>${idx === 0 ? '👑 ' : ''}${escapeHtml(st.staff_name)}</strong></td>
        <td><span class="badge badge-sale">${st.sales_count} بيع</span></td>
        <td><strong style="color:var(--accent-emerald);">${st.sales_total} ${storeCurrency}</strong></td>
        <td><span class="badge badge-purchase">${st.purchases_count} شراء</span></td>
        <td>${st.total_handled} تذكرة</td>
      </tr>
    `
    )
    .join('');
}

function renderLiveActivityFeed(logs) {
  const container = document.getElementById('liveActivityFeed');
  if (!container) return;

  if (!logs.length) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد أحداث مسجلة حتى الآن</div>`;
    return;
  }

  const iconMap = {
    sale: { icon: 'fa-sack-dollar', cls: 'emerald' },
    purchase: { icon: 'fa-handshake', cls: 'blue' },
    no_buy: { icon: 'fa-ban', cls: 'rose' },
    review: { icon: 'fa-star', cls: 'amber' },
    welcome: { icon: 'fa-user-plus', cls: 'indigo' },
    ticket_open: { icon: 'fa-ticket', cls: 'amber' },
    ticket_close: { icon: 'fa-lock', cls: 'purple' },
    bot_control: { icon: 'fa-robot', cls: 'indigo' }
  };

  container.innerHTML = logs
    .map(l => {
      const m = iconMap[l.type] || { icon: 'fa-bell', cls: 'indigo' };
      const amountBadge = l.amount > 0 ? `<span class="badge badge-sale">${l.amount} ${storeCurrency}</span>` : '';
      return `
        <div class="feed-item">
          <div class="feed-icon kpi-icon ${m.cls}">
            <i class="fa-solid ${m.icon}"></i>
          </div>
          <div class="feed-content">
            <h5>${escapeHtml(l.title)} ${amountBadge}</h5>
            <p>${escapeHtml(l.details || '')}</p>
          </div>
          <div class="feed-meta">
            <div>${escapeHtml(l.staff_tag || l.user_tag || '')}</div>
            <div>${formatShortDate(l.created_at)}</div>
          </div>
        </div>
      `;
    })
    .join('');
}

function updateBotStatusUI(info) {
  if (!info) return;
  const dot = document.getElementById('sidebarStatusDot');
  const nameEl = document.getElementById('sidebarBotName');
  const subEl = document.getElementById('sidebarBotSub');
  const avatarBox = document.getElementById('sidebarBotAvatar');
  const topGuildName = document.getElementById('topGuildName');
  const badge = document.getElementById('botControlStatusBadge');
  const errAlert = document.getElementById('botErrorAlert');

  if (dot) dot.className = `status-dot ${info.status || 'disconnected'}`;

  if (info.status === 'connected' && info.user) {
    if (nameEl) nameEl.textContent = info.user.tag;
    if (subEl) subEl.textContent = `متصل 🟢 • البنق: ${info.user.ping}ms`;
    if (info.user.avatar && avatarBox) {
      avatarBox.innerHTML = `<img src="${info.user.avatar}" alt="bot" /><span class="status-dot connected" id="sidebarStatusDot"></span>`;
    }
    if (badge) {
      badge.className = 'badge badge-sale';
      badge.textContent = `متصل (${info.user.tag})`;
    }
  } else if (info.status === 'connecting') {
    if (nameEl) nameEl.textContent = 'جاري الاتصال...';
    if (subEl) subEl.textContent = 'يرجى الانتظار';
    if (badge) {
      badge.className = 'badge badge-open';
      badge.textContent = 'جاري الاتصال...';
    }
  } else {
    if (nameEl) nameEl.textContent = 'البوت غير متصل';
    if (subEl) subEl.textContent = 'أدخل التوكن من صفحة التحكم';
    if (badge) {
      badge.className = 'badge badge-nobuy';
      badge.textContent = 'غير متصل';
    }
  }

  if (topGuildName) {
    if (info.guild && info.guild.name) {
      topGuildName.textContent = `${info.guild.name} (${info.guild.memberCount || 0} عضو)`;
    } else if (info.status === 'connected') {
      topGuildName.textContent = 'السيرفر متصل';
    } else {
      topGuildName.textContent = 'بانتظار ربط السيرفر';
    }
  }

  if (errAlert) {
    if (info.lastError) {
      errAlert.style.display = 'block';
      errAlert.textContent = `ℹ️ ${info.lastError}`;
    } else {
      errAlert.style.display = 'none';
    }
  }
}

// ==========================================================
// 2. التذاكر وعمليات البيع والشراء وعدم الشراء
// ==========================================================
async function loadTickets() {
  try {
    const search = document.getElementById('ticketSearchInput')?.value || '';
    const data = await apiFetch(`/api/tickets?status=${encodeURIComponent(currentTicketStatusFilter)}&search=${encodeURIComponent(search)}`);
    if (!data.ok) return;

    const tbody = document.getElementById('ticketsTableBody');
    if (!data.tickets.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:26px; color:var(--text-muted);">لا توجد تذاكر مطابقة للفلتر المحدد</td></tr>`;
      return;
    }

    tbody.innerHTML = data.tickets
      .map(t => {
        const statusBadge = getTicketStatusBadge(t.status);
        const amountStr = t.amount > 0 ? `<strong>${t.amount} ${t.currency || storeCurrency}</strong>` : '-';
        const reasonOrNotes = t.cancel_reason
          ? `<span style="color:#f87171;">❌ ${escapeHtml(t.cancel_reason)}</span>`
          : escapeHtml(t.staff_notes || '-');

        return `
          <tr>
            <td><strong>#${t.ticket_number}</strong></td>
            <td>${escapeHtml(t.user_tag)}</td>
            <td>${escapeHtml(t.category_name || 'عام')}</td>
            <td>${escapeHtml(t.product_name || '-')}</td>
            <td>${statusBadge}</td>
            <td>${amountStr}</td>
            <td style="max-width:220px;">${reasonOrNotes}</td>
            <td>${escapeHtml(t.claimed_by_tag || 'غير مستلمة')}</td>
            <td style="font-size:12px; color:var(--text-secondary);">${formatShortDate(t.created_at)}</td>
            <td>
              <button class="btn btn-primary btn-sm" onclick="openTicketInspector(${t.id})">
                <i class="fa-solid fa-comments"></i> تحكم ومحادثة
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    console.error('loadTickets error:', err);
  }
}

function getTicketStatusBadge(status) {
  switch (status) {
    case 'completed_sale':
      return `<span class="badge badge-sale"><i class="fa-solid fa-check"></i> تم البيع</span>`;
    case 'completed_purchase':
      return `<span class="badge badge-purchase"><i class="fa-solid fa-handshake"></i> تم الشراء</span>`;
    case 'cancelled_no_buy':
      return `<span class="badge badge-nobuy"><i class="fa-solid fa-xmark"></i> لم يتم الشراء</span>`;
    case 'open':
    case 'claimed':
      return `<span class="badge badge-open"><i class="fa-solid fa-clock"></i> مفتوحة الآن</span>`;
    default:
      return `<span class="badge badge-closed"><i class="fa-solid fa-lock"></i> مغلقة</span>`;
  }
}

async function openTicketInspector(ticketId) {
  activeTicketId = Number(ticketId);
  const data = await apiFetch(`/api/tickets/${ticketId}`);
  if (!data.ok) return showToast(data.message || 'تعذر جلب التذكرة', 'error');

  const t = data.ticket;
  document.getElementById('modalTicketTitle').textContent = `🎫 التذكرة #${t.ticket_number} — العميل: ${t.user_tag}`;
  document.getElementById('modalTicketMeta').innerHTML = `
    <div style="background:rgba(255,255,255,0.03); padding:10px; border-radius:8px;">
      <div style="font-size:11px; color:var(--text-secondary);">الحالة الحالية</div>
      <div style="margin-top:4px;">${getTicketStatusBadge(t.status)}</div>
    </div>
    <div style="background:rgba(255,255,255,0.03); padding:10px; border-radius:8px;">
      <div style="font-size:11px; color:var(--text-secondary);">القسم</div>
      <div style="font-weight:700; margin-top:4px;">${escapeHtml(t.category_name || '-')}</div>
    </div>
    <div style="background:rgba(255,255,255,0.03); padding:10px; border-radius:8px;">
      <div style="font-size:11px; color:var(--text-secondary);">المسؤول المستلم</div>
      <div style="font-weight:700; margin-top:4px;">${escapeHtml(t.claimed_by_tag || 'غير محدد')}</div>
    </div>
  `;

  const chatBox = document.getElementById('modalTicketChat');
  chatBox.innerHTML = '';
  const messages = data.messages || [];
  if (messages.length === 0) {
    chatBox.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد رسائل مسجلة في هذه التذكرة</div>`;
  } else {
    messages.forEach(m => appendChatMessageToModal(m));
  }

  document.getElementById('modalOutcomeAction').value =
    ['completed_sale', 'completed_purchase', 'cancelled_no_buy', 'closed'].includes(t.status)
      ? t.status
      : 'completed_sale';
  document.getElementById('modalOutcomeAmount').value = t.amount || 0;
  document.getElementById('modalOutcomeProduct').value = t.product_name || '';
  document.getElementById('modalOutcomeReason').value = t.cancel_reason || '';
  document.getElementById('modalOutcomeNotes').value = t.staff_notes || '';
  document.getElementById('modalCloseDiscordChannel').checked = false;

  document.getElementById('ticketDetailModal').classList.add('open');
}

function appendChatMessageToModal(entry) {
  const chatBox = document.getElementById('modalTicketChat');
  if (!chatBox) return;
  const div = document.createElement('div');
  div.className = `chat-msg ${entry.role === 'staff' ? 'staff' : 'user'}`;
  div.innerHTML = `
    <div class="chat-msg-header">
      <span>${escapeHtml(entry.author || 'عضو')}</span>
      <span>${escapeHtml(entry.time || '')}</span>
    </div>
    <div>${escapeHtml(entry.content || '')}</div>
  `;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function sendChatToTicket() {
  if (!activeTicketId) return;
  const input = document.getElementById('modalChatInput');
  const text = input.value.trim();
  if (!text) return;

  const res = await apiFetch(`/api/tickets/${activeTicketId}/message`, {
    method: 'POST',
    body: JSON.stringify({ message: text })
  });

  if (res.ok) {
    input.value = '';
    showToast(res.sentToDiscord ? 'تم إرسال الرسالة داخل روم التذكرة بالديسكورد!' : 'تم حفظ الرسالة في سجل التذكرة');
  } else {
    showToast(res.message || 'فشل إرسال الرسالة', 'error');
  }
}

async function saveTicketOutcome() {
  if (!activeTicketId) return;
  const payload = {
    action: document.getElementById('modalOutcomeAction').value,
    amount: Number(document.getElementById('modalOutcomeAmount').value) || 0,
    productName: document.getElementById('modalOutcomeProduct').value.trim(),
    cancelReason: document.getElementById('modalOutcomeReason').value.trim(),
    staffNotes: document.getElementById('modalOutcomeNotes').value.trim(),
    closeChannel: document.getElementById('modalCloseDiscordChannel').checked
  };

  const res = await apiFetch(`/api/tickets/${activeTicketId}/outcome`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    showToast(res.message);
    closeModal('ticketDetailModal');
    loadOverview();
    loadTickets();
  } else {
    showToast(res.message || 'حدث خطأ', 'error');
  }
}

async function deleteCurrentTicket() {
  if (!activeTicketId) return;
  const res = await apiFetch(`/api/tickets/${activeTicketId}`, { method: 'DELETE' });
  if (res.ok) {
    showToast('تم حذف التذكرة');
    closeModal('ticketDetailModal');
    loadOverview();
    loadTickets();
  }
}

function openNewDealModal() {
  document.getElementById('newDealModal').classList.add('open');
}

async function submitNewDeal() {
  const payload = {
    user_tag: document.getElementById('newDealUser').value.trim(),
    staff_tag: document.getElementById('newDealStaff').value.trim() || 'الإدارة',
    status: document.getElementById('newDealStatus').value,
    amount: Number(document.getElementById('newDealAmount').value) || 0,
    product_name: document.getElementById('newDealProduct').value.trim(),
    cancel_reason: document.getElementById('newDealReason').value.trim(),
    staff_notes: document.getElementById('newDealNotes').value.trim()
  };

  const res = await apiFetch('/api/tickets', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    showToast(res.message);
    closeModal('newDealModal');
    document.getElementById('newDealUser').value = '';
    document.getElementById('newDealProduct').value = '';
    document.getElementById('newDealAmount').value = '';
    document.getElementById('newDealReason').value = '';
    loadOverview();
    loadTickets();
  } else {
    showToast(res.message || 'يرجى التأكد من البيانات', 'error');
  }
}

// ==========================================================
// 3. التقييمات وآراء العملاء
// ==========================================================
async function loadReviews() {
  const data = await apiFetch('/api/reviews');
  if (!data.ok) return;

  const stats = data.stats;
  document.getElementById('reviewsBigAvg').textContent = stats.average || '0.0';
  document.getElementById('reviewsTotalCount').textContent = stats.count || 0;

  const barsContainer = document.getElementById('starDistributionBars');
  const total = stats.count || 1;
  barsContainer.innerHTML = [5, 4, 3, 2, 1]
    .map(star => {
      const c = stats.distribution?.[star] || 0;
      const pct = Math.round((c / total) * 100);
      return `
        <div class="rating-bar-row">
          <span style="width: 55px; font-weight:700;">${star} نجوم ⭐</span>
          <div class="rating-bar-track">
            <div class="rating-bar-fill" style="width: ${pct}%;"></div>
          </div>
          <span style="width: 45px; text-align:left; color:var(--text-secondary);">${c}</span>
        </div>
      `;
    })
    .join('');

  const grid = document.getElementById('reviewsCardsGrid');
  if (!data.reviews.length) {
    grid.innerHTML = `<div style="color:var(--text-muted); padding:20px;">لا توجد تقييمات مسجلة بعد</div>`;
    return;
  }

  grid.innerHTML = data.reviews
    .map(r => {
      const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
      return `
        <div class="product-card">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <strong>👤 ${escapeHtml(r.user_tag)}</strong>
              <span class="stars-gold">${stars}</span>
            </div>
            <div style="font-size:12px; color:#e5e5e0; font-weight:700; margin-bottom:8px;">
              🛍️ ${escapeHtml(r.product_name || 'منتج المتجر')} • بواسطة: ${escapeHtml(r.staff_tag || 'المبيعات')}
            </div>
            <p style="font-size:13.5px; color:#e5e7eb; line-height:1.6;">"${escapeHtml(r.comment)}"</p>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-color); padding-top:10px; font-size:11.5px; color:var(--text-muted);">
            <span>${formatShortDate(r.created_at)}</span>
            <button class="btn btn-danger btn-sm" onclick="deleteReview(${r.id})">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    })
    .join('');
}

function openAddReviewModal() {
  document.getElementById('addReviewModal').classList.add('open');
}

async function submitNewReview() {
  const payload = {
    user_tag: document.getElementById('revUserTag').value.trim(),
    product_name: document.getElementById('revProduct').value.trim(),
    rating: Number(document.getElementById('revRating').value) || 5,
    comment: document.getElementById('revComment').value.trim()
  };

  const res = await apiFetch('/api/reviews', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    showToast(res.message);
    closeModal('addReviewModal');
    document.getElementById('revUserTag').value = '';
    document.getElementById('revComment').value = '';
    loadReviews();
    loadOverview();
  } else {
    showToast(res.message || 'يرجى تعبئة الحقول', 'error');
  }
}

async function deleteReview(id) {
  const res = await apiFetch(`/api/reviews/${id}`, { method: 'DELETE' });
  if (res.ok) {
    showToast('تم حذف التقييم');
    loadReviews();
    loadOverview();
  }
}

async function saveReviewsChannelSetting() {
  const chId = document.getElementById('settingReviewsChannelId').value;
  const res = await apiFetch('/api/settings', {
    method: 'POST',
    body: JSON.stringify({ reviews_channel_id: chId })
  });
  if (res.ok) showToast('تم حفظ روم التقييمات بنجاح!');
}

// ==========================================================
// 4. كتالوج المنتجات (مع تعديل لون الإيمبد وستايل البانر/الزر)
// ==========================================================
async function loadProducts() {
  const data = await apiFetch('/api/products');
  if (!data.ok) return;

  const grid = document.getElementById('productsGrid');
  if (!data.products.length) {
    grid.innerHTML = `<div style="color:var(--text-muted); padding:20px;">لا توجد منتجات مضافة حالياً</div>`;
    return;
  }

  grid.innerHTML = data.products
    .map(p => {
      const embedColor = p.embed_color || '#2b2d31';
      const isBannerOnly = Number(p.banner_only) === 1;
      const roleOptionsHtml = `<option value="">-- بدون رتبة مخصصة --</option>` +
        (guildMetaCache.roles || []).map(r => `<option value="${r.id}" ${p.staff_role_id === r.id ? 'selected' : ''}>@${escapeHtml(r.name)}</option>`).join('');

      return `
        <div class="product-card" style="border-right: 4px solid ${escapeHtml(embedColor)};">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
              <h4 style="font-size:15.5px; font-weight:800;">${escapeHtml(p.button_emoji || '💎')} ${escapeHtml(p.name)}</h4>
              <span class="product-price-tag">${p.price} ${escapeHtml(p.currency || storeCurrency)}</span>
            </div>
            <div style="margin: 8px 0; display:flex; gap:8px; flex-wrap:wrap;">
              <span class="badge badge-purchase">${escapeHtml(p.category || 'عام')}</span>
              <span class="badge badge-sale">المبيعات: ${p.sales_count}</span>
              <span class="badge badge-open">${isBannerOnly ? '🖼️ ستايل بانر + زر' : '📋 بطاقة كاملة'}</span>
            </div>
            <p style="font-size:13px; color:var(--text-secondary); margin-bottom:10px;">${escapeHtml(p.description || 'متوفر للتسليم الفوري')}</p>

            <!-- التحكم السريع بلون الإيمبد وستايل العرض لكل منتج -->
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; background:rgba(0,0,0,0.28); padding:8px 10px; border-radius:8px; border:1px solid var(--border-color);">
              <div style="display:flex; align-items:center; gap:8px;">
                <input type="color" value="${escapeHtml(embedColor)}" id="prodColorPicker_${p.id}" style="width:32px; height:32px; border:none; background:none; cursor:pointer;" onchange="updateProductEmbedColor(${p.id})" />
                <span style="font-size:12px; color:var(--text-secondary);">لون الإيمبد: <code>${escapeHtml(embedColor)}</code></span>
              </div>
              <select class="form-control" id="prodStyleSelect_${p.id}" style="width:auto; padding:4px 8px; font-size:11.5px;" onchange="updateProductEmbedColor(${p.id})">
                <option value="1" ${isBannerOnly ? 'selected' : ''}>صورة البانر فقط + زر</option>
                <option value="0" ${!isBannerOnly ? 'selected' : ''}>بطاقة كاملة</option>
              </select>
            </div>

            <!-- تحديد الرتبة المسؤولة عن المنتج -->
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; background:rgba(0,0,0,0.28); padding:8px 10px; border-radius:8px; border:1px solid var(--border-color); margin-top:8px;">
              <span style="font-size:12px; color:var(--text-secondary);"><i class="fa-solid fa-user-shield"></i> الرتبة المسؤولة:</span>
              <select class="form-control" id="prodRoleSelect_${p.id}" style="width:auto; max-width: 170px; padding:4px 8px; font-size:11.5px;" onchange="updateProductStaffRole(${p.id})">
                ${roleOptionsHtml}
              </select>
            </div>

            <!-- ترحيب وصورة التذكرة المخصصة لهذا المنتج -->
            <div style="background: rgba(88,101,242,0.06); border: 1px solid rgba(88,101,242,0.2); border-radius: 8px; padding: 8px 10px; margin-top: 8px;">
              <div style="font-size: 11.5px; font-weight: 700; color: #a5b4fc; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center;">
                <span>💬 ترحيب التذكرة الخاص بهذا المنتج:</span>
                <button type="button" class="btn btn-outline btn-sm" style="padding: 2px 8px; font-size: 11px;" onclick="saveProductTicketGreeting(${p.id})">
                  <i class="fa-solid fa-floppy-disk"></i> حفظ
                </button>
              </div>
              <textarea class="form-control" id="prodWelcomeMsg_${p.id}" rows="2" style="font-size: 12px; margin-bottom: 6px;" placeholder="اكتب كلام الترحيب الذي يظهر للعميل في التذكرة عند طلب هذا المنتج...">${escapeHtml(p.welcome_message || '')}</textarea>
              <input type="url" class="form-control" id="prodWelcomeImg_${p.id}" value="${escapeHtml(p.welcome_image || '')}" style="font-size: 11.5px;" placeholder="رابط بنر ترحيب التذكرة (https://...)" />
            </div>
          </div>

          <div style="display:flex; gap:8px; justify-content:space-between; border-top:1px solid var(--border-color); padding-top:12px; margin-top:10px;">
            <button class="btn btn-primary btn-sm" onclick="publishProductToDiscord(${p.id})">
              <i class="fa-brands fa-discord"></i> إرسال للديسكورد (${escapeHtml(p.button_label || p.name)})
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteProduct(${p.id})">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    })
    .join('');
}

async function updateProductStaffRole(productId) {
  const roleId = document.getElementById(`prodRoleSelect_${productId}`)?.value || '';
  const res = await apiFetch(`/api/products/${productId}/color`, {
    method: 'PATCH',
    body: JSON.stringify({ staff_role_id: roleId })
  });
  if (res.ok) {
    showToast('تم تحديث الرتبة المسؤولة عن المنتج بنجاح!');
  }
}

async function saveProductTicketGreeting(productId) {
  const welcomeMsg = document.getElementById(`prodWelcomeMsg_${productId}`)?.value || '';
  const welcomeImg = document.getElementById(`prodWelcomeImg_${productId}`)?.value || '';

  const res = await apiFetch(`/api/products/${productId}/color`, {
    method: 'PATCH',
    body: JSON.stringify({
      welcome_message: welcomeMsg,
      welcome_image: welcomeImg
    })
  });
  if (res.ok) {
    showToast('تم حفظ رسالة وصورة ترحيب التذكرة لهذا المنتج بنجاح!');
  } else {
    showToast(res.message || 'فشل حفظ ترحيب التذكرة', 'error');
  }
}

async function updateProductEmbedColor(productId) {
  const color = document.getElementById(`prodColorPicker_${productId}`)?.value || '#2b2d31';
  const bannerOnly = document.getElementById(`prodStyleSelect_${productId}`)?.value === '1';

  const res = await apiFetch(`/api/products/${productId}/color`, {
    method: 'PATCH',
    body: JSON.stringify({ embed_color: color, banner_only: bannerOnly })
  });
  if (res.ok) {
    showToast(res.message);
    loadProducts();
  }
}

async function createProduct() {
  const name = document.getElementById('prodName').value.trim();
  const payload = {
    name,
    price: Number(document.getElementById('prodPrice').value) || 0,
    category: document.getElementById('prodCategory').value.trim() || 'عام',
    stock: Number(document.getElementById('prodStock').value ?? -1),
    description: document.getElementById('prodDesc').value.trim(),
    image_url: document.getElementById('prodImage').value.trim(),
    embed_color: document.getElementById('prodEmbedColor').value || '#2b2d31',
    banner_only: document.getElementById('prodBannerOnly').value === '1' ? 1 : 0,
    button_label: document.getElementById('prodBtnLabel').value.trim() || name,
    button_emoji: document.getElementById('prodBtnEmoji').value.trim() || '💎',
    button_style: document.getElementById('prodBtnStyle').value || 'Secondary',
    staff_role_id: document.getElementById('prodStaffRole')?.value || '',
    welcome_message: document.getElementById('prodWelcomeMessage')?.value.trim() || '',
    welcome_image: document.getElementById('prodWelcomeImage')?.value.trim() || ''
  };

  const res = await apiFetch('/api/products', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    showToast(res.message);
    document.getElementById('prodName').value = '';
    document.getElementById('prodPrice').value = '';
    document.getElementById('prodDesc').value = '';
    document.getElementById('prodBtnLabel').value = '';
    if (document.getElementById('prodWelcomeMessage')) document.getElementById('prodWelcomeMessage').value = '';
    if (document.getElementById('prodWelcomeImage')) document.getElementById('prodWelcomeImage').value = '';
    const staffRoleEl = document.getElementById('prodStaffRole');
    if (staffRoleEl) staffRoleEl.value = '';
    loadProducts();
  } else {
    showToast(res.message || 'أدخل اسم المنتج', 'error');
  }
}

async function publishProductToDiscord(productId) {
  const channelId = document.getElementById('publishProductChannelSelect').value;
  if (!channelId) {
    return showToast('يرجى اختيار الروم من القائمة أعلى المنتجات أولاً', 'error');
  }
  const res = await apiFetch(`/api/products/${productId}/publish`, {
    method: 'POST',
    body: JSON.stringify({ channelId })
  });
  showToast(res.message, res.ok ? 'success' : 'error');
}

async function deleteProduct(id) {
  const res = await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
  if (res.ok) {
    showToast('تم حذف المنتج');
    loadProducts();
  }
}

// ==========================================================
// 5. إعدادات وأقسام التذاكر (ستايل البانر + الأزرار)
// ==========================================================
async function loadCategories() {
  const data = await apiFetch('/api/categories');
  if (!data.ok) return;

  const tbody = document.getElementById('categoriesTableBody');
  const typeMap = {
    buy: '<span class="badge badge-sale">شراء من المتجر</span>',
    sell: '<span class="badge badge-purchase">بيع للمتجر</span>',
    support: '<span class="badge badge-open">دعم واستفسار</span>'
  };

  tbody.innerHTML = data.categories
    .map(
      c => `
      <tr>
        <td>
          <span class="discord-btn-mock" style="margin:0;">
            <span>${escapeHtml(c.emoji || '💎')}</span>
            <span>${escapeHtml(c.name)}</span>
          </span>
        </td>
        <td>${typeMap[c.type] || c.type}</td>
        <td>
          <span style="display:inline-flex; align-items:center; gap:6px;">
            <span style="width:16px; height:16px; border-radius:4px; background:${escapeHtml(c.embed_color || '#2b2d31')}; border:1px solid rgba(255,255,255,0.2);"></span>
            <code>${escapeHtml(c.embed_color || '#2b2d31')}</code>
          </span>
        </td>
        <td>${c.banner_url ? `<a href="${escapeHtml(c.banner_url)}" target="_blank" style="color:#60a5fa;">معاينة البانر 🔗</a>` : '<span style="color:var(--text-muted);">البانر الافتراضي</span>'}</td>
        <td style="max-width:220px; font-size:12px; color:var(--text-secondary);">${escapeHtml(c.welcome_message || '-')}</td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-primary btn-sm" onclick="publishSingleCategoryPanel(${c.id})">
              <i class="fa-brands fa-discord"></i> إرسال للروم
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteCategory(${c.id})">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `
    )
    .join('');
}

async function createTicketCategory() {
  const payload = {
    name: document.getElementById('catName').value.trim(),
    emoji: document.getElementById('catEmoji').value.trim() || '💎',
    button_style: document.getElementById('catButtonStyle').value || 'Secondary',
    embed_color: document.getElementById('catEmbedColor').value || '#2b2d31',
    banner_url: document.getElementById('catBannerUrl').value.trim(),
    type: document.getElementById('catType').value,
    discord_category_id: document.getElementById('catDiscordParent').value,
    welcome_message: document.getElementById('catWelcome').value.trim(),
    banner_only: 1
  };

  const res = await apiFetch('/api/categories', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    showToast(res.message);
    document.getElementById('catName').value = '';
    document.getElementById('catBannerUrl').value = '';
    document.getElementById('catWelcome').value = '';
    loadCategories();
  } else {
    showToast(res.message, 'error');
  }
}

async function publishSingleCategoryPanel(catId) {
  const channelId =
    document.getElementById('singleCatPublishChannel').value ||
    document.getElementById('ticketPanelChannelSelect').value;

  if (!channelId) {
    return showToast('يرجى اختيار روم الإرسال أعلى جدول الأقسام أولاً', 'error');
  }

  const res = await apiFetch(`/api/categories/${catId}/publish`, {
    method: 'POST',
    body: JSON.stringify({ channelId })
  });
  showToast(res.message, res.ok ? 'success' : 'error');
}

async function deleteCategory(id) {
  const res = await apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
  if (res.ok) {
    showToast('تم حذف القسم');
    loadCategories();
  }
}

async function saveTicketPanelSettingsOnly() {
  const payload = {
    ticket_panel_channel_id: document.getElementById('ticketPanelChannelSelect').value,
    ticket_panel_mode: document.getElementById('ticketPanelModeSelect').value,
    ticket_panel_banner_only: document.getElementById('ticketPanelBannerOnlySelect').value,
    ticket_panel_title: document.getElementById('ticketPanelTitle').value,
    ticket_panel_description: document.getElementById('ticketPanelDesc').value,
    ticket_panel_color: document.getElementById('ticketPanelColor').value,
    ticket_panel_banner: document.getElementById('ticketPanelBanner').value,
    staff_role_ids: document.getElementById('staffRoleSelect').value,
    sales_log_channel_id: document.getElementById('salesLogChannelSelect').value
  };
  const res = await apiFetch('/api/settings', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  showToast(res.message, res.ok ? 'success' : 'error');
}

async function sendTicketPanelToDiscord() {
  await saveTicketPanelSettingsOnly();
  const channelId = document.getElementById('ticketPanelChannelSelect').value;
  const res = await apiFetch('/api/tickets/send-panel', {
    method: 'POST',
    body: JSON.stringify({
      channelId,
      mode: document.getElementById('ticketPanelModeSelect').value,
      bannerOnly: document.getElementById('ticketPanelBannerOnlySelect').value === '1',
      title: document.getElementById('ticketPanelTitle').value,
      description: document.getElementById('ticketPanelDesc').value,
      color: document.getElementById('ticketPanelColor').value,
      banner: document.getElementById('ticketPanelBanner').value
    })
  });
  showToast(res.message, res.ok ? 'success' : 'error');
}

// ==========================================================
// 6. الترحيب والرتب التلقائية والتفاعلية
// ==========================================================
async function saveWelcomeAndRoleSettings() {
  const payload = {
    welcome_enabled: document.getElementById('welcomeEnabled').value,
    welcome_channel_id: document.getElementById('welcomeChannelSelect').value,
    auto_role_id: document.getElementById('autoRoleSelect').value,
    welcome_message: document.getElementById('welcomeMessageInput').value,
    welcome_embed_color: document.getElementById('welcomeColorInput').value,
    welcome_banner_url: document.getElementById('welcomeBannerInput').value
  };

  const res = await apiFetch('/api/settings', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  showToast(res.message, res.ok ? 'success' : 'error');
}

async function testWelcomeMessage() {
  await saveWelcomeAndRoleSettings();
  const channelId = document.getElementById('welcomeChannelSelect').value;
  const res = await apiFetch('/api/bot/control', {
    method: 'POST',
    body: JSON.stringify({ action: 'welcome_test', channelId })
  });
  showToast(res.message, res.ok ? 'success' : 'error');
}

function addTempRoleButton() {
  const roleSelect = document.getElementById('tempRoleSelect');
  const roleId = roleSelect.value;
  const roleName = roleSelect.options[roleSelect.selectedIndex]?.text || 'رتبة';
  const label = document.getElementById('tempRoleLabel').value.trim() || roleName;
  const emoji = document.getElementById('tempRoleEmoji').value.trim() || '🎭';
  const style = document.getElementById('tempRoleStyle').value;

  if (!roleId) {
    return showToast('يرجى اختيار رتبة من السيرفر أولاً', 'error');
  }

  tempRoleButtons.push({ role_id: roleId, label, emoji, style });
  renderTempRolesPreview();
  document.getElementById('tempRoleLabel').value = '';
}

function renderTempRolesPreview() {
  const box = document.getElementById('tempRolesPreview');
  box.innerHTML = tempRoleButtons
    .map(
      (b, idx) => `
      <span class="badge badge-purchase" style="padding:6px 12px;">
        ${escapeHtml(b.emoji)} ${escapeHtml(b.label)}
        <i class="fa-solid fa-xmark" style="cursor:pointer; margin-right:6px;" onclick="removeTempRole(${idx})"></i>
      </span>
    `
    )
    .join('');
}

function removeTempRole(idx) {
  tempRoleButtons.splice(idx, 1);
  renderTempRolesPreview();
}

async function saveAndPublishRolePanel() {
  const title = document.getElementById('rolePanelTitle').value.trim();
  const channelId = document.getElementById('rolePanelChannel').value;
  const description = document.getElementById('rolePanelDesc').value.trim();

  if (!title) return showToast('يرجى كتابة عنوان لوحة الرتب', 'error');
  if (tempRoleButtons.length === 0) return showToast('يرجى إضافة زر رتبة واحد على الأقل للوحة', 'error');

  const createRes = await apiFetch('/api/role-panels', {
    method: 'POST',
    body: JSON.stringify({
      title,
      description,
      channel_id: channelId,
      roles: tempRoleButtons
    })
  });

  if (!createRes.ok) return showToast(createRes.message, 'error');

  if (channelId) {
    const pubRes = await apiFetch(`/api/role-panels/${createRes.id}/publish`, {
      method: 'POST',
      body: JSON.stringify({ channelId })
    });
    showToast(pubRes.message, pubRes.ok ? 'success' : 'error');
  } else {
    showToast('تم حفظ اللوحة بنجاح!');
  }

  tempRoleButtons = [];
  renderTempRolesPreview();
  loadRolePanels();
}

async function loadRolePanels() {
  const data = await apiFetch('/api/role-panels');
  if (!data.ok) return;

  const container = document.getElementById('savedRolePanelsList');
  if (!data.panels.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = data.panels
    .map(p => {
      let count = 0;
      try {
        count = JSON.parse(p.roles_json || '[]').length;
      } catch (_) {}
      return `
        <div class="feed-item" style="margin-bottom:8px;">
          <div class="feed-content">
            <h5>🎭 ${escapeHtml(p.title)} (${count} أزرار رتب)</h5>
            <p>${escapeHtml(p.description || '')}</p>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-primary btn-sm" onclick="republishRolePanel(${p.id})">
              <i class="fa-solid fa-paper-plane"></i> إعادة نشر
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteRolePanel(${p.id})">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    })
    .join('');
}

async function republishRolePanel(id) {
  const channelId = document.getElementById('rolePanelChannel').value;
  const res = await apiFetch(`/api/role-panels/${id}/publish`, {
    method: 'POST',
    body: JSON.stringify({ channelId })
  });
  showToast(res.message, res.ok ? 'success' : 'error');
}

async function deleteRolePanel(id) {
  await apiFetch(`/api/role-panels/${id}`, { method: 'DELETE' });
  loadRolePanels();
}

// ==========================================================
// 7. التحكم بالبوتات + الخط التلقائي متعدد الرومات
// ==========================================================
async function loadSettingsIntoForms() {
  const data = await apiFetch('/api/settings');
  if (!data.ok) return;

  const s = data.settings;
  if (data.guildMeta) {
    guildMetaCache = data.guildMeta;
    populateDiscordSelectors();
  }

  setVal('botTokenInput', s.masked_token || '');
  setVal('botGuildIdInput', s.guild_id || '');
  setVal('storeNameInput', s.store_name || 'Lab Store');
  setVal('storeCurrencyInput', s.currency || 'ر.س');

  setVal('botPresenceStatus', s.bot_status || 'online');
  setVal('botActivityType', s.bot_activity_type || 'Playing');
  setVal('botActivityText', s.bot_activity_text || '');

  setVal('ticketPanelChannelSelect', s.ticket_panel_channel_id || '');
  setVal('ticketPanelModeSelect', s.ticket_panel_mode || 'buttons');
  setVal('ticketPanelBannerOnlySelect', s.ticket_panel_banner_only ?? '1');
  setVal('ticketPanelTitle', s.ticket_panel_title || '');
  setVal('ticketPanelDesc', s.ticket_panel_description || '');
  setVal('ticketPanelColor', s.ticket_panel_color || '#2b2d31');
  setVal('ticketPanelBanner', s.ticket_panel_banner || '');
  setVal('staffRoleSelect', s.staff_role_ids || '');
  setVal('salesLogChannelSelect', s.sales_log_channel_id || '');

  setVal('welcomeEnabled', s.welcome_enabled || '1');
  setVal('welcomeChannelSelect', s.welcome_channel_id || '');
  setVal('autoRoleSelect', s.auto_role_id || '');
  setVal('welcomeMessageInput', s.welcome_message || '');
  setVal('welcomeColorInput', s.welcome_embed_color || '#2b2d31');
  setVal('welcomeBannerInput', s.welcome_banner_url || '');

  setVal('settingReviewsChannelId', s.reviews_channel_id || '');
  setVal('autolineEnabled', s.autoline_enabled || '0');
  setVal('autolineContent', s.autoline_content || '');

  try {
    const parsed = JSON.parse(s.autoline_channels || '[]');
    selectedAutoLineChannels = Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (_) {
    selectedAutoLineChannels = [];
  }
  renderAutoLineChannelChips();
}

function addChannelToAutoLineList() {
  const sel = document.getElementById('autolineChannelSelect');
  const chId = sel?.value;
  if (!chId) return showToast('يرجى اختيار روم من القائمة لإضافته', 'error');

  if (!selectedAutoLineChannels.includes(chId)) {
    selectedAutoLineChannels.push(chId);
    renderAutoLineChannelChips();
  } else {
    showToast('هذا الروم مضاف بالفعل في قائمة الخط التلقائي');
  }
}

function removeAutoLineChannel(chId) {
  selectedAutoLineChannels = selectedAutoLineChannels.filter(id => id !== chId);
  renderAutoLineChannelChips();
}

function renderAutoLineChannelChips() {
  const container = document.getElementById('autolineChannelsChips');
  if (!container) return;

  if (!selectedAutoLineChannels.length) {
    container.innerHTML = `<span style="font-size:12px; color:var(--text-muted);">لم يتم اختيار رومات بعد — اختر الروم من الأعلى واضغط "إضافة الروم"</span>`;
    return;
  }

  const chMap = {};
  (guildMetaCache.textChannels || []).forEach(c => {
    chMap[c.id] = c.name;
  });

  container.innerHTML = selectedAutoLineChannels
    .map(chId => {
      const name = chMap[chId] || `#${chId}`;
      return `
        <span class="channel-chip">
          <span>${escapeHtml(name)}</span>
          <button type="button" onclick="removeAutoLineChannel('${escapeHtml(chId)}')" title="إزالة الروم">
            <i class="fa-solid fa-circle-xmark"></i>
          </button>
        </span>
      `;
    })
    .join('');
}

async function saveAutoLineSettings() {
  // إذا كان المستخدم قد اختار روم في القائمة المنسدلة ولم يضغط "إضافة الروم" بعد، نضيفه تلقائياً للتسهيل
  const currentDropdownVal = document.getElementById('autolineChannelSelect')?.value;
  if (currentDropdownVal && selectedAutoLineChannels.length === 0) {
    selectedAutoLineChannels.push(currentDropdownVal);
    renderAutoLineChannelChips();
  }

  const payload = {
    autoline_enabled: document.getElementById('autolineEnabled').value,
    autoline_content: document.getElementById('autolineContent').value.trim(),
    autoline_channels: selectedAutoLineChannels
  };
  const res = await apiFetch('/api/settings', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  showToast(`تم حفظ إعدادات الخط التلقائي لـ (${selectedAutoLineChannels.length}) رومات بنجاح!`, res.ok ? 'success' : 'error');
}

function populateDiscordSelectors() {
  const textChannels = guildMetaCache.textChannels || [];
  const categoryChannels = guildMetaCache.categoryChannels || [];
  const roles = guildMetaCache.roles || [];

  const chOptions =
    `<option value="">-- اختر روم من السيرفر --</option>` +
    textChannels.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

  document.querySelectorAll('.channel-select').forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = chOptions;
    if (prev) sel.value = prev;
  });

  const catOptions =
    `<option value="">-- بدون كاتيجوري محدد --</option>` +
    categoryChannels.map(c => `<option value="${c.id}">📁 ${escapeHtml(c.name)}</option>`).join('');

  document.querySelectorAll('.category-channel-select').forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = catOptions;
    if (prev) sel.value = prev;
  });

  const roleOptions =
    `<option value="">-- اختر رتبة من السيرفر --</option>` +
    roles.map(r => `<option value="${r.id}">@${escapeHtml(r.name)}</option>`).join('');

  document.querySelectorAll('.role-select').forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = roleOptions;
    if (prev) sel.value = prev;
  });

  renderAutoLineChannelChips();
}

async function saveTokenAndStartBot() {
  const token = document.getElementById('botTokenInput').value.trim();
  const guildId = document.getElementById('botGuildIdInput').value.trim();
  const storeName = document.getElementById('storeNameInput').value.trim();
  const currency = document.getElementById('storeCurrencyInput').value.trim();

  await apiFetch('/api/settings', {
    method: 'POST',
    body: JSON.stringify({ store_name: storeName, currency })
  });

  showToast('جاري الاتصال بسيرفر الديسكورد...');
  const res = await apiFetch('/api/bot/control', {
    method: 'POST',
    body: JSON.stringify({ action: 'save_token_and_start', token, guildId })
  });

  showToast(res.message, res.ok ? 'success' : 'error');
  await refreshAllData();
}

async function controlBotAction(action) {
  const res = await apiFetch('/api/bot/control', {
    method: 'POST',
    body: JSON.stringify({ action })
  });
  showToast(res.message, res.ok ? 'success' : 'error');
  loadOverview();
}

async function updateBotPresenceAction() {
  const payload = {
    action: 'update_presence',
    status: document.getElementById('botPresenceStatus').value,
    activityType: document.getElementById('botActivityType').value,
    activityText: document.getElementById('botActivityText').value.trim()
  };
  const res = await apiFetch('/api/bot/control', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  showToast(res.message, res.ok ? 'success' : 'error');
}

async function sendCustomEmbedToDiscord() {
  const embedData = {
    channelId: document.getElementById('embedTargetChannel').value,
    content: document.getElementById('embedContentPing').value.trim(),
    title: document.getElementById('embedTitleInput').value.trim(),
    description: document.getElementById('embedDescInput').value.trim(),
    color: document.getElementById('embedColorInput').value,
    imageUrl: document.getElementById('embedImageInput').value.trim()
  };

  const res = await apiFetch('/api/bot/control', {
    method: 'POST',
    body: JSON.stringify({ action: 'send_embed', embedData })
  });
  showToast(res.message, res.ok ? 'success' : 'error');
}

// الرد التلقائي
async function loadAutoResponders() {
  const data = await apiFetch('/api/auto-responders');
  if (!data.ok) return;

  const tbody = document.getElementById('autoRespondersTableBody');
  tbody.innerHTML = data.responders
    .map(
      ar => `
      <tr>
        <td><strong>${escapeHtml(ar.trigger_word)}</strong></td>
        <td style="font-size:12.5px; color:var(--text-secondary);">${escapeHtml(ar.response_text)}</td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="deleteAutoResponder(${ar.id})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `
    )
    .join('');
}

async function addAutoResponder() {
  const payload = {
    trigger_word: document.getElementById('arTrigger').value.trim(),
    match_type: document.getElementById('arMatchType').value,
    response_text: document.getElementById('arResponse').value.trim(),
    is_embed: 1
  };
  const res = await apiFetch('/api/auto-responders', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  if (res.ok) {
    showToast(res.message);
    document.getElementById('arTrigger').value = '';
    document.getElementById('arResponse').value = '';
    loadAutoResponders();
  } else {
    showToast(res.message, 'error');
  }
}

async function deleteAutoResponder(id) {
  await apiFetch(`/api/auto-responders/${id}`, { method: 'DELETE' });
  loadAutoResponders();
}

// البوتات الإضافية
async function loadSubBots() {
  const data = await apiFetch('/api/sub-bots');
  if (!data.ok) return;

  const container = document.getElementById('subBotsListContainer');
  if (!data.subBots.length) {
    container.innerHTML = `<div style="font-size:12.5px; color:var(--text-muted);">لا توجد بوتات إضافية مضافة حالياً.</div>`;
    return;
  }

  container.innerHTML = data.subBots
    .map(sb => {
      const isOnline = sb.liveStatus === 'connected';
      return `
        <div class="feed-item">
          <div class="feed-icon kpi-icon ${isOnline ? 'emerald' : 'rose'}">
            <i class="fa-solid fa-robot"></i>
          </div>
          <div class="feed-content">
            <h5>${escapeHtml(sb.name)} ${sb.liveTag ? `(${escapeHtml(sb.liveTag)})` : ''}</h5>
            <p>${isOnline ? '🟢 متصل الآن بالسيرفر' : `🔴 غير متصل ${sb.liveError ? '- ' + escapeHtml(sb.liveError) : ''}`}</p>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-outline btn-sm" onclick="subBotAction(${sb.id}, '${isOnline ? 'stop' : 'start'}')">
              ${isOnline ? 'إيقاف' : 'تشغيل'}
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteSubBot(${sb.id})">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    })
    .join('');
}

async function addSubBotAction() {
  const payload = {
    name: document.getElementById('subBotName').value.trim(),
    token: document.getElementById('subBotToken').value.trim(),
    activity_text: document.getElementById('subBotActivity').value.trim() || 'Lab Store'
  };
  const res = await apiFetch('/api/sub-bots', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  showToast(res.message, res.ok ? 'success' : 'error');
  document.getElementById('subBotName').value = '';
  document.getElementById('subBotToken').value = '';
  loadSubBots();
}

async function subBotAction(id, action) {
  const res = await apiFetch(`/api/sub-bots/${id}/action`, {
    method: 'POST',
    body: JSON.stringify({ action })
  });
  showToast(res.message, res.ok ? 'success' : 'error');
  loadSubBots();
}

async function deleteSubBot(id) {
  await apiFetch(`/api/sub-bots/${id}`, { method: 'DELETE' });
  loadSubBots();
}

// ==========================================================
// البيانات التجريبية والمساعدات
// ==========================================================
async function clearDemoDataAction() {
  const res = await apiFetch('/api/demo/clear', { method: 'POST' });
  if (res.ok) {
    showToast(res.message);
    refreshAllData();
  }
}

async function seedDemoDataAction() {
  const res = await apiFetch('/api/demo/seed', { method: 'POST' });
  if (res.ok) {
    showToast(res.message);
    refreshAllData();
  }
}

function closeModal(modalId) {
  document.getElementById(modalId)?.classList.remove('open');
  if (modalId === 'ticketDetailModal') activeTicketId = null;
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function formatShortDate(dateStr) {
  if (!dateStr) return '-';
  return String(dateStr).slice(0, 16);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==========================================================
// 8. إدارة طاقم الإدارة والصلاحيات (Admins Management)
// ==========================================================
let currentAdminsCache = [];
let isCurrentCallerPrimary = false;

async function loadAdminsList() {
  const tbody = document.getElementById('adminsTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-secondary);"><i class="fa-solid fa-spinner fa-spin"></i> جاري جلب قائمة الإداريين...</td></tr>`;

  try {
    const data = await apiFetch('/api/admins');
    if (!data.ok) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(data.message || 'تعذر تحميل الإداريين')}</td></tr>`;
      return;
    }

    currentAdminsCache = data.admins || [];
    isCurrentCallerPrimary = Boolean(data.isCallerPrimary);

    const addNotice = document.getElementById('adminAddNotice');
    const addBtn = document.getElementById('btnAddAdmin');
    if (addNotice && addBtn) {
      if (isCurrentCallerPrimary) {
        addNotice.style.display = 'none';
        addBtn.style.display = 'inline-flex';
      } else {
        addNotice.style.display = 'block';
        addBtn.style.display = 'none';
      }
    }

    if (currentAdminsCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-secondary);">لا يوجد إداريون مضافون حالياً</td></tr>`;
      return;
    }

    tbody.innerHTML = currentAdminsCache.map(admin => {
      const isOwner = admin.isPrimary;
      const roleBadge = isOwner
        ? `<span class="badge" style="background: rgba(255, 215, 0, 0.15); color: #ffd700; border: 1px solid rgba(255, 215, 0, 0.35);"><i class="fa-solid fa-crown"></i> إداري أساسي</span>`
        : `<span class="badge badge-info"><i class="fa-solid fa-shield-halved"></i> إداري</span>`;

      const actionBtn = isOwner
        ? `<span style="font-size: 11.5px; color: #a8a8a2; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-lock"></i> مثبت دائماً</span>`
        : (isCurrentCallerPrimary
            ? `<button class="btn btn-outline btn-sm" style="color: #ef4444; border-color: rgba(239,68,68,0.3);" onclick="deleteAdminAction(${admin.id}, '${escapeHtml(admin.username || admin.discord_id)}')">
                 <i class="fa-solid fa-trash"></i> إزالة
               </button>`
            : `<span style="font-size: 11.5px; color: #71717a;">لا تملك صلاحية</span>`
          );

      const formattedDate = admin.created_at ? formatShortDate(admin.created_at) : '-';

      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              <img src="${admin.avatar || '/images/logo.png'}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255,255,255,0.1);" onerror="this.src='/images/logo.png'" />
              <div style="font-weight: 700;">${escapeHtml(admin.username || 'مستخدم ديسكورد')}</div>
            </div>
          </td>
          <td><code style="background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 6px; font-size: 12px;">${escapeHtml(admin.discord_id)}</code></td>
          <td>${roleBadge}</td>
          <td>${escapeHtml(admin.note || '-')}</td>
          <td>${escapeHtml(admin.added_by || 'المالك')}</td>
          <td style="font-size: 12px; color: var(--text-secondary);">${formattedDate}</td>
          <td>${actionBtn}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> خطأ: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function submitNewAdmin() {
  const discordIdInput = document.getElementById('newAdminDiscordId');
  const noteInput = document.getElementById('newAdminNote');
  const discordId = (discordIdInput?.value || '').trim();
  const note = (noteInput?.value || '').trim();

  if (!discordId) {
    return showToast('يرجى كتابة آيدي حساب الديسكورد (Discord User ID)', 'error');
  }
  if (!/^\d{17,20}$/.test(discordId)) {
    return showToast('آيدي الديسكورد غير صالح. يجب أن يتكون من 17-20 رقماً', 'error');
  }

  const res = await apiFetch('/api/admins', {
    method: 'POST',
    body: JSON.stringify({ discord_id: discordId, note })
  });

  if (res.ok) {
    showToast(res.message || 'تمت إضافة وتصريح الإداري بنجاح!');
    if (discordIdInput) discordIdInput.value = '';
    if (noteInput) noteInput.value = '';
    await loadAdminsList();
  } else {
    showToast(res.message || 'فشلت إضافة الإداري', 'error');
  }
}

async function deleteAdminAction(id, name) {
  if (!confirm(`هل أنت متأكد من رغبتك في إزالة الإداري (${name}) من لوحة التحكم؟`)) return;

  const res = await apiFetch(`/api/admins/${id}`, { method: 'DELETE' });
  if (res.ok) {
    showToast('تمت إزالة الإداري من لوحة التحكم بنجاح');
    await loadAdminsList();
  } else {
    showToast(res.message || 'فشلت الإزالة', 'error');
  }
}

// ==========================================
// وظائف نظام البرودكاست ورسائل الخاص للأعضاء (Mass DM)
// ==========================================

async function loadBroadcastView() {
  // مزامنة الرتب وقوائم الاختيار
  populateDiscordSelectors();

  // تحديث عدد أعضاء السيرفر الكلي
  const totalGuildMembersEl = document.getElementById('broadcastTotalGuildMembers');
  if (totalGuildMembersEl) {
    if (guildMetaCache.guild?.memberCount) {
      totalGuildMembersEl.textContent = `${guildMetaCache.guild.memberCount} عضو`;
    } else {
      totalGuildMembersEl.textContent = '353 عضو';
    }
  }

  // تحديث بيانات المعاينة
  const previewGuildIcon = document.getElementById('previewGuildIcon');
  const previewGuildName = document.getElementById('previewGuildName');
  const previewBotAvatar = document.getElementById('previewBotAvatar');
  const previewBotName = document.getElementById('previewBotName');

  if (previewGuildIcon && guildMetaCache.guild?.icon) {
    previewGuildIcon.src = guildMetaCache.guild.icon;
  }
  if (previewGuildName) {
    previewGuildName.textContent = `${guildMetaCache.guild?.name || 'Lab Store'} • برودكاست رسمي`;
  }
  if (previewBotAvatar && cachedBotStatus?.avatar) {
    previewBotAvatar.src = cachedBotStatus.avatar;
  }
  if (previewBotName && cachedBotStatus?.tag) {
    previewBotName.textContent = cachedBotStatus.tag.split('#')[0];
  }

  updateBroadcastPreview();
  await updateBroadcastTargetEstimate();
  await loadBroadcastStatus();
}

function onBroadcastTargetTypeChange() {
  const type = document.getElementById('broadcastTargetType')?.value || 'all';
  const roleGroup = document.getElementById('broadcastRolePickerGroup');
  if (roleGroup) {
    roleGroup.style.display = type === 'role' ? 'block' : 'none';
  }
  updateBroadcastTargetEstimate();
}

async function updateBroadcastTargetEstimate() {
  const type = document.getElementById('broadcastTargetType')?.value || 'all';
  const estimateEl = document.getElementById('broadcastTargetEstimate');
  if (!estimateEl) return;

  estimateEl.textContent = 'جاري الحساب...';

  let roleId = '';
  if (type === 'role') {
    roleId = document.getElementById('broadcastTargetRole')?.value || '';
    if (!roleId) {
      estimateEl.textContent = 'يرجى اختيار رتبة أولاً';
      return;
    }
  }

  const res = await apiFetch(`/api/broadcast/count?role_id=${encodeURIComponent(roleId)}`);
  if (res.ok) {
    const total = res.total || 0;
    estimateEl.textContent = `${total.toLocaleString()} عضو مستهدف`;
  } else {
    estimateEl.textContent = 'تعذر الحساب';
  }
}

function updateBroadcastPreview() {
  const title = (document.getElementById('broadcastTitle')?.value || '').trim();
  const msg = (document.getElementById('broadcastMessage')?.value || '').trim();
  const imgUrl = (document.getElementById('broadcastImageUrl')?.value || '').trim();
  const btnText = (document.getElementById('broadcastButtonText')?.value || '').trim();
  const btnUrl = (document.getElementById('broadcastButtonUrl')?.value || '').trim();
  const embedColor = (document.getElementById('broadcastEmbedColor')?.value || '#5865F2').trim();

  const previewBox = document.getElementById('previewEmbedBox');
  const previewTitle = document.getElementById('previewEmbedTitle');
  const previewDesc = document.getElementById('previewEmbedDesc');
  const previewImg = document.getElementById('previewEmbedImage');
  const previewBtnWrap = document.getElementById('previewButtonWrap');
  const previewBtnText = document.getElementById('previewButtonText');

  if (previewBox) {
    previewBox.style.borderRightColor = embedColor || '#5865F2';
  }

  if (previewTitle) {
    if (title) {
      previewTitle.style.display = 'block';
      previewTitle.textContent = title;
    } else {
      previewTitle.style.display = 'none';
    }
  }

  if (previewDesc) {
    previewDesc.textContent = msg || 'أهلاً بك عزيزنا العميل! اكتب نص الرسالة لتشاهده يظهر هنا في المعاينة الحية فوراً...';
  }

  if (previewImg) {
    if (imgUrl && imgUrl.startsWith('http')) {
      previewImg.src = imgUrl;
      previewImg.style.display = 'block';
    } else {
      previewImg.style.display = 'none';
      previewImg.src = '';
    }
  }

  if (previewBtnWrap && previewBtnText) {
    if (btnText && btnUrl && btnUrl.startsWith('http')) {
      previewBtnText.textContent = btnText;
      previewBtnWrap.style.display = 'block';
    } else {
      previewBtnWrap.style.display = 'none';
    }
  }
}

async function startBroadcastCampaign() {
  const type = document.getElementById('broadcastTargetType')?.value || 'all';
  const roleId = type === 'role' ? (document.getElementById('broadcastTargetRole')?.value || '') : '';
  const title = (document.getElementById('broadcastTitle')?.value || '').trim();
  const message = (document.getElementById('broadcastMessage')?.value || '').trim();
  const imageUrl = (document.getElementById('broadcastImageUrl')?.value || '').trim();
  const buttonText = (document.getElementById('broadcastButtonText')?.value || '').trim();
  const buttonUrl = (document.getElementById('broadcastButtonUrl')?.value || '').trim();
  const embedColor = (document.getElementById('broadcastEmbedColor')?.value || '#5865F2').trim();
  const delayMs = Number(document.getElementById('broadcastDelay')?.value || 1500);

  if (!message) {
    return showToast('يرجى كتابة نص الرسالة أولاً', 'error');
  }

  if (type === 'role' && !roleId) {
    return showToast('يرجى اختيار الرتبة المستهدفة', 'error');
  }

  if (buttonText && (!buttonUrl || !buttonUrl.startsWith('http'))) {
    return showToast('يرجى إدخال رابط صالح (يبدأ بـ https://) للزر التفاعلي', 'error');
  }

  const estimateText = document.getElementById('broadcastTargetEstimate')?.textContent || '';
  if (!confirm(`هل أنت متأكد من بدء إرسال البرودكاست في الخاص؟\n\nالفئة المستهدفة: ${type === 'all' ? 'جميع أعضاء السيرفر' : 'رتبة محددة'}\nالعدد المقدر: ${estimateText}\n\nسيتم الإرسال بتدرج زمني آمن لحماية البوت.`)) {
    return;
  }

  const btnStart = document.getElementById('btnStartBroadcast');
  const btnStop = document.getElementById('btnStopBroadcast');
  if (btnStart) btnStart.disabled = true;

  const res = await apiFetch('/api/broadcast/start', {
    method: 'POST',
    body: JSON.stringify({
      title,
      message,
      imageUrl,
      buttonText,
      buttonUrl,
      targetRoleId: roleId,
      embedColor,
      delayMs
    })
  });

  if (res.ok) {
    showToast(res.message || 'بدأ إرسال البرودكاست بنجاح!');
    if (btnStop) btnStop.disabled = false;
    await loadBroadcastStatus();
  } else {
    showToast(res.message || 'فشل بدء البرودكاست', 'error');
    if (btnStart) btnStart.disabled = false;
  }
}

async function stopBroadcastCampaign() {
  if (!confirm('هل تريد بالتأكيد إيقاف حملة البرودكاست الجارية حالياً؟')) return;

  const res = await apiFetch('/api/broadcast/stop', { method: 'POST' });
  if (res.ok) {
    showToast(res.message || 'تم إيقاف البرودكاست');
    await loadBroadcastStatus();
  } else {
    showToast(res.message || 'فشل إيقاف البرودكاست', 'error');
  }
}

async function loadBroadcastStatus() {
  const res = await apiFetch('/api/broadcast/status');
  if (res.ok) {
    renderBroadcastState(res.active, res.history || []);
  }
}

function renderBroadcastState(active, history) {
  if (!active) active = {};
  if (!Array.isArray(history)) history = [];

  const isRunning = Boolean(active.isRunning);
  const total = Number(active.total || 0);
  const sent = Number(active.sent || 0);
  const failed = Number(active.failed || 0);
  const processed = sent + failed;
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  // تحديث العدادات الإحصائية
  const statTotal = document.getElementById('bcastStatTotal');
  const statSent = document.getElementById('bcastStatSent');
  const statFailed = document.getElementById('bcastStatFailed');
  const statPercent = document.getElementById('bcastStatPercent');
  const progressText = document.getElementById('bcastProgressText');
  const progressBar = document.getElementById('bcastProgressBar');
  const currentMember = document.getElementById('bcastCurrentMember');
  const startTime = document.getElementById('bcastStartTime');
  const statusBadge = document.getElementById('broadcastStatusBadge');
  const btnStart = document.getElementById('btnStartBroadcast');
  const btnStop = document.getElementById('btnStopBroadcast');

  if (statTotal) statTotal.textContent = total.toLocaleString();
  if (statSent) statSent.textContent = sent.toLocaleString();
  if (statFailed) statFailed.textContent = failed.toLocaleString();
  if (statPercent) statPercent.textContent = `${percent}%`;
  if (progressText) progressText.textContent = `${processed.toLocaleString()} / ${total.toLocaleString()} عضو (${percent}%)`;
  if (progressBar) progressBar.style.width = `${percent}%`;

  if (currentMember) {
    currentMember.textContent = active.currentMember || (isRunning ? 'جاري التحضير...' : '-');
  }

  if (startTime) {
    if (active.startedAt) {
      const d = new Date(active.startedAt);
      startTime.textContent = d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } else {
      startTime.textContent = '-';
    }
  }

  if (statusBadge) {
    if (isRunning) {
      statusBadge.style.background = 'rgba(88, 101, 242, 0.2)';
      statusBadge.style.color = '#5865F2';
      statusBadge.style.border = '1px solid rgba(88, 101, 242, 0.4)';
      statusBadge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري إرسال البرودكاست في الخاص...';
    } else if (active.status === 'completed') {
      statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
      statusBadge.style.color = 'var(--accent-emerald)';
      statusBadge.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      statusBadge.innerHTML = '<i class="fa-solid fa-check"></i> اكتمل الإرسال بنجاح';
    } else if (active.status === 'stopped') {
      statusBadge.style.background = 'rgba(244, 63, 94, 0.15)';
      statusBadge.style.color = 'var(--accent-rose)';
      statusBadge.style.border = '1px solid rgba(244, 63, 94, 0.3)';
      statusBadge.innerHTML = '<i class="fa-solid fa-stop"></i> تم إيقاف الحملة';
    } else {
      statusBadge.style.background = 'rgba(255, 255, 255, 0.08)';
      statusBadge.style.color = 'var(--text-muted)';
      statusBadge.style.border = 'none';
      statusBadge.innerHTML = 'متوقف / لا توجد حملة نشطة';
    }
  }

  if (btnStart) btnStart.disabled = isRunning;
  if (btnStop) btnStop.disabled = !isRunning;

  // رسم جدول الحملات السابقة
  const tbody = document.getElementById('broadcastHistoryTable');
  if (tbody) {
    if (history.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">
            لا توجد حملات برودكاست مسجلة بعد.
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = history.map(h => {
        let statusBadgeHtml = '';
        if (h.status === 'running') {
          statusBadgeHtml = '<span class="badge" style="background: rgba(88,101,242,0.2); color: #5865F2;"><i class="fa-solid fa-spinner fa-spin"></i> جاري الإرسال</span>';
        } else if (h.status === 'completed') {
          statusBadgeHtml = '<span class="badge" style="background: rgba(16,185,129,0.15); color: var(--accent-emerald);">✅ مكتمل</span>';
        } else if (h.status === 'stopped') {
          statusBadgeHtml = '<span class="badge" style="background: rgba(244,63,94,0.15); color: var(--accent-rose);">⏹️ تم الإيقاف</span>';
        } else {
          statusBadgeHtml = `<span class="badge">${h.status}</span>`;
        }

        const msgSnippet = (h.title ? `<strong>${escapeHtml(h.title)}</strong><br/>` : '') +
          `<span style="color: var(--text-muted); font-size: 12px;">${escapeHtml((h.message || '').slice(0, 60))}${h.message?.length > 60 ? '...' : ''}</span>`;

        const targetDesc = h.target_role_id ? '🏷️ رتبة محددة' : '👥 جميع الأعضاء';

        return `
          <tr>
            <td>#${h.id}</td>
            <td>${msgSnippet}</td>
            <td>${targetDesc} (${Number(h.total_count || 0).toLocaleString()})</td>
            <td style="color: var(--accent-emerald); font-weight: 700;">${Number(h.sent_count || 0).toLocaleString()}</td>
            <td style="color: var(--accent-rose); font-weight: 700;">${Number(h.failed_count || 0).toLocaleString()}</td>
            <td>${escapeHtml(h.created_by || 'الإدارة')}</td>
            <td style="font-size: 12px; color: var(--text-muted);">${h.created_at || '-'}</td>
            <td>${statusBadgeHtml}</td>
          </tr>
        `;
      }).join('');
    }
  }
}
