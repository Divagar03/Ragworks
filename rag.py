import numpy as np
import fitz
import json
from sentence_transformers import SentenceTransformer
from groq import Groq
import os

client = Groq(api_key=os.getenv("API_KEY"))
model = SentenceTransformer("BAAI/bge-small-en")


def load_pdf_text(file_path):
    doc = fitz.open(file_path)
    text = ""
    for page in doc:
        text += page.get_text()
    return text

def chunk_text(text, size=500, overlap=100):
    chunks = []
    start = 0
    while start < len(text):
        end = start + size
        chunks.append(text[start:end])
        start += size - overlap
    return chunks

def retrieve_top_k(query, chunks, k=3):
    if not chunks:
        return []

    chunk_emb = model.encode(chunks, normalize_embeddings=True)
    query_emb = model.encode([query], normalize_embeddings=True)[0]

    scores = np.dot(chunk_emb, query_emb)
    top_idx = np.argsort(scores)[-k:][::-1]

    return [chunks[i] for i in top_idx]

def extract_incidents(context):
    prompt = f"""
You are a cybersecurity analyst.

Extract ALL security incidents from the text.

Rules:
- Output ONLY valid JSON array
- One object per incident
- If none, return []
- Fields: incident_id, date, location, incident_type, severity, description

TEXT:
{context}
"""

    resp = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        temperature=0,
        messages=[{"role": "user", "content": prompt}]
    )

    output = resp.choices[0].message.content.strip()

    try:
        return json.loads(output)
    except:
        return []

def run_rag_pipeline(input_data):
    if input_data.lower().endswith(".pdf"):
        text = load_pdf_text(input_data)
    else:
        text = input_data

    if not text.strip():
        return []

    chunks = chunk_text(text)
    top_chunks = retrieve_top_k("security incident breach attack", chunks)
    context = "\n".join(top_chunks)

    incidents = extract_incidents(context)
    return incidents

if __name__ == "__main__":
    x = input("Enter text OR pdf path:\n")
    result = run_rag_pipeline(x)
    print(json.dumps(result, indent=2))