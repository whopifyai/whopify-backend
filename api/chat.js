const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async (req, res) => {
  // --- Add CORS headers ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { message } = req.body;

    // Create embedding for user query
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message,
    });
    const queryEmbedding = embeddingRes.data[0].embedding;

    // Query Supabase for the top matching Whops
    const { data: matches, error } = await supabase.rpc("match_whops", {
      query_embedding: queryEmbedding,
      match_threshold: 0.6,
      match_count: 3,
    });
    if (error) throw error;

    // Build text context for AI to summarize
    const context = matches
      .map((m) => {
        const avg = m.reviews_average ? `${m.reviews_average.toFixed(2)}⭐` : "no reviews yet";
        const count = m.review_count ? `(${m.review_count} reviews)` : "";
        return `${m.title}: ${m.headline || "No headline provided"} — ${m.price || "Price N/A"} — ${avg} ${count}`;
      })
      .join("\n");

    const prompt = `
You are Whopify's AI recommender.
Based on this user's message: "${message}",
recommend the best Whop products from the following list:

${context}

For each, include whether it has reviews or not.
Return a natural, friendly recommendation paragraph (not a bullet list).
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
};
