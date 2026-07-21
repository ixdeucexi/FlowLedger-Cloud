const crypto = require("crypto");

function isAuthorizedCron(req, secret) {
  const supplied = String(req?.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  const expected = Buffer.from(String(secret || ""));
  const actual = Buffer.from(supplied);
  return expected.length > 0
    && expected.length === actual.length
    && crypto.timingSafeEqual(expected, actual);
}

module.exports = { isAuthorizedCron };
