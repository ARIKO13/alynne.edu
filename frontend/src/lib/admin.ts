export const ADMIN_EMAILS = [
  'arshikocode@gmail.com',
  'ardilanpro@gmail.com',
  'ar.rahmadan18@gmail.com',
  'adamrizkyr13@gmail.com',
  'lina.ai2526@gmail.com',
  'adam.rizky.rahmadan.tik25@stu.pnj.ac.id',
  'contactzsoft@gmail.com',
];

export function isAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
