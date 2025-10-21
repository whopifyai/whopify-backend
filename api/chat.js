import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  try {
    const { message } = req.body;

    // Step 1: Embed the user message
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message,
    });
    const queryEmbedding = embeddingRes.data[0].embedding;

    // Step 2: Find similar Whops in Supabase
    const { data: matches, error } = await supabase.rpc("match_whops", {
      query_embedding: queryEmbedding,
      match_threshold: 0.6,
      match_count: 3,
    });
    if (error) throw error;

    // Step 3: Generate AI recommendation
    const context = matches
      .map((m) => `${m.title}: ${m.headline} — ${m.price}`)
      .join("\n");

    const prompt = `
You are Whopify's AI recommender. 
Based on this user's message: "${message}", 
recommend the best Whop products from the following list:

${context}

Return a short, natural-language recommendation.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    res.status(200).json({
      response: completion.choices[0].message.content,
      matches,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
