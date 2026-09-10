const {Client} = require('ssh2');
const path = require('path');

const VPS = { host: '202.10.40.64', port: 22, username: 'root', password: '131006_Ar' };

const ECOSYSTEM = `module.exports = {
  apps: [{
    name: 'lina-learning',
    script: 'server/entry.mjs',
    cwd: '/root/lina-learning',
    env: {
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '3000',
      NEXTAUTH_URL: 'https://linalearning.my.id',
      NEXTAUTH_SECRET: '0pGDBWqT4l_Q41ueiLPKIr48mMRMjADpjF7L7J2Y0QM',
      GOOGLE_CLIENT_ID: '724864090566-14mvreiitnh74ehas7n0rh1uu39vl31b.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: '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',
      GATEWAY_API_KEY: 'gw_sk_5ea3ff72fb1b85af39aaaab8b5172fafe5dd574f519ac6f3f4b661d72ebd1d27',
      GROQ_API_KEY: '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',
      CF_API_TOKEN: 'cfut_bLNtQhqVmPfkc8jLKydN2QCm52Vw4MmA9cdefw3M5cceff97',
      CF_ACCOUNT_ID: '949a2a6e1039019782c46a8c7ddb19fe',
      CF_DATABASE_ID: '2e9133ea-dad7-4227-ac92-03c0fbe48c45',
    }
  }]
};`;

function runCmd(c, cmd, timeout = 60000) {
  return new Promise((resolve, reject) => {
    c.exec(cmd, { timeout }, (err, stream) => {
      if (err) return reject(err);
      let out = '', stderr = '';
      stream.on('data', d => out += d);
      stream.stderr.on('data', d => stderr += d);
      stream.on('close', (code) => resolve({ out: out.trim(), stderr: stderr.trim(), code }));
    });
  });
}

function writeFile(sftp, remote, content) {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remote, content, (err) => err ? reject(err) : resolve());
  });
}

(async () => {
  const c = new Client();
  await new Promise((resolve, reject) => {
    c.on('ready', resolve).on('error', reject).connect({ ...VPS, readyTimeout: 30000 });
  });
  console.log('SSH connected');

  const sftp = await new Promise((resolve, reject) => {
    c.sftp((err, s) => err ? reject(err) : resolve(s));
  });

  console.log('Writing ecosystem.config.cjs...');
  await writeFile(sftp, '/root/lina-learning/ecosystem.config.cjs', ECOSYSTEM);

  console.log('Restarting...');
  await runCmd(c, 'cd /root/lina-learning && pm2 delete lina-learning 2>/dev/null');
  await runCmd(c, 'cd /root/lina-learning && pm2 start ecosystem.config.cjs 2>&1');
  await new Promise(r => setTimeout(r, 3000));

  const status = await runCmd(c, 'pm2 list | grep lina');
  console.log(status.out.split('\n').pop());

  const httpCheck = await runCmd(c, 'curl -sI http://localhost:3000/ | head -1');
  console.log(httpCheck.out);

  sftp.end();
  c.end();
  console.log('DONE');
})().catch(e => { console.error(e); process.exit(1); });
