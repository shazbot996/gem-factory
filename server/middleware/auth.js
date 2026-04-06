import { OAuth2Client } from 'google-auth-library';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN;
const client = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

export default async function authMiddleware(req, res, next) {
  // Skip auth for health check
  if (req.path === '/api/health') return next();

  // Dev bypass mode when no Google Client ID is configured
  if (!client) {
    req.user = {
      email: req.headers['x-dev-user-email'] || 'dev@localhost',
      name: 'Dev User',
    };
    return next();
  }

  // Production mode — validate Google ID token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.slice(7);
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (ALLOWED_DOMAIN && payload.hd !== ALLOWED_DOMAIN) {
      return res.status(403).json({ error: `Access restricted to ${ALLOWED_DOMAIN}` });
    }

    req.user = { email: payload.email, name: payload.name };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
