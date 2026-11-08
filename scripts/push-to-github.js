/**
 * سكريبت رفع المشروع بالكامل إلى حسابك في GitHub مباشرة عبر GitHub API
 * الاستخدام:
 *   node scripts/push-to-github.js <GITHUB_TOKEN> [REPO_NAME]
 */

const fs = require('node:fs');
const path = require('node:path');

const token = process.argv[2] || process.env.GITHUB_TOKEN;
const repoName = process.argv[3] || 'lab-store-dashboard';

if (!token) {
  console.error('❌ يرجى تمرير GitHub Personal Access Token.');
  process.exit(1);
}

const rootDir = path.join(__dirname, '..');
const ignoreList = new Set(['node_modules', '.env', 'data', '.git']);

function collectFiles(dir, prefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    if (ignoreList.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files = files.concat(collectFiles(fullPath, relPath));
    } else {
      files.push({ relPath, fullPath });
    }
  }
  return files;
}

async function ghFetch(url, options = {}) {
  const res = await fetch(`https://api.github.com${url}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function run() {
  console.log('🔄 جاري التحقق من حساب GitHub...');
  const userRes = await ghFetch('/user');
  if (!userRes.ok) {
    console.error('❌ توكن GitHub غير صالح:', userRes.data.message);
    process.exit(1);
  }
  const owner = userRes.data.login;
  console.log(`✅ تم الاتصال بحساب GitHub: ${owner}`);

  // إنشاء المستودع إن لم يكن موجوداً
  console.log(`🔄 جاري تجهيز المستودع: ${owner}/${repoName}...`);
  let repoRes = await ghFetch(`/repos/${owner}/${repoName}`);
  if (!repoRes.ok) {
    repoRes = await ghFetch('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: repoName,
        description: 'Lab Store - Discord Bot & Real-time Analytics Web Dashboard',
        private: false,
        auto_init: true
      })
    });
    if (!repoRes.ok) {
      console.error('❌ فشل إنشاء المستودع:', repoRes.data.message);
      process.exit(1);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  const allFiles = collectFiles(rootDir);
  console.log(`📦 جاري رفع ${allFiles.length} ملف إلى ${owner}/${repoName}...`);

  for (const file of allFiles) {
    const contentBase64 = fs.readFileSync(file.fullPath).toString('base64');
    const existing = await ghFetch(`/repos/${owner}/${repoName}/contents/${encodeURIComponent(file.relPath).replace(/%2F/g, '/')}`);
    const body = {
      message: `Update ${file.relPath}`,
      content: contentBase64
    };
    if (existing.ok && existing.data.sha) {
      body.sha = existing.data.sha;
    }
    const up = await ghFetch(`/repos/${owner}/${repoName}/contents/${encodeURIComponent(file.relPath).replace(/%2F/g, '/')}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
    if (up.ok) {
      console.log(`  ✔️ تم رفع: ${file.relPath}`);
    } else {
      console.warn(`  ⚠️ تعذر رفع ${file.relPath}: ${up.data.message}`);
    }
  }

  console.log('====================================================');
  console.log(`🎉 تم رفع المشروع بالكامل على GitHub بنجاح!`);
  console.log(`🔗 رابط المستودع: https://github.com/${owner}/${repoName}`);
  console.log('====================================================');
}

run();
