/**
 * EverMemOS Bridge Plugin for OpenClaw
 *
 * Bridges the EverMemOS REST API (http://localhost:8001) as an OpenClaw
 * memory backend. Provides memory_search, memory_store, memory_get tools,
 * auto-recall via before_agent_start hook, and CLI commands.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { EverMemClient } from "./client.js";

// ============================================================================
// Config
// ============================================================================

type BridgeConfig = {
  apiUrl: string;
  defaultUserId: string;
  autoRecall: boolean;
  autoCapture: boolean;
};

const DEFAULT_API_URL = "http://localhost:8001/api/v1";
const DEFAULT_USER_ID = "openclaw";

const bridgeConfigSchema = {
  parse(value: unknown): BridgeConfig {
    const cfg = (value && typeof value === "object" && !Array.isArray(value))
      ? value as Record<string, unknown>
      : {};
    return {
      apiUrl: typeof cfg.apiUrl === "string" ? cfg.apiUrl : DEFAULT_API_URL,
      defaultUserId: typeof cfg.defaultUserId === "string" ? cfg.defaultUserId : DEFAULT_USER_ID,
      autoRecall: cfg.autoRecall !== false,
      autoCapture: cfg.autoCapture === true,
    };
  },
};

// ============================================================================
// Helpers
// ============================================================================

function formatMemories(data: any): string {
  const result = data?.result;
  if (!result) return "No data returned.";

  const memories = result.memories;
  if (!memories || !Array.isArray(memories) || memories.length === 0) {
    return "No relevant memories found.";
  }

  const lines: string[] = [];
  let idx = 1;
  for (const group of memories) {
    if (!group || typeof group !== "object") continue;
    for (const [memType, entries] of Object.entries(group)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const e = entry as Record<string, unknown>;
        const summary = e.summary || e.content || e.text || "(no content)";
        const ts = e.timestamp ? ` [${String(e.timestamp).slice(0, 10)}]` : "";
        lines.push(`${idx}. [${memType}]${ts} ${summary}`);
        idx++;
      }
    }
  }

  return lines.length > 0
    ? `Found ${lines.length} memories:\n\n${lines.join("\n")}`
    : "No relevant memories found.";
}

function extractMemorySummaries(data: any): string[] {
  const result = data?.result;
  if (!result?.memories || !Array.isArray(result.memories)) return [];

  const summaries: string[] = [];
  for (const group of result.memories) {
    if (!group || typeof group !== "object") continue;
    for (const entries of Object.values(group)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const e = entry as Record<string, unknown>;
        const text = e.summary || e.content || e.text;
        if (typeof text === "string" && text.length > 0) {
          summaries.push(text);
        }
      }
    }
  }
  return summaries;
}

// ============================================================================
// Auto-capture triggers
// ============================================================================

const CAPTURE_TRIGGERS = [
  /记住|记得|remember/i,
  /我喜欢|我不喜欢|i like|i prefer|i hate|i love/i,
  /重要|important|关键/i,
  /[\w.-]+@[\w.-]+\.\w+/,
  /\+?\d{10,}/,
  /我的\S+是|my\s+\w+\s+is/i,
];

function shouldCapture(text: string): boolean {
  if (text.length < 10 || text.length > 500) return false;
  if (text.includes("<relevant-memories>")) return false;
  if (text.startsWith("<") && text.includes("</")) return false;
  return CAPTURE_TRIGGERS.some((r) => r.test(text));
}

// ============================================================================
// Plugin
// ============================================================================

const evermemBridgePlugin = {
  id: "evermem-bridge",
  name: "EverMemOS Bridge",
  description: "REST API bridge to EverMemOS enterprise memory system",
  kind: "memory" as const,
  configSchema: bridgeConfigSchema,

  register(api: OpenClawPluginApi) {
    const cfg = bridgeConfigSchema.parse(api.pluginConfig);
    const client = new EverMemClient(cfg.apiUrl);

    api.logger.info(`evermem-bridge: registered (api: ${cfg.apiUrl}, user: ${cfg.defaultUserId})`);

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "memory_search",
        label: "Memory Search",
        description:
          "Search through memories stored in EverMemOS. Use when you need context about past conversations, user preferences, decisions, or previously discussed topics.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          method: Type.Optional(
            Type.Union([
              Type.Literal("keyword"),
              Type.Literal("vector"),
              Type.Literal("hybrid"),
            ], { description: "Retrieval method (default: keyword)", default: "keyword" }),
          ),
          top_k: Type.Optional(Type.Number({ description: "Max results (default: 5)" })),
          user_id: Type.Optional(Type.String({ description: "User ID to search for" })),
        }),
        async execute(_toolCallId, params) {
          const {
            query,
            method = "keyword",
            top_k = 5,
            user_id,
          } = params as { query: string; method?: string; top_k?: number; user_id?: string };

          try {
            const data = await client.search({
              query,
              retrieve_method: method as any,
              top_k,
              user_id: user_id || cfg.defaultUserId,
            });

            const text = formatMemories(data);
            return {
              content: [{ type: "text", text }],
              details: { count: data?.result?.total_count ?? 0, method },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Memory search failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_search" },
    );

    api.registerTool(
      {
        name: "memory_store",
        label: "Memory Store",
        description:
          "Save important information to long-term memory via EverMemOS. Use for facts, preferences, decisions worth remembering.",
        parameters: Type.Object({
          content: Type.String({ description: "Text to remember" }),
          sender: Type.Optional(Type.String({ description: "Who said this (default: user)" })),
          role: Type.Optional(
            Type.Union([Type.Literal("user"), Type.Literal("assistant")], { default: "user" }),
          ),
          group_id: Type.Optional(Type.String({ description: "Session/group identifier" })),
        }),
        async execute(_toolCallId, params) {
          const {
            content,
            sender,
            role = "user",
            group_id,
          } = params as { content: string; sender?: string; role?: "user" | "assistant"; group_id?: string };

          try {
            const data = await client.store({
              message_id: `oc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              create_time: new Date().toISOString(),
              sender: sender || cfg.defaultUserId,
              sender_name: sender || "OpenClaw User",
              content,
              role,
              group_id,
            });

            const count = data?.result?.count ?? 0;
            const status = data?.result?.status_info ?? "unknown";
            return {
              content: [{ type: "text", text: `Memory stored (status: ${status}, extracted: ${count})` }],
              details: { count, status },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Memory store failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_store" },
    );

    api.registerTool(
      {
        name: "memory_get",
        label: "Memory Get",
        description:
          "Fetch memories by type (episodic_memory, profile, foresight, event_log).",
        parameters: Type.Object({
          memory_type: Type.Optional(
            Type.Union([
              Type.Literal("episodic_memory"),
              Type.Literal("profile"),
              Type.Literal("foresight"),
              Type.Literal("event_log"),
            ], { description: "Memory type (default: episodic_memory)" }),
          ),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 10)" })),
          user_id: Type.Optional(Type.String({ description: "User ID" })),
        }),
        async execute(_toolCallId, params) {
          const {
            memory_type = "episodic_memory",
            limit = 10,
            user_id,
          } = params as { memory_type?: string; limit?: number; user_id?: string };

          try {
            const data = await client.fetchMemories({
              memory_type: memory_type as any,
              limit,
              user_id: user_id || cfg.defaultUserId,
            });

            const text = formatMemories(data);
            return {
              content: [{ type: "text", text }],
              details: { count: data?.result?.total_count ?? 0, memory_type },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Memory fetch failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_get" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const cmd = program.command("emem").description("EverMemOS bridge commands");

        cmd
          .command("search")
          .description("Search memories")
          .argument("<query>", "Search query")
          .option("--method <m>", "Retrieval method (keyword|vector|hybrid)", "keyword")
          .option("--top-k <n>", "Max results", "5")
          .option("--user <id>", "User ID", cfg.defaultUserId)
          .action(async (query: string, opts: any) => {
            try {
              const data = await client.search({
                query,
                retrieve_method: opts.method,
                top_k: parseInt(opts.topK),
                user_id: opts.user,
              });
              console.log(formatMemories(data));
            } catch (err) {
              console.error(`Error: ${err}`);
            }
          });

        cmd
          .command("health")
          .description("Check EverMemOS connection")
          .action(async () => {
            const h = await client.health();
            if (h.ok) {
              console.log(`EverMemOS: healthy (${h.status})`);
            } else {
              console.error(`EverMemOS: unhealthy — ${h.error}`);
            }
          });

        cmd
          .command("stats")
          .description("Show memory statistics")
          .option("--user <id>", "User ID", cfg.defaultUserId)
          .action(async (opts: any) => {
            try {
              const types = ["episodic_memory", "profile", "foresight", "event_log"] as const;
              for (const mt of types) {
                const data = await client.fetchMemories({
                  memory_type: mt,
                  user_id: opts.user,
                  limit: 1,
                });
                const total = data?.result?.total_count ?? 0;
                console.log(`  ${mt}: ${total} records`);
              }
            } catch (err) {
              console.error(`Error: ${err}`);
            }
          });
      },
      { commands: ["emem"] },
    );

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    // Auto-recall: inject relevant memories before agent starts
    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event) => {
        if (!event.prompt || event.prompt.length < 10) {
          return;
        }

        try {
          const data = await client.search({
            query: event.prompt.slice(0, 200),
            retrieve_method: "keyword",
            top_k: 3,
            user_id: cfg.defaultUserId,
          });

          const summaries = extractMemorySummaries(data);
          if (summaries.length === 0) return;

          const memoryContext = summaries
            .slice(0, 5)
            .map((s) => `- ${s}`)
            .join("\n");

          api.logger.info?.(`evermem-bridge: injecting ${summaries.length} memories into context`);

          return {
            prependContext: `<relevant-memories>\nThe following memories from past conversations may be relevant:\n${memoryContext}\n</relevant-memories>`,
          };
        } catch (err) {
          api.logger.warn(`evermem-bridge: auto-recall failed: ${String(err)}`);
        }
      });
    }

    // Auto-capture: store important user messages after agent ends
    if (cfg.autoCapture) {
      api.on("agent_end", async (event) => {
        if (!event.success || !event.messages || event.messages.length === 0) {
          return;
        }

        try {
          const texts: string[] = [];
          for (const msg of event.messages) {
            if (!msg || typeof msg !== "object") continue;
            const msgObj = msg as Record<string, unknown>;
            if (msgObj.role !== "user") continue;

            const content = msgObj.content;
            if (typeof content === "string") {
              texts.push(content);
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (
                  block &&
                  typeof block === "object" &&
                  (block as any).type === "text" &&
                  typeof (block as any).text === "string"
                ) {
                  texts.push((block as any).text);
                }
              }
            }
          }

          const toCapture = texts.filter(shouldCapture);
          if (toCapture.length === 0) return;

          let stored = 0;
          for (const text of toCapture.slice(0, 3)) {
            await client.store({
              message_id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              create_time: new Date().toISOString(),
              sender: cfg.defaultUserId,
              sender_name: "OpenClaw User",
              content: text,
              role: "user",
            });
            stored++;
          }

          if (stored > 0) {
            api.logger.info(`evermem-bridge: auto-captured ${stored} memories`);
          }
        } catch (err) {
          api.logger.warn(`evermem-bridge: auto-capture failed: ${String(err)}`);
        }
      });
    }

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "evermem-bridge",
      start: async () => {
        const h = await client.health();
        if (h.ok) {
          api.logger.info(`evermem-bridge: connected to EverMemOS (${h.status})`);
        } else {
          api.logger.warn(`evermem-bridge: EverMemOS unreachable — ${h.error}`);
        }
      },
      stop: () => {
        api.logger.info("evermem-bridge: stopped");
      },
    });
  },
};

export default evermemBridgePlugin;
