import dotenv from 'dotenv';
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY no está definida en el archivo .env');
}

export const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);