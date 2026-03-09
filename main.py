from flask import Flask, render_template, jsonify

app = Flask(__name__)

@app.route("/")
def index():
    return