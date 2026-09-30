import type {
  AgentsApiRawEvent,
  AgentsApiSessionRequest,
  AgentsApiTransport,
} from "./types.js";

export interface OpenAIAgentsHttpTransportOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("OpenAI Agents API returned a non-object JSON payload");
  }
  return value as Readonly<Record<string, unknown>>;
};

const extractDataArray = (
  value: unknown,
): readonly Readonly<Record<string, unknown>>[] => {
  const record = asRecord(value);
  const data = record.data;
  if (!Array.isArray(data)) {
    throw new Error("OpenAI Agents API list response is missing data[]");
  }
  return data.map(asRecord);
};

const nextSseBoundary = (
  buffer: string,
): { index: number; length: number } | null => {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");

  if (lf === -1 && crlf === -1) return null;
  if (lf === -1) return { index: crlf, length: 4 };
  if (crlf === -1) return { index: lf, length: 2 };
  return lf < crlf
    ? { index: lf, length: 2 }
    : { index: crlf, length: 4 };
};

export async function* parseAgentsSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AgentsApiRawEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const boundary = nextSseBoundary(buffer);
        if (!boundary) break;

        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);

        const dataLines = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());

        if (dataLines.length === 0) continue;
        const data = dataLines.join("\n").trim();
        if (!data || data === "[DONE]") continue;

        const parsed: unknown = JSON.parse(data);
        yield asRecord(parsed) as AgentsApiRawEvent;
      }
    }

    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) {
      const dataLines = tail
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      const data = dataLines.join("\n").trim();
      if (data && data !== "[DONE]") {
        const parsed: unknown = JSON.parse(data);
        yield asRecord(parsed) as AgentsApiRawEvent;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class OpenAIAgentsHttpTransport implements AgentsApiTransport {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: OpenAIAgentsHttpTransportOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("OpenAI API key is required");
    }
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    );
    this.#fetch = options.fetchFn ?? fetch;
  }

  async *streamSession(
    request: AgentsApiSessionRequest,
  ): AsyncIterable<AgentsApiRawEvent> {
    const response = await this.#fetch(`${this.#baseUrl}/agents/sessions`, {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(
        `Agents API create session failed: ${response.status} ${await response.text()}`,
      );
    }
    if (!response.body) {
      throw new Error("Agents API streaming response has no body");
    }

    yield* parseAgentsSse(response.body);
  }

  async retrieveSession(
    sessionId: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    return asRecord(
      await this.#jsonGet(
        `${this.#baseUrl}/agents/sessions/${encodeURIComponent(sessionId)}`,
      ),
    );
  }

  async listSessionItems(
    sessionId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    return extractDataArray(
      await this.#jsonGet(
        `${this.#baseUrl}/agents/sessions/${encodeURIComponent(sessionId)}/items?limit=100&order=asc`,
      ),
    );
  }

  async listSessionSubagents(
    sessionId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    return extractDataArray(
      await this.#jsonGet(
        `${this.#baseUrl}/agents/sessions/${encodeURIComponent(sessionId)}/subagents?limit=100&order=asc`,
      ),
    );
  }

  async listSubagentItems(
    sessionId: string,
    subagentId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    return extractDataArray(
      await this.#jsonGet(
        `${this.#baseUrl}/agents/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(subagentId)}/items?limit=100&order=asc`,
      ),
    );
  }

  async #jsonGet(url: string): Promise<unknown> {
    const response = await this.#fetch(url, {
      method: "GET",
      headers: this.#headers(),
    });
    if (!response.ok) {
      throw new Error(
        `Agents API GET failed: ${response.status} ${await response.text()}`,
      );
    }
    return response.json();
  }

  #headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.#apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "agents=v1",
    };
  }
}
