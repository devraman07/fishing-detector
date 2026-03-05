from flask import Flask, request, jsonify
from flask_cors import CORS
import tensorflow as tf
import pickle
import numpy as np
import os

app = Flask(__name__)
CORS(app)

MODEL_PATH = os.environ.get("MODEL_PATH", "model/phishing_model.h5")
TOKENIZER_PATH = os.environ.get("TOKENIZER_PATH", "model/tokenizer.pkl")

# Load trained model
model = tf.keras.models.load_model(MODEL_PATH)

# Load tokenizer
with open(TOKENIZER_PATH, "rb") as f:
    tokenizer = pickle.load(f)

MAX_LEN = 100
THRESHOLD = float(os.environ.get("THRESHOLD", "0.7"))


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/scan", methods=["POST"])
def scan():
    data = request.get_json(silent=True)
    if not data or not data.get("url"):
        return jsonify({"error": "Missing 'url' in request body"}), 422

    url = data["url"]

    # Convert URL to sequence
    seq = tokenizer.texts_to_sequences([url])
    # Use keras.utils.pad_sequences (pad_sequences in preprocessing is deprecated)
    padded = tf.keras.utils.pad_sequences(seq, maxlen=MAX_LEN)

    # Predict probability
    prediction = float(model.predict(padded, verbose=0)[0][0])

    result = "suspicious" if prediction > THRESHOLD else "safe"

    return jsonify({
        "url": url,
        "result": result,
        "confidence": prediction
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(port=port, debug=False)
