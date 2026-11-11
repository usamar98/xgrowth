import { AppError, config, handle } from "@/lib/server";
import { tick } from "@/lib/queue-worker";
import { runDueRules } from "@/lib/automation-runner";

export async function POST(request: Request) {
  return handle(async () => {
    const secret = config("SIGNALDESK_WORKER_SECRET"),
      received = request.headers.get("authorization") || "";
    if (secret.length < 32)
      throw new AppError(
        "Configure a worker secret of at least 32 characters.",
        503,
      );
    const encoder = new TextEncoder(),
      key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode("Bearer " + secret),
    );
    if (
      received.length > 1024 ||
      !(await crypto.subtle.verify(
        "HMAC",
        key,
        signature,
        encoder.encode(received),
      ))
    )
      throw new AppError("Worker authentication required.", 401);
    const result = await tick();
    await runDueRules();
    return result;
  });
}
