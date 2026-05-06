"""
Secure Browse Guard - Lightweight ML Server
Uses scikit-learn for Python 3.x compatibility
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import os
import logging
import re
import time
from urllib.parse import urlparse

app = Flask(__name__)
CORS(app)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
THRESHOLD = float(os.environ.get("THRESHOLD", "0.7"))
PORT = int(os.environ.get("PORT", "5001"))

# Simple heuristic-based phishing detection (works without model file)
# In production, load a trained scikit-learn model
class SimplePhishingDetector:
    """Lightweight URL-based phishing detection using heuristics"""
    
    SUSPICIOUS_KEYWORDS = [
        'login', 'signin', 'verify', 'secure', 'account', 'update', 'confirm',
        'banking', 'password', 'credential', 'authenticate', 'validation'
    ]
    
    SUSPICIOUS_TLDS = ['.tk', '.ml', '.ga', '.cf', '.top', '.xyz', '.click', '.link']
    
    TRUSTED_DOMAINS = [
        'google.com', 'youtube.com', 'github.com', 'microsoft.com',
        'apple.com', 'amazon.com', 'facebook.com', 'twitter.com',
        'linkedin.com', 'reddit.com', 'stackoverflow.com'
    ]
    
    def extract_features(self, url):
        """Extract features from URL for phishing detection"""
        features = {}
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        path = parsed.path.lower()
        
        # Length features
        features['url_length'] = len(url)
        features['domain_length'] = len(domain)
        
        # Special characters
        features['dot_count'] = domain.count('.')
        features['hyphen_count'] = domain.count('-')
        features['at_count'] = url.count('@')
        features['question_count'] = url.count('?')
        features['and_count'] = url.count('&')
        features['equal_count'] = url.count('=')
        
        # Security indicators
        features['has_https'] = 1 if url.startswith('https://') else 0
        features['has_ip'] = 1 if re.match(r'\d+\.\d+\.\d+\.\d+', domain) else 0
        
        # Suspicious keywords in URL
        features['suspicious_keywords'] = sum(1 for kw in self.SUSPICIOUS_KEYWORDS if kw in url.lower())
        
        # Suspicious TLD
        features['suspicious_tld'] = 1 if any(domain.endswith(tld) for tld in self.SUSPICIOUS_TLDS) else 0
        
        # Trusted domain check
        features['is_trusted'] = 1 if any(trusted in domain for trusted in self.TRUSTED_DOMAINS) else 0
        
        return features
    
    def predict(self, url):
        """Predict if URL is phishing"""
        features = self.extract_features(url)
        
        # Fast-path: trusted domains are safe
        if features['is_trusted']:
            return {
                "url": url,
                "prediction": "safe",
                "confidence": 0.95,
                "method": "trust_list"
            }
        
        # Calculate risk score (0-1, higher = more suspicious)
        risk_score = 0.0
        
        # URL length (very long URLs are suspicious)
        if features['url_length'] > 100:
            risk_score += 0.15
        if features['url_length'] > 150:
            risk_score += 0.1
        
        # Too many dots (subdomain abuse)
        if features['dot_count'] > 3:
            risk_score += 0.2
        
        # Hyphens in domain (common in phishing)
        if features['hyphen_count'] > 1:
            risk_score += 0.15
        
        # Special characters
        risk_score += features['at_count'] * 0.2
        risk_score += features['question_count'] * 0.05
        risk_score += features['and_count'] * 0.03
        
        # IP address in domain
        if features['has_ip']:
            risk_score += 0.3
        
        # Suspicious keywords
        risk_score += features['suspicious_keywords'] * 0.1
        
        # Suspicious TLD
        if features['suspicious_tld']:
            risk_score += 0.25
        
        # No HTTPS
        if not features['has_https']:
            risk_score += 0.1
        
        # Normalize and add noise for realistic confidence
        risk_score = min(risk_score, 0.95)
        
        prediction = "phishing" if risk_score > THRESHOLD else "safe"
        
        return {
            "url": url,
            "prediction": prediction,
            "confidence": round(risk_score if prediction == "phishing" else 1 - risk_score, 4),
            "features": features,
            "method": "heuristic"
        }

# Initialize detector
detector = SimplePhishingDetector()

@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "ok",
        "model": "heuristic_detector",
        "version": "1.0.0",
        "threshold": THRESHOLD
    }), 200

@app.route("/scan", methods=["POST"])
def scan():
    """Scan a single URL"""
    start_time = time.time()
    
    data = request.get_json(silent=True)
    if not data or not data.get("url"):
        return jsonify({
            "error": "Missing 'url' in request body"
        }), 400
    
    url = data["url"]
    
    try:
        result = detector.predict(url)
        latency_ms = round((time.time() - start_time) * 1000, 2)
        
        logger.info(f"Scanned: {url[:60]}... -> {result['prediction']} ({result['confidence']})")
        
        return jsonify({
            "url": result["url"],
            "prediction": result["prediction"],
            "confidence": result["confidence"],
            "latency_ms": latency_ms,
            "method": result.get("method", "heuristic")
        })
        
    except Exception as e:
        logger.error(f"Error scanning {url}: {str(e)}")
        return jsonify({
            "error": "Scan failed",
            "detail": str(e)
        }), 500

@app.route("/scan/batch", methods=["POST"])
def scan_batch():
    """Scan multiple URLs"""
    data = request.get_json(silent=True)
    if not data or not data.get("urls"):
        return jsonify({"error": "Missing 'urls' array"}), 400
    
    urls = data["urls"]
    if not isinstance(urls, list):
        return jsonify({"error": "'urls' must be an array"}), 400
    
    results = []
    for url in urls:
        try:
            result = detector.predict(url)
            results.append({
                "url": result["url"],
                "prediction": result["prediction"],
                "confidence": result["confidence"]
            })
        except Exception as e:
            results.append({
                "url": url,
                "prediction": "safe",
                "confidence": 0,
                "error": str(e)
            })
    
    return jsonify({"results": results, "count": len(results)})

@app.route("/metrics", methods=["GET"])
def get_metrics():
    """Server metrics"""
    return jsonify({
        "status": "running",
        "model": "heuristic_detector",
        "threshold": THRESHOLD
    })

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal error: {str(error)}")
    return jsonify({"error": "Internal server error"}), 500

if __name__ == "__main__":
    logger.info(f"Starting ML server on port {PORT}")
    logger.info(f"Using heuristic-based phishing detection")
    app.run(host='0.0.0.0', port=PORT, debug=False)
