import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { TargetConfig } from "./types";

const TOOL_TIMEOUT_MS = 30_000;

/**
 * Wraps a transport to silently ignore errors when sending
 * 'notifications/initialized', which some servers don't support.
 */
function wrapTransport(inner: Transport): Transport {
  const originalSend = inner.send.bind(inner);
  inner.send = async (message: JSONRPCMessage) => {
    if ("method" in message && message.method === "notifications/initialized") {
      try {
        await originalSend(message);
      } catch {
        console.warn("MCP server does not support notifications/initialized, continuing anyway");
      }
      return;
    }
    return originalSend(message);
  };
  return inner;
}

export async function callTool(
  target: TargetConfig,
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const client = new Client(
    { name: "chronos-mcp-client", version: "1.0.0" },
    { capabilities: {} }
  );

  let rawTransport: Transport;

  if (target.transport === "stdio") {
    if (!target.command) throw new Error("stdio transport requires 'command'");
    rawTransport = new StdioClientTransport({
      command: target.command,
      args: target.args ?? [],
    });
  } else {
    if (!target.url) throw new Error(`${target.transport} transport requires 'url'`);
    const url = new URL(target.url);
    const headers: Record<string, string> = {};
    if (target.authToken) {
      headers["Authorization"] = `Bearer ${target.authToken}`;
    }

    rawTransport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
    });
  }

  const transport = wrapTransport(rawTransport);

  try {
    await client.connect(transport);

    const result = await client.callTool(
      { name: toolName, arguments: params },
      undefined,
      { timeout: TOOL_TIMEOUT_MS }
    );

    return result;
  } finally {
    await client.close().catch(() => {});
  }
}
