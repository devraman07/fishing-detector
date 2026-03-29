from flask import Flask, request, jsonify
from flask_cors import CORS
import tensorflow as tf
import pickle
import numpy as np
import os
import logging
import traceback

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

MODEL_PATH = os.environ.get("MODEL_PATH", "model/phishing_model.h5")
TOKENIZER_PATH = os.environ.get("TOKENIZER_PATH", "model/tokenizer.pkl")

# Load trained model
logger.info(f"Loading model from {MODEL_PATH}")
model = tf.keras.models.load_model(MODEL_PATH)
logger.info("Model loaded successfully")

# Load tokenizer
logger.info(f"Loading tokenizer from {TOKENIZER_PATH}")
with open(TOKENIZER_PATH, "rb") as f:
    tokenizer = pickle.load(f)
logger.info("Tokenizer loaded successfully")

MAX_LEN = 100
THRESHOLD = float(os.environ.get("THRESHOLD", "0.7"))

# Model warmup - make a dummy prediction so the first real request is fast
logger.info("Warming up model...")
dummy = np.zeros((1, MAX_LEN))
model.predict(dummy, verbose=0)
logger.info("Model warmed up and ready.")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({ "status": "ok", "model_loaded": model is not None }), 200


@app.route("/scan", methods=["POST"])
def scan():
    data = request.get_json(silent=True)
    if not data or not data.get("url"):
        return jsonify({"error": "Missing 'url' in request body"}), 422

    url = data["url"]

    try:
        # Convert URL to sequence
        seq = tokenizer.texts_to_sequences([url])
        # Use keras.utils.pad_sequences (pad_sequences in preprocessing is deprecated)
        padded = tf.keras.utils.pad_sequences(seq, maxlen=MAX_LEN)

        # Predict probability
        prediction = float(model.predict(padded, verbose=0)[0][0])

        result = "suspicious" if prediction > THRESHOLD else "safe"

        logger.info(f"Scanned URL: {url}, Result: {result}, Confidence: {prediction:.4f}")

        return jsonify({
            "url": url,
            "result": result,
            "confidence": prediction
        })
    except Exception as e:
        logger.error(f"Prediction failed for URL {url}: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({ "error": "Prediction failed", "detail": str(e) }), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    logger.info(f"Starting ML server on port {port}")
    app.run(port=port, debug=False)
