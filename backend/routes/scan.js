import express from "express";
import rateLimit from "express-rate-limit";
import ScanController from "../Controllers/scanController.js";

const router = express.Router();

const scanLimiter = rateLimit({
  windowMs: 60000,
  max: 30,
  message: { error: "Too many requests" }
});

router.post("/", scanLimiter, ScanController);



export default router;
