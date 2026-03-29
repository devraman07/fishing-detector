import { ZodError } from "zod";
import { validateUrl } from "../utils/validator.js";
import { callMLServer } from "../services/mlClient.js";
import { db } from "../db/db.js";
import { scanLogs } from "../db/schema.js";

// In-memory scan result cache
const scanCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

const ScanController = async( req, res)=> {
   try {
    const {url} = validateUrl(req.body);
    
    // Additional URL validation
    try { new URL(url); } catch { return res.status(400).json({ error: "Invalid URL" }); }
    if (url.length > 2048) return res.status(400).json({ error: "URL too long" });
    
    // Check cache first
    const cached = scanCache.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json({ ...cached.result, cached: true });
    }
    
    const prediction = await callMLServer(url);
    
    // Store in cache
    scanCache.set(url, { result: prediction, timestamp: Date.now() });
    
    await db.insert(scanLogs).values({
               url,
               result: prediction.result,
               confidence: prediction.confidence
           });
           res.json(prediction);
       

   } catch (error) {
      if (error instanceof ZodError) {
            return res.status(422).json({ error: error.errors[0].message });
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Scan route error:", message);
        res.status(500).json({ error: message });
    }
   }


   export default ScanController;
