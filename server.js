import { z } from "zod";
import axios from "axios";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config(); 
import { StateGraph, START, END } from "@langchain/langgraph";
import { GoogleGenerativeAI } from "@google/generative-ai";

// 1) Define state schema using Zod
const schema = z.object({
  amount_usd: z.number(),
  rate: z.number().optional(),
  total_inr: z.number().optional(),
  ai_summary: z.string().optional(),
  slack_status: z.string().optional(),
  email_status: z.string().optional(),
});

// 2) Create the graph with Zod schema
const graph = new StateGraph(schema);

// 3) Fetch rate using API key
async function fetchRate(state) {
  try {
    const res = await axios.get("https://api.exchangerate.host/live?access_key="+ process.env.API_KEY);
    //console.log(res.data);
    const rate = res?.data?.quotes?.USDINR;
    if (typeof rate === "number") return { rate };
    throw new Error("Invalid rate from API");
  } catch (err) {
    console.error("⚠️ API fetch failed:", err.message);
    return { rate: 85 }; // fallback
  }
}

// Convert amount
function convertAmount(state) {
  return { total_inr: state.amount_usd * state.rate };
}

// Summarize using Gemini 2.5 Pro
async function summarize(state) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

    const prompt = `Summarize this currency conversion in one short sentence:
    USD ${state.amount_usd} at rate ${state.rate} equals INR ${state.total_inr}.`;

    const result = await model.generateContent(prompt);
    console.log(result);
    const ai_summary = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text
      || "Conversion completed.";
    
    return { ai_summary };
  } catch (err) {
    console.error("⚠️ Gemini API failed:", err.message);
    return { ai_summary: `USD ${state.amount_usd} at rate ${state.rate} = INR ${state.total_inr}.` };
  }
}

// Simulate sending to Slack
async function sendToSlack(state) {
  console.log("Slack:", state.ai_summary);
  return { slack_status: "sent" };
}

// Simulate sending Email
async function sendEmail(state) {
  console.log("Email:", state.ai_summary);
  return { email_status: "sent" };
}

// 4) Register nodes
graph.addNode("fetch_rate", fetchRate);
graph.addNode("convert_amount", convertAmount);
graph.addNode("summarize", summarize);
graph.addNode("send_slack", sendToSlack);
graph.addNode("send_email", sendEmail);

// 5) Define edges (includes a parallel fan-out after summarize)
graph.addEdge(START, "fetch_rate");
graph.addEdge("fetch_rate", "convert_amount");
graph.addEdge("convert_amount", "summarize");
graph.addEdge("summarize", "send_slack");
graph.addEdge("summarize", "send_email");
graph.addEdge("send_slack", END);
graph.addEdge("send_email", END);

// 6) Compile and run
const workflow = graph.compile();
const result = await workflow.invoke({ amount_usd: 100 });
console.log("\n Final State:", result);

// 7) Manual Mermaid diagram (works across all package versions)
const edges = [
  { from: "START", to: "fetch_rate" },
  { from: "fetch_rate", to: "convert_amount" },
  { from: "convert_amount", to: "summarize" },
  { from: "summarize", to: "send_slack" },
  { from: "summarize", to: "send_email" },
  { from: "send_slack", to: "END" },
  { from: "send_email", to: "END" },
];

let mermaid = "graph TD\n";
for (const e of edges) mermaid += `  ${e.from} --> ${e.to}\n`;

fs.writeFileSync("graph.mmd", mermaid);
console.log("\n📊 Mermaid diagram saved to graph.mmd (paste into https://mermaid.live)");