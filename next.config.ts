import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Type errors are caught by `npm run typecheck`; keep dev/builds fast.
  typescript: { ignoreBuildErrors: false },
  // Tracing state (registered telemetry integrations, OTel tracer provider,
  // Langfuse span processor/context) must be a single module instance shared
  // between the instrumentation bundle and the route/server bundles.
  serverExternalPackages: [
    "ai",
    "@opentelemetry/api",
    "@opentelemetry/sdk-node",
    "@langfuse/client",
    "@langfuse/otel",
    "@langfuse/tracing",
    "@langfuse/vercel-ai-sdk",
  ],
};

export default nextConfig;
