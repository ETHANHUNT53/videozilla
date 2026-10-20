import "server-only";

/**
 * Server environment. Read lazily so `next build` works before every key exists; each getter throws a clear
 * message when a required value is missing at the moment it's needed.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. Add it to apps/web/.env.local (see .env.example).`);
  return value;
}

export const env = {
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  get mongoUri() {
    return required("MONGODB_URI");
  },
  get mongoDb() {
    return process.env.MONGODB_DB || "videozilla";
  },
  get appUrl() {
    return process.env.BETTER_AUTH_URL || "http://localhost:3000";
  },
  google: {
    get configured() {
      return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    },
    get clientId() {
      return required("GOOGLE_CLIENT_ID");
    },
    get clientSecret() {
      return required("GOOGLE_CLIENT_SECRET");
    },
  },
  r2: {
    get configured() {
      return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
    },
    get accountId() {
      return required("R2_ACCOUNT_ID");
    },
    get accessKeyId() {
      return required("R2_ACCESS_KEY_ID");
    },
    get secretAccessKey() {
      return required("R2_SECRET_ACCESS_KEY");
    },
    get bucket() {
      return required("R2_BUCKET");
    },
  },
};
