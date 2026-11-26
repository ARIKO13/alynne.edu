module.exports = {
  apps: [{
    name: 'lina-learning',
    script: 'dist/server/entry.mjs',
    cwd: '/root/lina-learning',
    env: {
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '3000',
      NEXTAUTH_URL: 'https://alynne.my.id',
      NEXTAUTH_SECRET: 'REDACTED-ROTASI-DI-VPS',
      GOOGLE_CLIENT_ID: '863033812676-i4me8prfg5qr3ncpa832an8h3bk08pgk.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'GOCSPX-REDACTED-ISI-DI-VPS',
      POLYVOR_URL: 'https://gateway.polyvorlabs.com/v1',
      POLYVOR_API_KEY: 'gw_sk_REDACTED-ISI-DI-VPS',
      POLYVOR_MODEL: 'phala/z-ai/glm-5.3-flash',
      POLYVOR_FALLBACK_MODEL: 'phala/deepseek/deepseek-v4-flash-0731',
      PI_BANSOS_URL: 'http://127.0.0.1:18080/v1',
      GATEWAY_API_KEY: 'gw_sk_REDACTED-ISI-DI-VPS',
      GROQ_API_KEY: 'gsk_REDACTED-ISI-DI-VPS',
      GROQ_PDF_KEY: 'gsk_REDACTED-ISI-DI-VPS',
      GROQ_API_KEY_STT: 'gsk_REDACTED-ISI-DI-VPS',
      GROQ_API_KEY_PDF: 'gsk_REDACTED-ISI-DI-VPS',
      CF_API_TOKEN: 'cfut_REDACTED-ISI-DI-VPS',
      CF_ACCOUNT_ID: '949a2a6e1039019782c46a8c7ddb19fe',
      CF_DATABASE_ID: '2e9133ea-dad7-4227-ac92-03c0fbe48c45',
      // DB utama: Turso (libSQL) — dipakai lib/d1-client.ts (client HTTP v2)
      TURSO_DATABASE_URL: 'libsql://alynne-edu-arushiko.aws-ap-southeast-1.turso.io',
      TURSO_AUTH_TOKEN: 'REDACTED-ISI-DI-VPS',
    }
  }]
};
