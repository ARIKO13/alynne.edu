// Upload merged dataset_master.json to VPS, replacing stt-dictionary.json.
// Backup existing first.
const { Client } = require('ssh2');
const fs = require('fs');
const privateKey = fs.readFileSync('/home/z/.ssh/vps_new_sshkey', 'utf8');

const LOCAL_FILE = '/home/z/alynne-clone/.deploy/dataset_master.json';
const REMOTE_FILE = '/root/lina-learning/data/stt-dictionary.json';
const BACKUP_FILE = `/root/lina-learning/data/stt-dictionary.json.bak.${Date.now()}`;

function run(c, cmd, timeout = 30000) {
  return new Promise((resolve) => {
    c.exec(cmd, { timeout }, (err, stream) => {
      if (err) return resolve({ out: '', stderr: err.message });
      let out = '';
      stream.on('data', d => out += d);
      stream.stderr.on('data', () => {});
      stream.on('close', () => resolve({ out: out.trim() }));
    });
  });
}

(async () => {
  const c = new Client();
  await new Promise((resolve, reject) => {
    c.on('ready', resolve).on('error', reject).connect({
      host: '176.100.37.238', port: 22, username: 'root',
      privateKey, readyTimeout: 20000,
    });
  });
  console.log('✓ Connected to VPS');

  const sftp = await new Promise((resolve, reject) => {
    c.sftp((err, s) => err ? reject(err) : resolve(s));
  });

  // [1] Backup existing
  console.log(`\n[1] Backing up existing file → ${BACKUP_FILE}`);
  const backupResult = await run(c, `cp ${REMOTE_FILE} ${BACKUP_FILE} && ls -lh ${BACKUP_FILE}`);
  console.log('  ' + backupResult.out);

  // [2] Upload new merged dataset
  console.log(`\n[2] Uploading merged dataset_master.json...`);
  const localSize = fs.statSync(LOCAL_FILE).size;
  console.log(`  Local size: ${(localSize / 1024 / 1024).toFixed(2)} MB`);
  await new Promise((resolve, reject) => {
    sftp.fastPut(LOCAL_FILE, REMOTE_FILE, (err) => err ? reject(err) : resolve());
  });
  console.log('  ✓ Uploaded');

  // [3] Verify upload + permissions
  console.log(`\n[3] Verifying upload...`);
  const verifyResult = await run(c, `ls -lh ${REMOTE_FILE} && python3 -c "import json; d=json.load(open('${REMOTE_FILE}')); print('Keys:', list(d.keys())); print('KBBI words:', len(d.get('k','').split('|'))); print('Fix entries:', len(d.get('fix',{}))); print('Phrase map:', len(d.get('phrase_map',{})))"`);
  console.log('  ' + verifyResult.out);

  // [4] Restart PM2 to reload dictionary
  console.log(`\n[4] Restarting PM2 lina-learning to reload dictionary...`);
  const restartResult = await run(c, `pm2 restart lina-learning --update-env 2>&1 | tail -3`);
  console.log('  ' + restartResult.out);

  // [5] Wait + verify PM2 log shows new stats
  console.log(`\n[5] Waiting 4s for reload...`);
  await new Promise(r => setTimeout(r, 4000));

  const logResult = await run(c, `pm2 logs lina-learning --lines 20 --nostream 2>&1 | grep -E "STT-Dict|Length index" | tail -5`);
  console.log('  PM2 STT-Dict log:');
  console.log('  ' + logResult.out.split('\n').join('\n  '));

  sftp.end();
  c.end();
  console.log('\n✓ DONE');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
