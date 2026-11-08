const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const token = process.argv[2] || process.env.GITHUB_TOKEN;
const repoOwner = 'faresnalghazl';
const repoName = 'lab-store-dashboard';
const commitMessage = process.argv[3] || 'Add product staff roles & restrict ticket controls to staff only';

const rootDir = path.join(__dirname, '..');
const ignoreList = new Set(['node_modules', '.env', 'data', '.git', '.gemini']);

function gitBlobSha(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`);
  return crypto.createHash('sha1').update(Buffer.concat([header, buffer])).digest('hex');
}

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
      files.push({ relPath: relPath.replace(/\\/g, '/'), fullPath });
    }
  }
  return files;
}

async function gh(endpoint, options = {}) {
  const url = `https://api.github.com/repos/${repoOwner}/${repoName}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'NodeScript',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status} on ${endpoint}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function run() {
  console.log('🔍 Getting latest commit on main...');
  const refData = await gh('/git/ref/heads/main');
  const latestCommitSha = refData.object.sha;
  console.log('📌 Current commit:', latestCommitSha);

  const commitData = await gh(`/git/commits/${latestCommitSha}`);
  const baseTreeSha = commitData.tree.sha;

  console.log('🌲 Fetching remote tree...');
  const remoteTreeData = await gh(`/git/trees/${baseTreeSha}?recursive=1`);
  const remoteMap = new Map();
  for (const item of (remoteTreeData.tree || [])) {
    if (item.type === 'blob') {
      remoteMap.set(item.path, item.sha);
    }
  }

  const localFiles = collectFiles(rootDir);
  const changedFiles = [];

  for (const file of localFiles) {
    const buf = fs.readFileSync(file.fullPath);
    const localSha = gitBlobSha(buf);
    const remoteSha = remoteMap.get(file.relPath);
    if (localSha !== remoteSha) {
      changedFiles.push({ ...file, buf, localSha });
    }
  }

  if (changedFiles.length === 0) {
    console.log('✨ No changed files found. Everything is up-to-date!');
    return;
  }

  console.log(`🚀 Found ${changedFiles.length} changed file(s):`);
  changedFiles.forEach(f => console.log('   - ' + f.relPath));

  const treeEntries = [];
  for (const file of changedFiles) {
    console.log(`📤 Uploading blob for ${file.relPath}...`);
    const blobData = await gh('/git/blobs', {
      method: 'POST',
      body: JSON.stringify({
        content: file.buf.toString('base64'),
        encoding: 'base64'
      })
    });
    treeEntries.push({
      path: file.relPath,
      mode: '100644',
      type: 'blob',
      sha: blobData.sha
    });
  }

  console.log('🌳 Creating new tree...');
  const newTreeData = await gh('/git/trees', {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries
    })
  });

  console.log('📝 Creating commit...');
  const newCommit = await gh('/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: commitMessage,
      tree: newTreeData.sha,
      parents: [latestCommitSha]
    })
  });
  console.log('✅ New commit created:', newCommit.sha);

  console.log('🔄 Updating ref heads/main...');
  await gh('/git/refs/heads/main', {
    method: 'PATCH',
    body: JSON.stringify({
      sha: newCommit.sha,
      force: false
    })
  });

  console.log('🎉 Successfully pushed changes to GitHub main branch!');
}

run().catch(err => {
  console.error('❌ Error during push:', err.message);
  process.exit(1);
});
