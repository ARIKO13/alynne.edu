module.exports = {
  apps: [{
    name: 'lina-learning',
    script: 'server/entry.mjs',
    cwd: '/root/lina-learning',
    env: {
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '3000',
      NEXTAUTH_URL: 'https://alynne.my.id',
      NEXTAUTH_SECRET: 'REDACTED-ROTASI-DI-VPS',
      GOOGLE_CLIENT_ID: '35021337025-obk8ku396lm277b8psehiq5l9ees1hcg.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'GOCSPX-REDACTED-ISI-DI-VPS',
      GATEWAY_API_KEY: 'gw_sk_REDACTED-ISI-DI-VPS',
      GROQ_API_KEY: 'gsk_REDACTED-ISI-DI-VPS',
      GROQ_PDF_KEY: 'gsk_REDACTED-ISI-DI-VPS',
      GROQ_API_KEY_STT: 'gsk_REDACTED-ISI-DI-VPS',
      GROQ_API_KEY_PDF: 'gsk_REDACTED-ISI-DI-VPS',
      CF_API_TOKEN: 'cfut_REDACTED-ISI-DI-VPS',
      CF_ACCOUNT_ID: '949a2a6e1039019782c46a8c7ddb19fe',
      CF_DATABASE_ID: '2e9133ea-dad7-4227-ac92-03c0fbe48c45',
    }
  }]
};