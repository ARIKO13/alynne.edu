-- Cloudflare D1 Database Schema
-- Tables: User, Subscription, DailyProgress, MonthlyRecap, YearlyRecord, MindMap, Certificate, _cf_KV

CREATE TABLE Certificate (id TEXT PRIMARY KEY, userId TEXT NOT NULL, season INTEGER NOT NULL, year TEXT NOT NULL, totalXP INTEGER NOT NULL, totalDays INTEGER NOT NULL, maxLevel INTEGER NOT NULL, maxStreak INTEGER NOT NULL, awardedAt TEXT NOT NULL DEFAULT (datetime('now')), expiresAt TEXT NOT NULL, shareCode TEXT NOT NULL UNIQUE, FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE)

CREATE TABLE DailyProgress (id TEXT PRIMARY KEY, userId TEXT NOT NULL, date TEXT NOT NULL, topic TEXT NOT NULL, score INTEGER NOT NULL, xpEarned INTEGER NOT NULL, questionsCount INTEGER NOT NULL, correctCount INTEGER NOT NULL, timeSpentSeconds INTEGER NOT NULL, createdAt TEXT NOT NULL DEFAULT (datetime('now')), CONSTRAINT uq_daily_user_date UNIQUE (userId, date), FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE)

CREATE TABLE MindMap (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  title TEXT NOT NULL,
  nodesJson TEXT NOT NULL,
  sourceText TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
)

CREATE TABLE MonthlyRecap (id TEXT PRIMARY KEY, userId TEXT NOT NULL, yearMonth TEXT NOT NULL, totalXP INTEGER NOT NULL DEFAULT 0, totalDays INTEGER NOT NULL DEFAULT 0, avgScore REAL NOT NULL DEFAULT 0, bestScore INTEGER NOT NULL DEFAULT 0, topicsCovered TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL DEFAULT (datetime('now')), CONSTRAINT uq_recap_user_month UNIQUE (userId, yearMonth), FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE)

CREATE TABLE Subscription (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'trial',
  trialStartsAt TEXT NOT NULL,
  trialEndsAt TEXT NOT NULL,
  paidAt TEXT,
  expiresAt TEXT,
  midtransOrderId TEXT,
  midtransTransactionId TEXT,
  amount INTEGER DEFAULT 55000,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
)

CREATE TABLE User (id TEXT PRIMARY KEY, googleId TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, image TEXT, xp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, streak INTEGER NOT NULL DEFAULT 0, lastActiveAt TEXT, currentSeason INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL DEFAULT (datetime('now')), updatedAt TEXT NOT NULL DEFAULT (datetime('now')))

CREATE TABLE YearlyRecord (id TEXT PRIMARY KEY, userId TEXT NOT NULL, year TEXT NOT NULL, season INTEGER NOT NULL, totalXP INTEGER NOT NULL DEFAULT 0, totalDays INTEGER NOT NULL DEFAULT 0, avgScore REAL NOT NULL DEFAULT 0, maxLevel INTEGER NOT NULL DEFAULT 0, maxStreak INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL DEFAULT (datetime('now')), CONSTRAINT uq_yearly_user_year_season UNIQUE (userId, year, season), FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE)

CREATE TABLE _cf_KV (
        key TEXT PRIMARY KEY,
        value BLOB
      ) WITHOUT ROWID