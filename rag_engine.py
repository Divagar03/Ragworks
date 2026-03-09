"""
rag_engine.py – RAG pipeline (source: github.com/Divagar03/Ragworks)
Uses sentence-transformers + numpy cosine similarity + Groq LLM.
"""
import io
import json
import os

import fitz          # PyMuPDF
import numpy as np
from groq import Groq
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

load_dotenv()

_model  = SentenceTransformer("BAAI/bge-small-en")
_client = Groq(api_key=os.getenv("GROQ_API_KEY", ""))

CHUNK_SIZE    = 500
CHUNK_OVERLAP = 100
TOP_K         = 3
LLM_MODEL     = "llama-3.1-8b-instant"


# ── Text helpers ──────────────────────────────────────────────
def _load_pdf(file_bytes: bytes) -> str:
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    return "".join(page.get_text() for page in doc)


def _chunk_text(text: str) -> list[str]:
    chunks, start = [], 0
    while start < len(text):
        chunks.append(text[start: start + CHUNK_SIZE])
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return [c.strip() for c in chunks if c.strip()]


def _retrieve_top_k(query: str, chunks: list[str], k: int = TOP_K) -> list[str]:
    if not chunks:
        return []
    chunk_emb = _model.encode(chunks, normalize_embeddings=True)
    query_emb = _model.encode([query], normalize_embeddings=True)[0]
    scores    = np.dot(chunk_emb, query_emb)
    top_idx   = np.argsort(scores)[-k:][::-1]
    return [chunks[i] for i in top_idx]


# ── LLM extraction ────────────────────────────────────────────
def _extract_incidents(context: str) -> list[dict]:
    prompt = f"""You are a cybersecurity analyst.

Extract ALL security incidents from the text.

Rules:
- Output ONLY a valid JSON array
- One object per incident
- If none found, return []
- Required fields: incident_id, date, location, incident_type, severity, description

TEXT:
{context}
"""
    resp = _client.chat.completions.create(
        model=LLM_MODEL,
        temperature=0,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = resp.choices[0].message.content.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        return json.loads(raw)
    except Exception:
        return []


# ── Public pipeline ────────────────────────────────────────────
def run_rag_pipeline(file_bytes: bytes, filename: str) -> list[dict]:
    """
    Accept raw file bytes + filename.
    Returns a list of structured incident dicts.
    """
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        text = _load_pdf(file_bytes)
    else:
        text = file_bytes.decode("utf-8", errors="replace")

    if not text.strip():
        return []

    chunks     = _chunk_text(text)
    top_chunks = _retrieve_top_k("security incident breach attack vulnerability", chunks)
    context    = "\n\n---\n\n".join(top_chunks)
    incidents  = _extract_incidents(context)

    # Attach source citation to each incident (R4)
    for i, inc in enumerate(incidents):
        inc.setdefault("citation", {
            "filename":    filename,
            "chunk_index": i,
        })

    return incidents


    @staticmethod
    def _chunk(text: str) -> list[str]:
        chunks, start = [], 0
        while start < len(text):
            end = start + CHUNK_SIZE
            chunks.append(text[start:end])
            start += CHUNK_SIZE - CHUNK_OVERLAP
        return [c.strip() for c in chunks if c.strip()]
