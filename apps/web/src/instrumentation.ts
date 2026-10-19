/**
 * Runs once when the server starts (Next.js instrumentation). Test-only AI settings are refused in production here
 * too, so a bad deploy stops at boot instead of on the first user's AI request (instrumentation-node.ts). The same
 * check also runs when next.config.ts loads, so `next build` fails first (instrumentation doesn't run at build time).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkAiConfigAtBoot } = await import("./instrumentation-node");
  checkAiConfigAtBoot();
}
