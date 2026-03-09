"""
app.py – Flask application for AI Structured Incident Report Generator (UC #21)
Integrates the RAG pipeline from github.com/Divagar03/Ragworks
"""
from flask import Flask, request, jsonify, render_template
from pydantic import BaseModel, ValidationError, field_validator
from rag_engine import run_rag_pipeline

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB


# ── Pydantic validation (R3) ──────────────────────────────────
class IncidentModel(BaseModel):
    incident_id:   str
    date:          str
    location:      str = "Unknown"
    incident_type: str
    severity:      str
    description:   str
    citation:      dict = {}

    @field_validator("severity")
    @classmethod
    def check_severity(cls, v: str) -> str:
        allowed = {"Critical", "High", "Medium", "Low", "Informational"}
        # Accept any capitalisation from the LLM
        titled = v.strip().title()
        if titled in allowed:
            return titled
        return v   # pass through; we warn but don't reject


# ── Routes ─────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/extract", methods=["POST"])
def extract():
    """
    Upload a .pdf or .txt report.
    Runs the full RAG pipeline and returns structured incidents.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400

    ext = file.filename.rsplit(".", 1)[-1].lower()
    if ext not in ("pdf", "txt"):
        return jsonify({"error": "Only .pdf and .txt files are supported"}), 400

    try:
        file_bytes = file.read()
        raw_incidents = run_rag_pipeline(file_bytes, file.filename)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    validated, errors = [], []
    for i, item in enumerate(raw_incidents):
        try:
            model = IncidentModel(**item)
            validated.append(model.model_dump())
        except (ValidationError, TypeError) as exc:
            errors.append(f"Item #{i}: {exc}")
            validated.append(item)   # include raw even if invalid

    return jsonify({"incidents": validated, "validation_errors": errors})


@app.route("/api/visualize", methods=["POST"])
def visualize():
    """
    Accept a pre-extracted JSON array (paste flow).
    Body: { "incidents": [...] }  or bare array.
    Returns validated incidents + warnings.
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Invalid JSON body"}), 400

    array = body if isinstance(body, list) else body.get("incidents", [])
    if not isinstance(array, list):
        return jsonify({"error": "'incidents' must be a JSON array"}), 400

    validated, errors = [], []
    for i, item in enumerate(array):
        try:
            model = IncidentModel(**item)
            validated.append(model.model_dump())
        except (ValidationError, TypeError) as exc:
            errors.append(f"Item #{i} ({item.get('incident_id','?')}): {exc}")
            validated.append(item)

    return jsonify({"incidents": validated, "validation_errors": errors})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
