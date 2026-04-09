# openai-copilot-proxy

OpenAI/Ollama-compatible API server that proxies requests to GitHub Copilot (gpt-4.1 by default).

## Setup

```bash
npm install
```

## Usage

```bash
export GITHUB_TOKEN="ghp_..."
./run.sh
```

Listens on `http://localhost:11434` by default.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | OpenAI-compatible chat completions |
| `/v1/models` | GET | List available models |
| `/api/chat` | POST | Ollama-compatible chat |
| `/api/tags` | GET | Ollama-compatible model list |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_TOKEN` | (required) | GitHub token with Copilot access |
| `PORT` | `11434` | Server port |
| `DEFAULT_MODEL` | `gpt-4.1` | Default model |

## Example

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4.1","messages":[{"role":"user","content":"Hello"}]}'
```
