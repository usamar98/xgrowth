import { createInterface } from "node:readline";
const names = {
  list_drafts: {
    scope: "drafts:read",
    description: "List drafts for the credential account.",
    properties: {},
  },
  create_draft: {
    scope: "drafts:create",
    description: "Save original text for review.",
    properties: { text: { type: "string", minLength: 1, maxLength: 4000 } },
    required: ["text"],
  },
  request_review: {
    scope: "drafts:review",
    description: "Request human review of a saved draft.",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  job_status: {
    scope: "jobs:read",
    description: "Inspect a job in this account.",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  workspace_summary: {
    scope: "summary:read",
    description: "Read account-bound workflow counts.",
    properties: {},
  },
};
async function handle(msg) {
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const error = (code, message) => ({
    jsonrpc: "2.0",
    id: msg.id ?? null,
    error: { code, message },
  });
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string")
    return error(-32600, "Invalid request");
  if (!Object.hasOwn(msg, "id")) return null;
  if (msg.method === "initialize")
    return reply({
      protocolVersion: "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "signaldesk", version: "1.0.0" },
    });
  if (msg.method === "ping") return reply({});
  if (msg.method === "tools/list")
    return reply({
      tools: Object.entries(names).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: {
          type: "object",
          properties: t.properties,
          required: t.required || [],
          additionalProperties: false,
        },
      })),
    });
  if (msg.method !== "tools/call") return error(-32601, "Unknown method");
  if (!Object.hasOwn(names, msg.params?.name || ""))
    return error(-32602, "Unknown tool");
  try {
    const url = new URL(
      "/api/developer",
      process.env.APP_ORIGIN || "http://localhost:5173",
    );
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error("Configure a secure app origin.");
    if (!process.env.SIGNALDESK_API_TOKEN)
      throw new Error("Set SIGNALDESK_API_TOKEN.");
    const res = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: "Bearer " + process.env.SIGNALDESK_API_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tool: msg.params.name, ...msg.params.arguments }),
    });
    const result = await res.json();
    return reply({
      isError: !res.ok,
      content: [{ type: "text", text: JSON.stringify(result) }],
    });
  } catch (e) {
    return reply({
      isError: true,
      content: [{ type: "text", text: e.message }],
    });
  }
}
for await (const line of createInterface({
  input: process.stdin,
  terminal: false,
})) {
  try {
    const result = await handle(JSON.parse(line));
    if (result) process.stdout.write(JSON.stringify(result) + "\n");
  } catch {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Invalid JSON" },
      }) + "\n",
    );
  }
}
