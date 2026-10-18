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
      NEXTAUTH_SECRET: '0pGDBWqT4l_Q41ueiLPKIr48mMRMjADpjF7L7J2Y0QM',
      GOOGLE_CLIENT_ID: '863033812676-i4me8prfg5qr3ncpa832an8h3bk08pgk.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: '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',
      GATEWAY_API_KEY: 'gw_sk_7e0d741b994623a2331508f98f2b018d8ed78becbef731d7ae1c13e4d0baa5bc',
      GROQ_API_KEY: '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',
      GROQ_PDF_KEY: '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',
      GROQ_API_KEY_STT: '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',
      GROQ_API_KEY_PDF: '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',
      CF_API_TOKEN: 'cfut_bLNtQhqVmPfkc8jLKydN2QCm52Vw4MmA9cdefw3M5cceff97',
      CF_ACCOUNT_ID: '949a2a6e1039019782c46a8c7ddb19fe',
      CF_DATABASE_ID: '2e9133ea-dad7-4227-ac92-03c0fbe48c45',
    }
  }]
};