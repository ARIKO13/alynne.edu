/**
 * Billing models + payment methods for the ALYNNE.AI billing page.
 *
 * These tiers are SEPARATE from `subscription-db.ts`'s `PRICE_RP` (which is
 * the legacy single-tier price). The new `create-billing.ts` endpoint looks
 * up the tier's `price` from `BILLING_TIERS` here, so adding/removing tiers
 * doesn't require touching any endpoint code.
 */

export interface BillingTier {
  id: string;
  /** Display name (kept identical to brand convention: ALYNNE.<KIND>) */
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
 * The four ALYNNE billing tiers.
 *
 * ALYNNE.EDU is the "popular" middle option and matches the existing
 * Rp 69.000 / 30 days price point in `subscription-db.ts` so the new
 * billing page stays consistent with the legacy `PaymentWall` UI.
 */
export const BILLING_TIERS: BillingTier[] = [
  {
    id: 'alynne-lite',
    name: 'ALYNNE.LITE',
    tagline: 'Pemula yang baru mengenal AI edukasi',
    price: 39000,
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
    id: 'alynne-edu',
    name: 'ALYNNE.EDU',
    tagline: 'Pilihan paling populer untuk pelajar & mahasiswa',
    price: 69000,
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
    id: 'alynne-pro',
    name: 'ALYNNE.PRO',
    tagline: 'Untuk guru, dosen, dan profesional pendidikan',
    price: 149000,
    durationDays: 30,
    accent: 'amber',
    features: [
      'Semua fitur ALYNNE.EDU',
      'Speech-to-Text presisi (faster-whisper HD)',
      'Buat materi ajar & latihan otomatis',
      'Dashboard analisis belajar siswa',
      'Sertifikat resmi dengan QR verifikasi',
      'Riwayat permanen',
    ],
  },
  {
    id: 'alynne-ultra',
    name: 'ALYNNE.ULTRA',
    tagline: 'Untuk institusi, sekolah, dan universitas',
    price: 299000,
    durationDays: 30,
    accent: 'rose',
    features: [
      'Semua fitur ALYNNE.PRO',
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

/** Find a tier by ID (used by the billing endpoint). */
export function getTierById(id: string): BillingTier | undefined {
  return BILLING_TIERS.find((t) => t.id === id);
}

/** Find a payment method by ID (used by the billing endpoint). */
export function getPaymentMethodById(id: string): BillingPaymentMethod | undefined {
  return BILLING_PAYMENT_METHODS.find((p) => p.id === id);
}
