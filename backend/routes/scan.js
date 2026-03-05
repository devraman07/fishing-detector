import express from "express";
import ScanControler from "../Controllers/scanController.js";

const router = express.Router();



router.post("/", ScanControler);



export default router;
