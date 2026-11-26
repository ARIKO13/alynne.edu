const {Client} = require('ssh2');
const c = new Client();

const VPS = { host: '202.10.40.64', port: 22, username: 'root', password: 'REDACTED-DI-VPS' };

function runCmd(cli, cmd, timeout = 30000) {
  return new Promise((resolve, reject) => {
    cli.exec(cmd, { timeout }, (err, stream) => {
      if (err) return reject(err);
      let out = '', stderr = '';
      stream.on('data', d => out += d);
      stream.stderr.on('data', d => stderr += d);
      stream.on('close', () => resolve({ out: out.trim(), stderr: stderr.trim() }));
    });
  });
}

(async () => {
  await new Promise((resolve, reject) => {
    c.on('ready', resolve).on('error', reject).connect(VPS);
  });
  console.log('Connected');

  // Kill any existing
  await runCmd(c, 'pm2 delete lina-learning 2>/dev/null; pkill -f "entry.mjs" 2>/dev/null');
  console.log('Cleaned old processes');

  // Create ecosystem config for pm2 with env vars
  const ecosystem = `
module.exports = {
  apps: [{
    name: 'lina-learning',
    script: 'server/entry.mjs',
    cwd: '/root/lina-learning',
    env: {
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '3000',
      NEXTAUTH_URL: 'https://linalearning.my.id',
      NEXTAUTH_SECRET: 'REDACTED-ROTASI-DI-VPS',
      GOOGLE_CLIENT_ID: '724864090566-m1fo9v2rgtf06q6ktg6qpfiddouhsojm.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'GOCSPX-REDACTED-ISI-DI-VPS',
      GATEWAY_API_KEY: 'gw_sk_REDACTED-ISI-DI-VPS',
      GROQ_API_KEY: 'gsk_REDACTED-ISI-DI-VPS',
      CF_API_TOKEN: 'cfut_REDACTED-ISI-DI-VPS',
      CF_ACCOUNT_ID: '949a2a6e1039019782c46a8c7ddb19fe',
      CF_DATABASE_ID: '2e9133ea-dad7-4227-ac92-03c0fbe48c45',
    }
  }]
};
`;

  const sftp = await new Promise((resolve, reject) => {
    c.sftp((err, s) => err ? reject(err) : resolve(s));
  });

  await new Promise((resolve, reject) => {
    sftp.writeFile('/root/lina-learning/ecosystem.config.cjs', ecosystem, (err) => err ? reject(err) : resolve());
  });
  console.log('Wrote ecosystem.config.cjs');

  // Start with ecosystem config
  const startResult = await runCmd(c, 'cd /root/lina-learning && pm2 start ecosystem.config.cjs 2>&1');
  console.log(startResult.out);

  // Wait for server to start
  await new Promise(r => setTimeout(r, 5000));

  // Check port
  const portCheck = await runCmd(c, 'ss -tlnp | grep 3000');
  console.log('Port check:', portCheck.out || 'NOT LISTENING');

  // Check logs
  const logs = await runCmd(c, 'pm2 logs lina-learning --lines 20 --nostream 2>&1');
  console.log('Logs:', logs.out.slice(-500));

  // Test request
  const testReq = await runCmd(c, 'curl -sI http://localhost:3000/ 2>&1 | head -5');
  console.log('HTTP:', testReq.out);

  // Save pm2
  await runCmd(c, 'pm2 save');
  console.log('pm2 saved');

  sftp.end();
  c.end();
  console.log('DONE');
})().catch(e => { console.error(e); process.exit(1); });
