import { clampLogRetentionDays } from './logger.js';

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  return {
    production,
    host: env.HOST || '0.0.0.0',
    port: Number(env.PORT || 8080),
    publicBaseUrl: env.PUBLIC_BASE_URL || 'https://mods.aic.la',
    launcherUrl: env.PUBLIC_LAUNCHER_URL || env.PUBLIC_BASE_URL || 'https://mods.aic.la',
    cdnBaseUrl: env.PUBLIC_CDN_URL || env.PUBLIC_BASE_URL || 'https://mods.aic.la',
    cdnStyle: env.CDN_STYLE || 'origin',
    requireConfirm: env.REQUIRE_CONFIRM === 'true' || production,
    cloudflareZoneId: env.CF_ZONE_ID || '',
    cloudflareToken: env.CF_API_TOKEN || '',
    dataDir: env.DATA_DIR || './data',
    adminToken: env.ADMIN_TOKEN || '',
    allowBootstrapAdmin: env.ALLOW_BOOTSTRAP_ADMIN === 'true',
    bootstrapDisabled: production && env.ALLOW_BOOTSTRAP_ADMIN !== 'true',
    databaseUrl: env.DATABASE_URL || '',
    maxArtifactBytes: Number(env.MAX_ARTIFACT_BYTES || 2_147_483_648),
    maxDiagnosticBytes: Number(env.MAX_DIAGNOSTIC_BYTES || 262_144),
    diagnosticRetentionDays: Number(env.DIAGNOSTIC_RETENTION_DAYS || 30),
    auditRetentionDays: Number(env.AUDIT_RETENTION_DAYS || 0),
    logRetentionDays: clampLogRetentionDays(env.LOG_RETENTION_DAYS || 30),
    forceHttps: env.FORCE_HTTPS === 'true',
    trustedProxy: env.TRUSTED_PROXY === 'true',
    adminHost: env.ADMIN_HOST || '',
    requireReview: env.REQUIRE_REVIEW === 'true' || production,
    crashRateBlockThreshold: Number(env.CRASH_RATE_BLOCK_THRESHOLD || 0.35),
    crashRateMinSamples: Number(env.CRASH_RATE_MIN_SAMPLES || 8),
    manifestTtlDays: Number(env.MANIFEST_TTL_DAYS || 90),
    webhookUrl: env.ALERT_WEBHOOK_URL || '',
    signingPrivateKey: env.SIGNING_PRIVATE_KEY || '',
    signingServiceUrl: env.SIGNING_SERVICE_URL || '',
    signingServiceToken: env.SIGNING_SERVICE_TOKEN || '',
    githubClientId: env.GITHUB_CLIENT_ID || '',
    githubClientSecret: env.GITHUB_CLIENT_SECRET || '',
    s3: {
      endpoint: env.S3_ENDPOINT || '',
      region: env.S3_REGION || 'us-east-1',
      bucket: env.S3_BUCKET || '',
      accessKey: env.S3_ACCESS_KEY || '',
      secretKey: env.S3_SECRET_KEY || '',
      prefix: env.S3_PREFIX || 'objects/'
    }
  };
}
