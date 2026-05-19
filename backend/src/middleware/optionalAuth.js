import { auth } from 'express-oauth2-jwt-bearer';

const jwtCheck = auth({
    audience: process.env.AUTH0_AUDIENCE,
    issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
    tokenSigningAlg: 'RS256',
});

export const optionalAuth = (req, res, next) => {
    if (!req.headers.authorization) return next();
    jwtCheck(req, res, (err) => {
        if (err) console.warn('[optionalAuth] Invalid/expired token from IP:', req.ip);
        next();
    });
};
