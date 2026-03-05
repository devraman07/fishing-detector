import { ZodError } from "zod";
import { validateUrl } from "../utils/validator.js";
import { callMLServer } from "../services/mlClient.js";
import { db } from "../db/db.js";
import { scanLogs } from "../db/schema.js";


const ScanControler = async( req, res)=> {
   try {
    const {url} = validateUrl(req.body);
    
    const prediction = callMLServer(url);
    
    await db.insert(scanLogs).values({
               url,
               result: prediction.result,
               confidence: prediction.confidence
           });
           res.json(prediction);
       

   } catch (error) {
      if (err instanceof ZodError) {
            return res.status(422).json({ error: err.errors[0].message });
        }
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("Scan route error:", message);
        res.status(500).json({ error: message });
    }
   }


   export default ScanControler;
