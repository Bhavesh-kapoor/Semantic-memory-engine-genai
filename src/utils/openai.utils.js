import OpenAI from "openai";
import APP_CONFIG from "./config.utils.js";

let OpenAIClient = new OpenAI({ apiKey: APP_CONFIG.OPENAI_API_KEY })
export default OpenAIClient 