const rateMap = new Map();

module.exports = function institutionRateLimiter(req, res, next) {
  const inst = req.institution?.id;
  if (!inst) return res.status(401).json({ error: "NO_INSTITUTION" });

  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const limit = 120; // requests per minute per institution

  const record = rateMap.get(inst) || { count: 0, start: now };

  if (now - record.start > windowMs) {
    record.count = 0;
    record.start = now;
  }

  record.count++;

  rateMap.set(inst, record);

  if (record.count > limit) {
    return res.status(429).json({ error: "RATE_LIMIT_EXCEEDED" });
  }

  next();
};