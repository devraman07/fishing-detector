import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import scanRoute from "./routes/scan.js";
dotenv.config();
const app = express();

app.use(cors());

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'];
app.use(cors({ origin: allowedOrigins, credentials: true }));

app.use(express.json());

app.use("/api/scan", scanRoute);

app.get("/", (_req, res) => {
    res.send("Secure Browse Guard Backend Running");
});

app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
});

// Health check for ML server on startup
const checkML = async () => {
  const mlUrl = process.env.ML_SERVER_URL || "http://127.0.0.1:5001";
  try {
    await axios.get(`${mlUrl}/health`, { timeout: 5000 });
    console.log("ML server connected");
  } catch {
    console.warn("WARNING: ML server not reachable on startup");
  }
};

checkML();

const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
