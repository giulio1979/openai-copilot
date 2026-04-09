import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 11434;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gpt-4.1";
const GITHUB_MODELS_URL = "https://models.inference.ai.azure.com/chat/completions";
const MAX_RETRIES = 5;
const UPSTREAM_TIMEOUT_MS = 120_000; // 2 min timeout per upstream request

if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN environment variable is required");
  console.error("Create a PAT at https://github.com/settings/tokens with the 'models' permission");
  process.exit(1);
}

async function fetchWithRetry(url, options) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw new Error(`Upstream request timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    }
    clearTimeout(timer);

    if (res.status !== 429 || attempt === MAX_RETRIES) return res;

    // Parse wait time from response, default 20s
    let waitSec = 20;
    let rawBody;
    try {
      rawBody = await res.json();
      const match = rawBody?.error?.message?.match(/wait (\d+) seconds/i);
      if (match) waitSec = parseInt(match[1], 10);
    } catch {}

    // If wait is too long (daily limit), don't retry — return the 429 to the client
    if (waitSec > 120) {
      console.log(`Rate limit wait too long (${waitSec}s), returning 429 to client`);
      return new Response(JSON.stringify(rawBody || { error: { message: "Rate limited" } }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": String(waitSec) },
      });
    }

    const waitMs = (waitSec + 1) * 1000;
    console.log(`Rate limited, retrying in ${waitSec + 1}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

// ---------- Request logging ----------

app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.url}`);
  next();
});

// ---------- OpenAI-compatible: POST /v1/chat/completions ----------

app.post("/v1/chat/completions", async (req, res) => {
  try {
    const { messages = [], model, stream = false, ...rest } = req.body;

    if (!messages.length) {
      return res.status(400).json({ error: { message: "messages is required", type: "invalid_request_error" } });
    }

    const chosenModel = model || DEFAULT_MODEL;

    // Sanitize message `name` fields: upstream requires ^[^\s<|\\/>]+$
    const sanitized = messages.map((m) => {
      if (m.name) {
        return { ...m, name: m.name.replace(/[\s<|\\/>]+/g, "_") };
      }
      return m;
    });

    // Forward the full request body (tools, tool_choice, temperature, etc.)
    const payload = {
      ...rest,
      model: chosenModel,
      messages: sanitized,
      stream,
    };

    const upstream = await fetchWithRetry(GITHUB_MODELS_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const errBody = await upstream.text();
      console.error(`Upstream error ${upstream.status}:`, errBody);
      return res.status(upstream.status).json({
        error: { message: errBody, type: "upstream_error" },
      });
    }

    // ---- Streaming response ----
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
      res.end();
      return;
    }

    // ---- Non-streaming response ----
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({
      error: { message: err.message, type: "server_error" },
    });
  }
});

// ---------- GET /v1/models ----------

app.get("/v1/models", (_req, res) => {
  const models = ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "gpt-4", "o3-mini", "o4-mini", "claude-sonnet-4"];
  res.json({
    object: "list",
    data: models.map((id) => ({
      id,
      object: "model",
      created: 1700000000,
      owned_by: "github-copilot",
    })),
  });
});

// ---------- Ollama-compatible endpoints ----------

// Ollama uses /api/chat and /api/generate
app.post("/api/chat", (req, res) => {
  // Rewrite to OpenAI format and forward
  const { model, messages, stream } = req.body;
  req.url = "/v1/chat/completions";
  req.body = { model, messages, stream: stream ?? false };
  app.handle(req, res);
});

app.get("/api/tags", (_req, res) => {
  const models = ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini"];
  res.json({
    models: models.map((name) => ({
      name,
      model: name,
      modified_at: new Date().toISOString(),
      size: 0,
    })),
  });
});

// ---------- Health ----------

app.get("/", (_req, res) => {
  res.json({ status: "ok", message: "OpenAI-compatible Copilot proxy" });
});

app.listen(PORT, () => {
  console.log(`Copilot proxy listening on http://localhost:${PORT}`);
  console.log(`  OpenAI-compatible: POST http://localhost:${PORT}/v1/chat/completions`);
  console.log(`  Ollama-compatible: POST http://localhost:${PORT}/api/chat`);
  console.log(`  Models list:       GET  http://localhost:${PORT}/v1/models`);
  console.log(`  Default model:     ${DEFAULT_MODEL}`);
});
