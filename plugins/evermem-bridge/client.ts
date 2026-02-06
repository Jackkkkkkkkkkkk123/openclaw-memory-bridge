/**
 * EverMemOS REST API Client
 *
 * Wraps the EverMemOS HTTP endpoints for use by the OpenClaw bridge plugin.
 * Uses Node native fetch — no external dependencies.
 */

export type SearchParams = {
  query: string;
  user_id?: string;
  group_id?: string;
  retrieve_method?: "keyword" | "vector" | "hybrid" | "rrf" | "agentic";
  memory_types?: string[];
  top_k?: number;
  radius?: number;
  start_time?: string;
  end_time?: string;
  include_metadata?: boolean;
};

export type StoreParams = {
  message_id: string;
  create_time: string;
  sender: string;
  sender_name?: string;
  content: string;
  role?: "user" | "assistant";
  group_id?: string;
  group_name?: string;
  refer_list?: string[];
};

export type FetchParams = {
  user_id?: string;
  group_id?: string;
  memory_type?: "episodic_memory" | "profile" | "foresight" | "event_log";
  limit?: number;
  offset?: number;
  start_time?: string;
  end_time?: string;
};

export type DeleteParams = {
  event_id?: string;
  user_id?: string;
  group_id?: string;
};

export class EverMemClient {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  async search(params: SearchParams): Promise<any> {
    const qs = new URLSearchParams();
    if (params.query) qs.set("query", params.query);
    if (params.user_id) qs.set("user_id", params.user_id);
    if (params.group_id) qs.set("group_id", params.group_id);
    if (params.retrieve_method) qs.set("retrieve_method", params.retrieve_method);
    if (params.top_k) qs.set("top_k", String(params.top_k));
    if (params.radius) qs.set("radius", String(params.radius));
    if (params.start_time) qs.set("start_time", params.start_time);
    if (params.end_time) qs.set("end_time", params.end_time);
    if (params.include_metadata !== undefined) qs.set("include_metadata", String(params.include_metadata));
    if (params.memory_types?.length) {
      for (const mt of params.memory_types) qs.append("memory_types", mt);
    }

    const res = await fetch(this.url(`/memories/search?${qs.toString()}`), {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`EverMemOS search failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  async store(params: StoreParams): Promise<any> {
    const res = await fetch(this.url("/memories"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`EverMemOS store failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  async fetchMemories(params: FetchParams): Promise<any> {
    const qs = new URLSearchParams();
    if (params.user_id) qs.set("user_id", params.user_id);
    if (params.group_id) qs.set("group_id", params.group_id);
    if (params.memory_type) qs.set("memory_type", params.memory_type);
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.offset) qs.set("offset", String(params.offset));
    if (params.start_time) qs.set("start_time", params.start_time);
    if (params.end_time) qs.set("end_time", params.end_time);

    const res = await fetch(this.url(`/memories?${qs.toString()}`), {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`EverMemOS fetch failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  async deleteMemories(params: DeleteParams): Promise<any> {
    const qs = new URLSearchParams();
    if (params.event_id) qs.set("event_id", params.event_id);
    if (params.user_id) qs.set("user_id", params.user_id);
    if (params.group_id) qs.set("group_id", params.group_id);

    const res = await fetch(this.url(`/memories?${qs.toString()}`), {
      method: "DELETE",
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`EverMemOS delete failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  async health(): Promise<{ ok: boolean; status?: string; error?: string }> {
    try {
      const res = await fetch(this.url("").replace("/api/v1", "") + "/health", {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      return { ok: true, status: data.status };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}
