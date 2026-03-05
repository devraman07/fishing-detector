import axios from "axios";
const ML_SERVER_URL = process.env.ML_SERVER_URL ?? "http://127.0.0.1:5001";
export async function callMLServer(url) {
    const response = await axios.post(`${ML_SERVER_URL}/scan`, { url }, { timeout: 10000 });
    return response.data;
}


