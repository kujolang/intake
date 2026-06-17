const SECRET_KEYS = [
  "password",
  "pass",
  "token",
  "secret",
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "smtp_password",
  "imap_password"
];

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (SECRET_KEYS.some((needle) => key.toLowerCase().includes(needle))) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redact(inner);
      }
    }
    return out;
  }
  if (typeof value === "string") {
    return value
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
      .replace(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s*:\s*[^\s]+/gi, "$1:[REDACTED]")
      .replace(/(password|token|secret|api[_-]?key)=([^&\s]+)/gi, "$1=[REDACTED]");
  }
  return value;
}
