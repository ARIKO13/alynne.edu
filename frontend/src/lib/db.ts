/**
 * Database layer - Cloudflare D1 via HTTP API
 * 
 * Replaces Prisma. Every function maps 1:1 to the Prisma calls
 * used in the original API routes.
 */

import { d1 } from './d1-client';

// ─── Types ───────────────────────────────────────────────

export interface User {
  uid: string;
  username: string;
  gmail: string;
  activeSubscription: string;
  packetSubscription: string;
  createdAt: string;
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
    async findUnique(where: { where: { uid?: string; gmail?: string; googleId?: string } }) {
      const w = where.where;
      if (w.uid || w.googleId) {
        const id = w.uid || w.googleId;
        const rows = await d1.query<User>('SELECT uid, username, gmail, activeSubscription, packetSubscription, createdAt FROM User WHERE uid = ?', [id]);
        return rows[0] ?? null;
      }
      if (w.gmail) {
        const rows = await d1.query<User>('SELECT uid, username, gmail, activeSubscription, packetSubscription, createdAt FROM User WHERE gmail = ?', [w.gmail]);
        return rows[0] ?? null;
      }
      return null;
    },

    async create(data: {
      data: { uid: string; googleId?: string; email?: string; gmail?: string; name?: string; username?: string; image?: string | null };
    }) {
      const d = data.data;
      const now = new Date().toISOString();
      const uid = d.uid || d.googleId || '';
      const gmail = d.gmail || d.email || '';
      const username = d.username || d.name || 'Player';
      await d1.execute(
        `INSERT INTO User (uid, username, gmail, activeSubscription, packetSubscription, createdAt)
         VALUES (?, ?, ?, 'trial', 'none', ?)`,
        [uid, username, gmail, now]
      );
      return d1.query<User>('SELECT uid, username, gmail, activeSubscription, packetSubscription, createdAt FROM User WHERE uid = ?', [uid]).then(r => r[0]);
    },

    async upsert(args: {
      where: { id: string };
      update: Partial<User>;
      create: { uid?: string; googleId?: string; email?: string; gmail?: string; name?: string; username?: string; image?: string | null };
    }) {
      const uid = args.where.id;
      const existing = await d1.query<User>('SELECT uid FROM User WHERE uid = ?', [uid]);
      const now = new Date().toISOString();
      if (existing.length > 0) {
        // Update - only fields that exist in new schema
        const u = args.update as any;
        if (u.name || u.username) {
          await d1.execute('UPDATE User SET username = ? WHERE uid = ?', [u.username || u.name, uid]);
        }
        if (u.image !== undefined) {
          // image not in new schema, skip
        }
      } else {
        const c = args.create;
        const gmail = c.gmail || c.email || '';
        const username = c.username || c.name || 'Player';
        await d1.execute(
          `INSERT INTO User (uid, username, gmail, activeSubscription, packetSubscription, createdAt)
           VALUES (?, ?, ?, 'trial', 'none', ?)`,
          [uid, username, gmail, now]
        );
      }
      return d1.query<User>('SELECT uid, username, gmail, activeSubscription, packetSubscription, createdAt FROM User WHERE uid = ?', [uid]).then(r => r[0]);
    },

    async update(args: {
      where: { id: string };
      data: Partial<User>;
    }) {
      const u = args.data as any;
      const fields: string[] = [];
      const values: unknown[] = [];
      if (u.username !== undefined) { fields.push('username = ?'); values.push(u.username); }
      if (u.gmail !== undefined) { fields.push('gmail = ?'); values.push(u.gmail); }
      if (u.activeSubscription !== undefined) { fields.push('activeSubscription = ?'); values.push(u.activeSubscription); }
      if (u.packetSubscription !== undefined) { fields.push('packetSubscription = ?'); values.push(u.packetSubscription); }
      if (fields.length > 0) {
        await d1.execute(`UPDATE User SET ${fields.join(', ')} WHERE uid = ?`, [...values, args.where.id]);
      }
      return d1.query<User>('SELECT uid, username, gmail, activeSubscription, packetSubscription, createdAt FROM User WHERE uid = ?', [args.where.id]).then(r => r[0]);
    },
  },

  // --- DailyProgress (DEPRECATED - table dropped) ---
  dailyProgress: {
    async findUnique() { return null; },
    async findMany() { return []; },
    async upsert() { return null; },
    async count() { return 0; },
    async deleteMany() { return { count: 0 }; },
    async findDistinctUserIds() { return []; },
  },

  // --- MonthlyRecap (DEPRECATED) ---
  monthlyRecap: {
    async findMany() { return []; },
    async upsert() { return null; },
  },

  // --- YearlyRecord (DEPRECATED) ---
  yearlyRecord: {
    async findFirst() { return null; },
    async update() { return null; },
    async findMany() { return []; },
  },

  // --- Certificate (DEPRECATED) ---
  certificate: {
    async findUnique() { return null; },
    async findFirst() { return null; },
    async findFirst2() { return null; },
    async findMany() { return []; },
    async create() { return null; },
    async delete() {},
  },

  // --- HIDDEN (old implementations, not used) ---
};
