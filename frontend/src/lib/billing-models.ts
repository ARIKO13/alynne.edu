/**
 * Billing models + payment methods for the ALYNNE.AI billing page.
 *
 * Two-stage selection:
 *   1. User picks an AI MODEL (e.g., ALYNNE.EDU) - only ALYNNE.EDU is
 *      available for now, but the structure supports adding more later.
 *   2. User picks a TIER (Lite/Plus/Pro/Ultra) within that model -
 *      each tier has its own price + features.
 *
 * Pricing tiers for ALYNNE.EDU start at Rp 50.000 and include a
 * Rp 100.000 tier (per user request, 2026-09-13).
 */

export interface AIModel {
  id: string;
  /** Display name (kept identical to brand convention: ALYNNE.<KIND>) */
  name: string;
  tagline: string;
  description: string;
  /** Lucide-style emoji badge shown in the model picker */
  badge: string;
  /** Tailwind accent color name */
  accent: 'emerald' | 'violet' | 'amber' | 'rose' | 'sky';
  /** Whether this is the default-selected model in the picker */
  default?: boolean;
  /** Mark "coming soon" models - disables the card */
  comingSoon?: boolean;
}

/**
 * The list of AI models the user can subscribe to.
 *
 * ALYNNE.EDU is the only one available today. Future models
 * (ALYNNE.PRO, ALYNNE.VOICE, ALYNNE.LAB, etc.) can be appended
 * here without touching any component code.
 */
export const AI_MODELS: AIModel[] = [
  {
    id: 'alynne-edu',
    name: 'ALYNNE.EDU',
    tagline: 'Belajar Cerdas, Raih Sertifikat',
    description:
      'Asisten AI edukasi untuk pelajar, mahasiswa, guru, dan institusi. ' +
      'Speech-to-Text, Modul PDF, Mind Map, AI Assistant, semua dalam satu.',
    badge: 'EDU',
    accent: 'violet',
    default: true,
  },
  // Reserved for future - uncomment when ready
  // {
  //   id: 'alynne-pro',
  //   name: 'ALYNNE.PRO',
  //   tagline: 'Untuk Profesional',
  //   description: 'Asisten AI untuk produktivitas kerja, rapat, dan analisis dokumen.',
  //   badge: '💼',
  //   accent: 'amber',
  //   comingSoon: true,
  // },
];

export interface BillingTier {
  id: string;
  /** Links this tier to its parent AIModel.id */
  modelId: string;
  /** Tier suffix shown after the model name (e.g., "ALYNNE.EDU Lite") */
  name: string;
  tagline: string;
  /** Price in IDR for one billing cycle */
  price: number;
  /** Days of access granted per cycle */
  durationDays: number;
  /** Tailwind accent color name (used by BillingFlow component) */
  accent: 'emerald' | 'violet' | 'amber' | 'rose';
  /** Whether this is the recommended/most-popular tier */
  popular?: boolean;
  features: string[];
}

/**
 * Tiers for the ALYNNE.EDU model.
 *
 * Prices (per user request, 2026-09-13):
 *   - Lite   : Rp  50.000  (starting price)
 *   - Plus   : Rp 100.000  (the mentioned 100k tier - also the popular one)
 *   - Pro    : Rp 200.000
 *   - Ultra  : Rp 350.000
 */
export const BILLING_TIERS: BillingTier[] = [
  {
    id: 'alynne-edu-lite',
    modelId: 'alynne-edu',
    name: 'ALYNNE.EDU Lite',
    tagline: 'Pemula yang baru mengenal AI edukasi',
    price: 50000,
    durationDays: 30,
    accent: 'emerald',
    features: [
      '50 percakapan AI per hari',
      'Speech-to-Text dasar (1 jam / sesi)',
      'Akses AI Assistant (model free-tier)',
      'Riwayat tersimpan 7 hari',
    ],
  },
  {
    id: 'alynne-edu-plus',
    modelId: 'alynne-edu',
    name: 'ALYNNE.EDU Plus',
    tagline: 'Pilihan paling populer untuk pelajar & mahasiswa',
    price: 100000,
    durationDays: 30,
    accent: 'violet',
    popular: true,
    features: [
      'Percakapan AI tanpa batas',
      'Speech-to-Text + Entire Screen capture',
      'Generate Modul PDF dari transkrip',
      'AI Assistant (model pro-tier)',
      'Mind Map otomatis dari materi',
      'Riwayat tersimpan 30 hari',
    ],
  },
  {
    id: 'alynne-edu-pro',
    modelId: 'alynne-edu',
    name: 'ALYNNE.EDU Pro',
    tagline: 'Untuk guru, dosen, dan profesional pendidikan',
    price: 200000,
    durationDays: 30,
    accent: 'amber',
    features: [
      'Semua fitur ALYNNE.EDU Plus',
      'Speech-to-Text presisi (faster-whisper HD)',
      'Buat materi ajar & latihan otomatis',
      'Dashboard analisis belajar siswa',
      'Sertifikat resmi dengan QR verifikasi',
      'Riwayat permanen',
    ],
  },
  {
    id: 'alynne-edu-ultra',
    modelId: 'alynne-edu',
    name: 'ALYNNE.EDU Ultra',
    tagline: 'Untuk institusi, sekolah, dan universitas',
    price: 350000,
    durationDays: 30,
    accent: 'rose',
    features: [
      'Semua fitur ALYNNE.EDU Pro',
      'Multi-pengguna (hingga 25 akun)',
      'Kustomisasi kepribadian AI',
      'Integrasi LMS (Google Classroom)',
      'Prioritas dukungan 24/7',
      'Onboarding & training tim',
    ],
  },
];

export interface BillingPaymentMethod {
  id: string;
  label: string;
  category: 'Transfer Bank' | 'E-Wallet' | 'QR Code' | 'Kartu Kredit' | 'Toko Retail';
  description: string;
  /** Short label shown in the icon box */
  badge: string;
  /**
   * Midtrans Snap `enabled_payments` code(s) to filter on.
   * If omitted, the user's choice will not filter Snap (all methods shown).
   * Reference: https://docs.midtrans.com/reference/snap-enabled-payments
   */
  midtransCode?: string | string[];
}

/**
 * Indonesian payment methods. Each maps to a Midtrans Snap payment code
 * so we can pre-select / filter the Snap popup by the user's choice.
 */
export const BILLING_PAYMENT_METHODS: BillingPaymentMethod[] = [
  {
    id: 'bca-va',
    label: 'BCA Virtual Account',
    category: 'Transfer Bank',
    description: 'Otomatis terverifikasi, 24 jam',
    badge: 'BCA',
    midtransCode: 'bca_va',
  },
  {
    id: 'mandiri-va',
    label: 'Mandiri Virtual Account',
    category: 'Transfer Bank',
    description: 'Otomatis terverifikasi, 24 jam',
    badge: 'MDR',
    midtransCode: 'echannel',
  },
  {
    id: 'bni-va',
    label: 'BNI Virtual Account',
    category: 'Transfer Bank',
    description: 'Otomatis terverifikasi, 24 jam',
    badge: 'BNI',
    midtransCode: 'bni_va',
  },
  {
    id: 'bri-va',
    label: 'BRI Virtual Account',
    category: 'Transfer Bank',
    description: 'Otomatis terverifikasi, 24 jam',
    badge: 'BRI',
    midtransCode: 'bri_va',
  },
  {
    id: 'gopay',
    label: 'GoPay',
    category: 'E-Wallet',
    description: 'Bayar instan dengan saldo GoPay',
    badge: 'GO',
    midtransCode: 'gopay',
  },
  {
    id: 'shopeepay',
    label: 'ShopeePay',
    category: 'E-Wallet',
    description: 'Bayar instan dengan saldo ShopeePay',
    badge: 'SP',
    midtransCode: 'shopeepay',
  },
  {
    id: 'qris',
    label: 'QRIS',
    category: 'QR Code',
    description: 'Scan dari aplikasi e-wallet atau bank apa pun',
    badge: 'QR',
    midtransCode: 'qris',
  },
  {
    id: 'credit-card',
    label: 'Kartu Kredit (Visa / Mastercard)',
    category: 'Kartu Kredit',
    description: 'Cicilan 0% hingga 12 bulan',
    badge: 'CC',
    midtransCode: 'credit_card',
  },
  {
    id: 'alfamart',
    label: 'Alfamart',
    category: 'Toko Retail',
    description: 'Bayar tunai di gerai Alfamart terdekat',
    badge: 'ALF',
    midtransCode: 'alfamart',
  },
  {
    id: 'indomaret',
    label: 'Indomaret',
    category: 'Toko Retail',
    description: 'Bayar tunai di gerai Indomaret terdekat',
    badge: 'IND',
    midtransCode: 'indomaret',
  },
];

export const TAX_RATE = 0.11; // PPN 11% (Indonesia)

export function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Find a model by ID. */
export function getModelById(id: string): AIModel | undefined {
  return AI_MODELS.find((m) => m.id === id);
}

/** Get all tiers for a given model ID. */
export function getTiersForModel(modelId: string): BillingTier[] {
  return BILLING_TIERS.filter((t) => t.modelId === modelId);
}

/** Find a tier by ID (used by the billing endpoint). */
export function getTierById(id: string): BillingTier | undefined {
  return BILLING_TIERS.find((t) => t.id === id);
}

/** Find a payment method by ID (used by the billing endpoint). */
export function getPaymentMethodById(id: string): BillingPaymentMethod | undefined {
  return BILLING_PAYMENT_METHODS.find((p) => p.id === id);
}
