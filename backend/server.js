import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import scanRoute from "./routes/scan.js";
dotenv.config();
const app = express();

app.use(cors());

app.use(express.json());

app.use("/api/scan", scanRoute);

app.get("/", (_req, res) => {
    res.send("Secure Browse Guard Backend Running");
});

app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
});
const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
