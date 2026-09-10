/**
 * Database layer — Cloudflare D1 via HTTP API
 * 
 * Replaces Prisma. Every function maps 1:1 to the Prisma calls
 * used in the original API routes.
 */

import { d1 } from './d1-client';

// ─── Types ───────────────────────────────────────────────

export interface User {
  id: string;
  googleId: string;
  email: string;
  name: string;
  image: string | null;
  xp: number;
  level: number;
  streak: number;
  lastActiveAt: string | null;
  currentSeason: number;
  createdAt: string;
  updatedAt: string;
}

export interface DailyProgress {
  id: string;
  userId: string;
  date: string;
  topic: string;
  score: number;
  xpEarned: number;
  questionsCount: number;
  correctCount: number;
  timeSpentSeconds: number;
  createdAt: string;
}

export interface MonthlyRecap {
  id: string;
  userId: string;
  yearMonth: string;
  totalXP: number;
  totalDays: number;
  avgScore: number;
  bestScore: number;
  topicsCovered: string;
  level: number;
  createdAt: string;
}

export interface YearlyRecord {
  id: string;
  userId: string;
  year: string;
  season: number;
  totalXP: number;
  totalDays: number;
  avgScore: number;
  maxLevel: number;
  maxStreak: number;
  completed: number; // SQLite boolean (0/1)
  createdAt: string;
}

export interface Certificate {
  id: string;
  userId: string;
  season: number;
  year: string;
  totalXP: number;
  totalDays: number;
  maxLevel: number;
  maxStreak: number;
  awardedAt: string;
  expiresAt: string;
  shareCode: string;
}

// ─── User ─────────────────────────────────────────────────

export const db = {
  // --- User ---
  user: {
    async findUnique(where: { where: { id?: string; email?: string; googleId?: string } }) {
      const w = where.where;
      if (w.id) {
        const rows = await d1.query<User>('SELECT * FROM User WHERE id = ?', [w.id]);
        return rows[0] ?? null;
      }
      if (w.email) {
        const rows = await d1.query<User>('SELECT * FROM User WHERE email = ?', [w.email]);
        return rows[0] ?? null;
      }
      if (w.googleId) {
        const rows = await d1.query<User>('SELECT * FROM User WHERE googleId = ?', [w.googleId]);
        return rows[0] ?? null;
      }
      return null;
    },

    async create(data: {
      data: Partial<Omit<User, 'createdAt' | 'updatedAt'>> & { id: string; googleId: string; email: string; name: string };
    }) {
      const d = data.data;
      const now = new Date().toISOString();
      await d1.execute(
        `INSERT INTO User (id, googleId, email, name, image, xp, level, streak, lastActiveAt, currentSeason, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.id, d.googleId, d.email, d.name, d.image ?? null, d.xp ?? 0, d.level ?? 1, d.streak ?? 0, d.lastActiveAt ?? null, d.currentSeason ?? 1, now, now]
      );
      return d1.query<User>('SELECT * FROM User WHERE id = ?', [d.id]).then(r => r[0]);
    },

    async upsert(args: {
      where: { id: string };
      update: Partial<Omit<User, 'id' | 'createdAt'>>;
      create: Partial<Omit<User, 'createdAt' | 'updatedAt'>> & { id: string; googleId: string; email: string; name: string };
    }) {
      const existing = await d1.query<User>('SELECT id FROM User WHERE id = ?', [args.where.id]);
      const now = new Date().toISOString();
      if (existing.length > 0) {
        const u = args.update;
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [key, val] of Object.entries(u)) {
          if (val !== undefined) {
            fields.push(`${key} = ?`);
            values.push(val);
          }
        }
        fields.push('updatedAt = ?');
        values.push(now);
        if (fields.length > 1) {
          await d1.execute(`UPDATE User SET ${fields.join(', ')} WHERE id = ?`, [...values, args.where.id]);
        }
      } else {
        const c = args.create;
        await d1.execute(
          `INSERT INTO User (id, googleId, email, name, image, xp, level, streak, lastActiveAt, currentSeason, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [c.id, c.googleId, c.email, c.name, c.image ?? null, c.xp ?? 0, c.level ?? 1, c.streak ?? 0, c.lastActiveAt ?? null, c.currentSeason ?? 1, now, now]
        );
      }
      return d1.query<User>('SELECT * FROM User WHERE id = ?', [args.where.id]).then(r => r[0]);
    },

    async update(args: {
      where: { id: string };
      data: Partial<Omit<User, 'id' | 'createdAt'>>;
    }) {
      const u = args.data;
      const fields: string[] = [];
      const values: unknown[] = [];
      for (const [key, val] of Object.entries(u)) {
        if (val !== undefined) {
          fields.push(`${key} = ?`);
          values.push(val);
        }
      }
      fields.push('updatedAt = ?');
      values.push(new Date().toISOString());
      await d1.execute(`UPDATE User SET ${fields.join(', ')} WHERE id = ?`, [...values, args.where.id]);
      return d1.query<User>('SELECT * FROM User WHERE id = ?', [args.where.id]).then(r => r[0]);
    },
  },

  // --- DailyProgress ---
  dailyProgress: {
    async findUnique(where: { where: { userId_date: { userId: string; date: string } } }) {
      const { userId, date } = where.where.userId_date;
      const rows = await d1.query<DailyProgress>(
        'SELECT * FROM DailyProgress WHERE userId = ? AND date = ?', [userId, date]
      );
      return rows[0] ?? null;
    },

    async findMany(args: { where: { userId?: string; date?: { startsWith: string } } }) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (args.where.userId) {
        conditions.push('userId = ?');
        params.push(args.where.userId);
      }
      if (args.where.date?.startsWith) {
        conditions.push('date LIKE ?');
        params.push(args.where.date.startsWith + '%');
      }
      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      return d1.query<DailyProgress>(`SELECT * FROM DailyProgress ${where}`, params);
    },

    async upsert(args: {
      where: { userId_date: { userId: string; date: string } };
      update: Partial<Omit<DailyProgress, 'id' | 'userId' | 'date' | 'createdAt'>>;
      create: Omit<DailyProgress, 'id' | 'createdAt'>;
    }) {
      const { userId, date } = args.where.userId_date;
      const existing = await d1.query<DailyProgress>(
        'SELECT id FROM DailyProgress WHERE userId = ? AND date = ?', [userId, date]
      );
      if (existing.length > 0) {
        const u = args.update;
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [key, val] of Object.entries(u)) {
          if (val !== undefined) { fields.push(`${key} = ?`); values.push(val); }
        }
        if (fields.length > 0) {
          await d1.execute(`UPDATE DailyProgress SET ${fields.join(', ')} WHERE userId = ? AND date = ?`, [...values, userId, date]);
        }
      } else {
        const c = args.create;
        await d1.execute(
          `INSERT INTO DailyProgress (id, userId, date, topic, score, xpEarned, questionsCount, correctCount, timeSpentSeconds, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), c.userId, c.date, c.topic, c.score, c.xpEarned, c.questionsCount, c.correctCount, c.timeSpentSeconds, new Date().toISOString()]
        );
      }
      return d1.query<DailyProgress>(
        'SELECT * FROM DailyProgress WHERE userId = ? AND date = ?', [userId, date]
      ).then(r => r[0]);
    },

    async count(args: { where: { userId?: string; date?: { startsWith: string } } }) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (args.where.userId) {
        conditions.push('userId = ?');
        params.push(args.where.userId);
      }
      if (args.where.date?.startsWith) {
        conditions.push('date LIKE ?');
        params.push(args.where.date.startsWith + '%');
      }
      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      const result = await d1.query<{ count: number }>(`SELECT COUNT(*) as count FROM DailyProgress ${where}`, params);
      return result[0]?.count ?? 0;
    },

    async deleteMany(args: { where: { userId?: string; date?: { startsWith: string } } }) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (args.where.userId) {
        conditions.push('userId = ?');
        params.push(args.where.userId);
      }
      if (args.where.date?.startsWith) {
        conditions.push('date LIKE ?');
        params.push(args.where.date.startsWith + '%');
      }
      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      const result = await d1.execute(`DELETE FROM DailyProgress ${where}`, params);
      return { count: result.changes };
    },

    /** Custom: find distinct userIds matching a date prefix */
    async findDistinctUserIds(datePrefix: string) {
      const rows = await d1.query<{ userId: string }>(
        'SELECT DISTINCT userId FROM DailyProgress WHERE date LIKE ?', [datePrefix + '%']
      );
      return rows.map(r => r.userId);
    },
  },

  // --- MonthlyRecap ---
  monthlyRecap: {
    async findMany(args: { where: { userId: string }; orderBy?: { yearMonth: string }; take?: number }) {
      const order = args.orderBy?.yearMonth === 'desc' ? 'DESC' : 'ASC';
      const limit = args.take || 100;
      return d1.query<MonthlyRecap>(
        `SELECT * FROM MonthlyRecap WHERE userId = ? ORDER BY yearMonth ${order} LIMIT ?`,
        [args.where.userId, limit]
      );
    },

    async upsert(args: {
      where: { userId_yearMonth: { userId: string; yearMonth: string } };
      update: Partial<Omit<MonthlyRecap, 'id' | 'userId' | 'yearMonth' | 'createdAt'>>;
      create: Omit<MonthlyRecap, 'id' | 'createdAt'>;
    }) {
      const { userId, yearMonth } = args.where.userId_yearMonth;
      const existing = await d1.query<MonthlyRecap>(
        'SELECT id FROM MonthlyRecap WHERE userId = ? AND yearMonth = ?', [userId, yearMonth]
      );
      if (existing.length > 0) {
        const u = args.update;
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [key, val] of Object.entries(u)) {
          if (val !== undefined) { fields.push(`${key} = ?`); values.push(val); }
        }
        if (fields.length > 0) {
          await d1.execute(`UPDATE MonthlyRecap SET ${fields.join(', ')} WHERE userId = ? AND yearMonth = ?`, [...values, userId, yearMonth]);
        }
      } else {
        const c = args.create;
        await d1.execute(
          `INSERT INTO MonthlyRecap (id, userId, yearMonth, totalXP, totalDays, avgScore, bestScore, topicsCovered, level, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), c.userId, c.yearMonth, c.totalXP, c.totalDays, c.avgScore, c.bestScore, c.topicsCovered, c.level, new Date().toISOString()]
        );
      }
      return d1.query<MonthlyRecap>(
        'SELECT * FROM MonthlyRecap WHERE userId = ? AND yearMonth = ?', [userId, yearMonth]
      ).then(r => r[0]);
    },
  },

  // --- YearlyRecord ---
  yearlyRecord: {
    async findFirst(args: { where: { userId: string; year: string } }) {
      const rows = await d1.query<YearlyRecord>(
        'SELECT * FROM YearlyRecord WHERE userId = ? AND year = ? LIMIT 1',
        [args.where.userId, args.where.year]
      );
      return rows[0] ?? null;
    },

    async update(args: {
      where: { id: string };
      data: Partial<Omit<YearlyRecord, 'id' | 'userId' | 'createdAt'>>;
    }) {
      const u = args.data;
      const fields: string[] = [];
      const values: unknown[] = [];
      for (const [key, val] of Object.entries(u)) {
        if (val !== undefined) { fields.push(`${key} = ?`); values.push(val); }
      }
      if (fields.length > 0) {
        await d1.execute(`UPDATE YearlyRecord SET ${fields.join(', ')} WHERE id = ?`, [...values, args.where.id]);
      }
      return d1.query<YearlyRecord>('SELECT * FROM YearlyRecord WHERE id = ?', [args.where.id]).then(r => r[0]);
    },

    async findMany(args: { where: { completed?: boolean } }) {
      if (args.where.completed !== undefined) {
        return d1.query<YearlyRecord>(
          'SELECT * FROM YearlyRecord WHERE completed = ?', [args.where.completed ? 1 : 0]
        );
      }
      return d1.query<YearlyRecord>('SELECT * FROM YearlyRecord');
    },
  },

  // --- Certificate ---
  certificate: {
    async findUnique(where: { where: { shareCode: string } }) {
      const rows = await d1.query<Certificate>(
        'SELECT * FROM Certificate WHERE shareCode = ?', [where.where.shareCode]
      );
      return rows[0] ?? null;
    },

    async findFirst(args: { where: { userId: string; expiresAt: { gt: Date } }; orderBy?: { awardedAt: string } }) {
      const order = args.orderBy?.awardedAt === 'desc' ? 'DESC' : 'ASC';
      const rows = await d1.query<Certificate>(
        `SELECT * FROM Certificate WHERE userId = ? AND expiresAt > ? ORDER BY awardedAt ${order} LIMIT 1`,
        [args.where.userId, args.where.expiresAt.gt.toISOString()]
      );
      return rows[0] ?? null;
    },

    async findFirst2(args: { where: { userId: string; season: number; year: string } }) {
      const rows = await d1.query<Certificate>(
        'SELECT * FROM Certificate WHERE userId = ? AND season = ? AND year = ? LIMIT 1',
        [args.where.userId, args.where.season, args.where.year]
      );
      return rows[0] ?? null;
    },

    async findMany(args: { where: { expiresAt: { lt: Date } } }) {
      return d1.query<Certificate>(
        'SELECT * FROM Certificate WHERE expiresAt < ?',
        [args.where.expiresAt.lt.toISOString()]
      );
    },

    async create(data: { data: { userId: string; season: number; year: string; totalXP: number; totalDays: number; maxLevel: number; maxStreak: number; awardedAt: Date | string; expiresAt: Date | string; shareCode: string } }) {
      const c = data.data;
      const id = crypto.randomUUID();
      const toISO = (v: Date | string) => (typeof v === 'string' ? v : v.toISOString());
      await d1.execute(
        `INSERT INTO Certificate (id, userId, season, year, totalXP, totalDays, maxLevel, maxStreak, awardedAt, expiresAt, shareCode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, c.userId, c.season, c.year, c.totalXP, c.totalDays, c.maxLevel, c.maxStreak, toISO(c.awardedAt), toISO(c.expiresAt), c.shareCode]
      );
      return d1.query<Certificate>('SELECT * FROM Certificate WHERE id = ?', [id]).then(r => r[0]);
    },

    async delete(where: { where: { id: string } }) {
      await d1.execute('DELETE FROM Certificate WHERE id = ?', [where.where.id]);
    },
  },
};
