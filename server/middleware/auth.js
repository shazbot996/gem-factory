import { OAuth2Client } from 'google-auth-library';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN;
const ALLOW_GMAIL = process.env.ALLOW_GMAIL !== 'false'; // default true
const client = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

/**
 * Decide whether a validated Google ID token payload identifies an
 * acceptable user. Accepts:
 *   - Customer org: payload.hd === allowedDomain
 *   - Personal Gmail: no hd claim and email ends in @gmail.com (when allowGmail)
 * Extracted as a pure function so it can be unit-tested directly.
 */
export function isIdentityAllowed(payload, { allowedDomain, allowGmail }) {
  const hd = payload && payload.hd;
  const email = (payload && payload.email) || '';
  const isCustomerOrg = !!allowedDomain && hd === allowedDomain;
  const isGmail = !hd && /@gmail\.com$/i.test(email);
  return isCustomerOrg || (allowGmail && isGmail);
}

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

    if (!isIdentityAllowed(payload, { allowedDomain: ALLOWED_DOMAIN, allowGmail: ALLOW_GMAIL })) {
      return res.status(403).json({
        error: 'This account is not authorized. Use your organization account or a personal Gmail account.',
      });
    }

    req.user = { email: payload.email, name: payload.name };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
