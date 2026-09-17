// Download existing VPS dictionary file (192K KBBI + 520 slang + 72 fixes)
// so we can MERGE new data into it instead of replacing.
const { Client } = require('ssh2');
const fs = require('fs');
const privateKey = fs.readFileSync('/home/z/.ssh/vps_new_sshkey', 'utf8');

const c = new Client();
c.on('ready', async () => {
  console.log('✓ Connected to VPS');
  const sftp = await new Promise((resolve, reject) => {
    c.sftp((err, s) => err ? reject(err) : resolve(s));
  });

  console.log('Downloading /root/lina-learning/data/stt-dictionary.json...');
  await new Promise((resolve, reject) => {
    sftp.fastGet(
      '/root/lina-learning/data/stt-dictionary.json',
      '/home/z/alynne-clone/.deploy/vps-existing-dictionary.json',
      (err) => err ? reject(err) : resolve()
    );
  });

  const stats = fs.statSync('/home/z/alynne-clone/.deploy/vps-existing-dictionary.json');
  console.log(`✓ Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  sftp.end();
  c.end();
}).connect({
  host: '176.100.37.238', port: 22, username: 'root',
  privateKey, readyTimeout: 20000,
});
