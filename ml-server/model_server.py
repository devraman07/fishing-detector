"""
Secure Browse Guard - Production ML Server
Enhanced with batch prediction, metrics, and improved error handling
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import tensorflow as tf
import pickle
import numpy as np
import os
import logging
import traceback
import time
from datetime import datetime
from typing import List, Dict, Any

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Configuration
MODEL_PATH = os.environ.get("MODEL_PATH", "model/phishing_model.h5")
TOKENIZER_PATH = os.environ.get("TOKENIZER_PATH", "model/tokenizer.pkl")
MAX_LEN = int(os.environ.get("MAX_LEN", "100"))
THRESHOLD = float(os.environ.get("THRESHOLD", "0.7"))
PORT = int(os.environ.get("PORT", "5001"))
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "32"))

# Global variables
model = None
tokenizer = None
model_load_time = None
request_count = 0
error_count = 0

# Metrics storage
metrics = {
    'total_requests': 0,
    'total_errors': 0,
    'avg_latency_ms': 0,
    'predictions': {'safe': 0, 'suspicious': 0}
}

def load_model():
    """Load model and tokenizer with error handling"""
    global model, tokenizer, model_load_time
    
    try:
        logger.info(f"Loading model from {MODEL_PATH}")
        model = tf.keras.models.load_model(MODEL_PATH)
        model_load_time = datetime.utcnow().isoformat()
        logger.info("Model loaded successfully")
        
        logger.info(f"Loading tokenizer from {TOKENIZER_PATH}")
        with open(TOKENIZER_PATH, "rb") as f:
            tokenizer = pickle.load(f)
        logger.info("Tokenizer loaded successfully")
        
        # Model warmup
        logger.info("Warming up model...")
        dummy = np.zeros((1, MAX_LEN))
        model.predict(dummy, verbose=0)
        logger.info("Model warmed up and ready")
        
        return True
        
    except Exception as e:
        logger.error(f"Failed to load model: {str(e)}")
        logger.error(traceback.format_exc())
        return False


def predict_single(url: str) -> Dict[str, Any]:
    """Predict phishing probability for a single URL"""
    seq = tokenizer.texts_to_sequences([url])
    padded = tf.keras.utils.pad_sequences(seq, maxlen=MAX_LEN)
    prediction = float(model.predict(padded, verbose=0)[0][0])
    result = "suspicious" if prediction > THRESHOLD else "safe"
    
    return {
        "url": url,
        "result": result,
        "confidence": prediction,
        "threshold": THRESHOLD
    }


def predict_batch(urls: List[str]) -> List[Dict[str, Any]]:
    """Batch prediction for multiple URLs"""
    sequences = tokenizer.texts_to_sequences(urls)
    padded = tf.keras.utils.pad_sequences(sequences, maxlen=MAX_LEN)
    predictions = model.predict(padded, verbose=0)
    
    results = []
    for i, url in enumerate(urls):
        confidence = float(predictions[i][0])
        result = "suspicious" if confidence > THRESHOLD else "safe"
        results.append({
            "url": url,
            "result": result,
            "confidence": confidence,
            "threshold": THRESHOLD
        })
    
    return results


def update_metrics(latency_ms: float, prediction: str, is_error: bool = False):
    """Update server metrics"""
    global metrics
    
    metrics['total_requests'] += 1
    if is_error:
        metrics['total_errors'] += 1
    else:
        metrics['predictions'][prediction] += 1
    
    n = metrics['total_requests']
    metrics['avg_latency_ms'] = (metrics['avg_latency_ms'] * (n - 1) + latency_ms) / n


@app.route("/health", methods=["GET"])
def health():
    """Enhanced health check with metrics"""
    health_data = {
        "status": "ok" if model is not None else "error",
        "model_loaded": model is not None,
        "model_load_time": model_load_time,
        "timestamp": datetime.utcnow().isoformat(),
        "config": {
            "threshold": THRESHOLD,
            "max_len": MAX_LEN,
            "batch_size": BATCH_SIZE
        },
        "metrics": {
            "total_requests": metrics['total_requests'],
            "total_errors": metrics['total_errors'],
            "avg_latency_ms": round(metrics['avg_latency_ms'], 2),
            "predictions": metrics['predictions'],
            "error_rate": round(metrics['total_errors'] / max(metrics['total_requests'], 1) * 100, 2)
        }
    }
    
    status_code = 200 if model is not None else 503
    return jsonify(health_data), status_code


@app.route("/scan", methods=["POST"])
def scan():
    """Single URL scan endpoint with latency tracking"""
    start_time = time.time()
    
    data = request.get_json(silent=True)
    if not data or not data.get("url"):
        update_metrics((time.time() - start_time) * 1000, '', True)
        return jsonify({"error": "Missing 'url' in request body"}), 422
    
    url = data["url"]
    
    try:
        result = predict_single(url)
        latency_ms = (time.time() - start_time) * 1000
        update_metrics(latency_ms, result['result'])
        
        logger.info(f"Scanned URL: {url[:50]}..., Result: {result['result']}, "
                   f"Confidence: {result['confidence']:.4f}, Latency: {latency_ms:.2f}ms")
        
        return jsonify({
            **result,
            "latency_ms": round(latency_ms, 2)
        })
        
    except Exception as e:
        latency_ms = (time.time() - start_time) * 1000
        update_metrics(latency_ms, '', True)
        
        logger.error(f"Prediction failed for URL {url}: {str(e)}")
        logger.error(traceback.format_exc())
        
        return jsonify({
            "error": "Prediction failed",
            "detail": str(e) if os.environ.get('DEBUG') else "Internal error"
        }), 500
@app.route("/scan/batch", methods=["POST"])
def scan_batch():
    """Batch URL scan endpoint"""
    start_time = time.time()
    
    data = request.get_json(silent=True)
    if not data or not data.get("urls"):
        return jsonify({"error": "Missing 'urls' array in request body"}), 422
    
    urls = data["urls"]
    
    if not isinstance(urls, list):
        return jsonify({"error": "'urls' must be an array"}), 422
    
    if len(urls) > BATCH_SIZE:
        return jsonify({"error": f"Batch size exceeds maximum of {BATCH_SIZE}"}), 422
    
    if len(urls) == 0:
        return jsonify({"results": []})
    
    try:
        results = predict_batch(urls)
        latency_ms = (time.time() - start_time) * 1000
        
        for result in results:
            update_metrics(latency_ms / len(urls), result['result'])
        
        logger.info(f"Batch scan completed: {len(urls)} URLs, Latency: {latency_ms:.2f}ms")
        
        return jsonify({
            "results": results,
            "count": len(urls),
            "latency_ms": round(latency_ms, 2)
        })
        
    except Exception as e:
        logger.error(f"Batch prediction failed: {str(e)}")
        logger.error(traceback.format_exc())
        
        return jsonify({
            "error": "Batch prediction failed",
            "detail": str(e) if os.environ.get('DEBUG') else "Internal error"
        }), 500


@app.route("/metrics", methods=["GET"])
def get_metrics():
    """Get server metrics"""
    return jsonify({
        "timestamp": datetime.utcnow().isoformat(),
        "metrics": metrics,
        "model": {
            "loaded": model is not None,
            "load_time": model_load_time,
            "threshold": THRESHOLD,
            "max_len": MAX_LEN
        }
    })


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404


@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal error: {str(error)}")
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    # Load model on startup
    if not load_model():
        logger.error("Failed to load model, exiting")
        exit(1)
    
    logger.info(f"Starting ML server on port {PORT}")
    app.run(host='0.0.0.0', port=PORT, debug=False)
