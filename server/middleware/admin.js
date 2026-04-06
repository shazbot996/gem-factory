const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'charles.schiele@gmail.com')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

export function isAdmin(email) {
  return ADMIN_EMAILS.includes(email);
}

export default function requireAdmin(req, res, next) {
  if (!isAdmin(req.user.email)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
