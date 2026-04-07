/**
 * Secure Browse Guard - URL Heuristics
 * Lightweight local detection for instant blocking
 */

// Suspicious TLDs commonly used in phishing
const SUSPICIOUS_TLDS = [
  '.xyz', '.tk', '.ml', '.ga', '.cf', '.top', '.work', '.date', 
  '.click', '.link', '.party', '.racing', '.review', '.science',
  '.country', '.download', '.gdn', '.kim', '.men', '. loan',
  '.mobi', '.ninja', '.ooo', '.pictures', '.pw', '.review', '.rocks',
  '.space', '.stream', '.tech', '.today', '.trade', '.uno', '.viajes',
  '.webcam', '.win', '.world'
];

// Keywords commonly found in phishing URLs
const PHISHING_KEYWORDS = [
  'login', 'signin', 'sign-in', 'verify', 'verification', 'secure', 
  'account', 'update', 'confirm', 'validation', 'authenticate',
  'password', 'credential', 'billing', 'payment', 'wallet',
  'suspended', 'locked', 'limited', 'unusual', 'activity',
  'recover', 'restore', 'unlock', 'appeal', 'case',
  'banking', 'paypal', 'apple', 'microsoft', 'amazon', 'google',
  'facebook', 'instagram', 'twitter', 'linkedin', 'netflix',
  'security', 'alert', 'warning', 'fraud', 'suspicious'
];

// Suspicious URL patterns
const SUSPICIOUS_PATTERNS = [
  /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/, // IP-based URLs
  /@[^/]+\//, // URLs with @ symbol (credential stuffing)
  /(login|signin|verify|secure|account)\d*\./i, // Numbered domains
  /(\.\d{2,}){2,}/, // Multiple numeric subdomains
];

/**
 * Calculate Shannon entropy of a string
 */
function calculateEntropy(str) {
  const len = str.length;
  if (len === 0) return 0;
  
  const freq = {};
  for (const char of str) {
    freq[char] = (freq[char] || 0) + 1;
  }
  
  return Object.values(freq).reduce((sum, count) => {
    const p = count / len;
    return sum - p * Math.log2(p);
  }, 0);
}

/**
 * Check if string contains random/high-entropy sequences
 */
function hasHighEntropy(str, threshold = 4.0) {
  // Check for long random-looking substrings
  const segments = str.split(/[.-/]/);
  for (const segment of segments) {
    if (segment.length >= 10) {
      const entropy = calculateEntropy(segment);
      if (entropy > threshold) return true;
    }
  }
  return false;
}

/**
 * Count character repetitions (suspicious in phishing URLs)
 */
function countCharRepetition(str) {
  let maxRepetition = 0;
  let currentRepetition = 1;
  
  for (let i = 1; i < str.length; i++) {
    if (str[i] === str[i-1]) {
      currentRepetition++;
      maxRepetition = Math.max(maxRepetition, currentRepetition);
    } else {
      currentRepetition = 1;
    }
  }
  
  return maxRepetition;
}

/**
 * Calculate heuristic score for a URL
 * Returns: { score, isSuspicious, reasons, threshold }
 */
export function calculateHeuristicScore(url) {
  const reasons = [];
  let score = 0;
  
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname.toLowerCase();
    const fullUrl = url.toLowerCase();
    
    // 1. Suspicious TLD check (0-25 points)
    for (const tld of SUSPICIOUS_TLDS) {
      if (domain.endsWith(tld)) {
        score += 25;
        reasons.push(`Suspicious TLD: ${tld}`);
        break;
      }
    }
    
    // 2. URL length check (0-15 points)
    if (url.length > 150) {
      score += 10;
      reasons.push('Very long URL');
    }
    if (url.length > 250) {
      score += 5;
      reasons.push('Extremely long URL');
    }
    
    // 3. High entropy/random strings (0-20 points)
    if (hasHighEntropy(domain)) {
      score += 20;
      reasons.push('Random-looking domain (high entropy)');
    }
    
    // 4. Character repetition (0-10 points)
    const repetition = countCharRepetition(domain);
    if (repetition >= 4) {
      score += 10;
      reasons.push('Suspicious character repetition');
    }
    
    // 5. Phishing keywords in domain (0-20 points)
    for (const keyword of PHISHING_KEYWORDS) {
      if (domain.includes(keyword)) {
        score += 20;
        reasons.push(`Phishing keyword in domain: "${keyword}"`);
        break;
      }
    }
    
    // 6. Phishing keywords in path (0-10 points)
    let pathKeywordsFound = 0;
    for (const keyword of PHISHING_KEYWORDS) {
      if (pathname.includes(keyword)) {
        pathKeywordsFound++;
        if (pathKeywordsFound <= 2) {
          score += 5;
          reasons.push(`Phishing keyword in path: "${keyword}"`);
        }
      }
    }
    
    // 7. IP-based URL (0-25 points)
    if (/^\d+\.\d+\.\d+\.\d+$/.test(urlObj.hostname)) {
      score += 25;
      reasons.push('IP-based URL (no domain)');
    }
    
    // 8. Suspicious patterns (0-15 points each)
    if (/@[^/]+\//.test(fullUrl)) {
      score += 15;
      reasons.push('URL contains @ symbol (credential stuffing risk)');
    }
    
    if (/(login|signin|verify|secure|account)\d+\./i.test(domain)) {
      score += 15;
      reasons.push('Domain with numbered keywords');
    }
    
    // 9. HTTPS check (negative points for secure sites)
    if (urlObj.protocol === 'https:') {
      score -= 5;
    }
    
    // 10. Too many subdomains (0-10 points)
    const subdomainCount = domain.split('.').length - 2; // exclude domain and TLD
    if (subdomainCount > 3) {
      score += 10;
      reasons.push('Excessive subdomains');
    }
    
    // Cap score at 100
    score = Math.min(100, Math.max(0, score));
    
  } catch (error) {
    // Invalid URL
    return { score: 100, isSuspicious: true, reasons: ['Invalid URL format'], threshold: 50 };
  }
  
  // Determine if suspicious (threshold: 50)
  const THRESHOLD = 50;
  const isSuspicious = score >= THRESHOLD;
  
  return {
    score,
    isSuspicious,
    reasons,
    threshold: THRESHOLD,
    risk: score >= 75 ? 'HIGH' : score >= 50 ? 'MEDIUM' : score >= 25 ? 'LOW' : 'MINIMAL'
  };
}

/**
 * Quick check - returns true if URL is clearly suspicious
 * Use for immediate blocking without API call
 */
export function isClearlySuspicious(url) {
  const result = calculateHeuristicScore(url);
  return result.isSuspicious;
}

/**
 * Get risk level for display
 */
export function getRiskLevel(score) {
  if (score >= 75) return { level: 'CRITICAL', color: '#dc2626' };
  if (score >= 50) return { level: 'HIGH', color: '#ea580c' };
  if (score >= 25) return { level: 'MEDIUM', color: '#ca8a04' };
  return { level: 'LOW', color: '#16a34a' };
}
