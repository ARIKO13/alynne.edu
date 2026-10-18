export const ADMIN_EMAILS = [
  'arshikocode@gmail.com',
  'ardilanpro@gmail.com',
  'moonahoshinova@gmail.com',
];

export function isAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  // Trim + lowercase for defensive comparison (handles accidental
  // whitespace or capitalization from OAuth providers)
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
