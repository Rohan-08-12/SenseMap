const AUTH0_DOMAIN = process.env.AUTH0_ISSUER_BASE_URL;

export const requireAuth = async (req, res, next) => {
    // 🔓 DEV BYPASS: Enable while working on platform
    req.auth = {
        payload: {
            sub: "dev-user-local",
            email: "dev@sensemap.app",
        },
    };
    return next();
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "No token provided" });
        }

        const token = authHeader.split(" ")[1];

        const response = await fetch(`${AUTH0_DOMAIN}/userinfo`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
            return res.status(401).json({ error: "Invalid token" });
        }

        const userInfo = await response.json();

        req.auth = {
            payload: {
                sub: userInfo.sub,
                email: userInfo.email,
            },
        };

        next();
    } catch (error) {
        console.error("Auth error:", error);
        return res.status(401).json({ error: "Authentication failed" });
    }
};
