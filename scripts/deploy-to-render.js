/**
 * سكريبت إنشاء وتشغيل الخدمة تلقائياً على Render وربطها بمستودع GitHub
 * الاستخدام:
 *   node scripts/deploy-to-render.js <RENDER_API_KEY> <GITHUB_REPO_URL>
 */

const { getAllSettings } = require('../src/database/db');

const renderKey = process.argv[2] || process.env.RENDER_API_KEY;
const repoUrl = process.argv[3] || process.env.GITHUB_REPO_URL;

if (!renderKey || !repoUrl) {
  console.error('Usage: node scripts/deploy-to-render.js <RENDER_API_KEY> <GITHUB_REPO_URL>');
  process.exit(1);
}

async function renderFetch(endpoint, options = {}) {
  const res = await fetch(`https://api.render.com/v1${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${renderKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function run() {
  console.log('🔄 جاري التحقق من حساب Render...');
  const ownersRes = await renderFetch('/owners?limit=10');
  if (!ownersRes.ok || !Array.isArray(ownersRes.data) || ownersRes.data.length === 0) {
    console.error('❌ مفتاح Render API غير صالح أو لم يتم العثور على الحساب:', JSON.stringify(ownersRes.data));
    process.exit(1);
  }

  const ownerId = ownersRes.data[0].owner.id;
  console.log(`✅ تم الاتصال بحساب Render (Owner ID: ${ownerId})`);

  const settings = getAllSettings();
  const envVars = [
    { key: 'PORT', value: '3000' },
    { key: 'OWNER_DISCORD_ID', value: '790676969418522664' }
  ];
  if (settings.bot_token) envVars.push({ key: 'DISCORD_TOKEN', value: settings.bot_token });
  if (settings.guild_id) envVars.push({ key: 'GUILD_ID', value: settings.guild_id });
  if (settings.client_id) envVars.push({ key: 'CLIENT_ID', value: settings.client_id });

  console.log('🚀 جاري إنشاء خدمة الويب على Render وربطها بمستودع GitHub...');
  const createRes = await renderFetch('/services', {
    method: 'POST',
    body: JSON.stringify({
      type: 'web_service',
      name: 'lab-store-dashboard',
      ownerId,
      repo: repoUrl,
      autoDeploy: 'yes',
      branch: 'main',
      envVars,
      serviceDetails: {
        env: 'docker',
        plan: 'free',
        region: 'frankfurt'
      }
    })
  });

  if (!createRes.ok) {
    console.error('❌ تعذر إنشاء الخدمة على Render:', JSON.stringify(createRes.data));
    process.exit(1);
  }

  const url = createRes.data.service?.serviceDetails?.url || `https://${createRes.data.service?.slug}.onrender.com`;
  console.log('====================================================');
  console.log('🎉 تم إنشاء وتشغيل موقعك على Render بنجاح!');
  console.log(`🔗 الرابط المباشر لموقعك: ${url}`);
  console.log('====================================================');
}

run();
