#!/usr/bin/env bash
# Quick test: call the Ollama-compatible /api/chat endpoint

URL="${1:-http://localhost:11434}"

echo "=== Non-streaming ==="
curl -s "$URL/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4.1","messages":[{"role":"user","content":"Say hello world in one sentence."}]}' | node -e "
    let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
      try { const r=JSON.parse(d); console.log(r.choices[0].message.content); }
      catch(e) { console.log(d); }
    });"

echo ""
echo "=== Streaming ==="
curl -sN "$URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4.1","messages":[{"role":"user","content":"Say hello world in one sentence."}],"stream":true}' | while IFS= read -r line; do
    [[ "$line" == data:* ]] || continue
    data="${line#data: }"
    [[ "$data" == "[DONE]" ]] && break
    printf '%s' "$(echo "$data" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);process.stdout.write(r.choices[0].delta.content||'')}catch(e){}})")"
  done
echo ""
