import rateLimit from 'express-rate-limit';

export const otpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    const userId = req.user?.id || 'anon';
    return `${req.ip}:${userId}`;
  },
});

