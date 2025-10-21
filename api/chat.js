const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async (req, res) => {
  // --- Add CORS headers ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { message } = req.body;

    // Step 1: Create embedding
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message,
    });
    const queryEmbedding = embeddingRes.data[0].embedding;

    // Step 2: Query Supabase for top 3 matches
    const { data: matches, error } = await supabase.rpc("match_whops", {
      query_embedding: queryEmbedding,
      match_threshold: 0.3,
      match_count: 3,
    });
    if (error) throw error;

    if (!matches || matches.length === 0) {
      return res.status(200).json({
        response: "Hmm, I couldn’t find any Whops that match that yet — try rephrasing!",
        matches: [],
      });
    }

    // Step 3: Format top 3 results with title + headline
    const context = matches
      .slice(0, 3)
      .map((m, i) => {
        const rating =
          m.reviews_average && !isNaN(m.reviews_average)
            ? `${m.reviews_average.toFixed(1)}/5 stars`
            : "no reviews yet";

        const productName = m.headline
          ? `${m.title}'s ${m.headline}`
          : m.title;

        return `(${i + 1}) ${productName} — ${m.price || "N/A"} — ${rating}`;
      })
      .join("\n");

    // Step 4: Strong prompt to enforce real Whops and structure
    const prompt = `
You are Whopify's AI recommender.
ONLY use the following 3 products listed below — do NOT invent new ones.

User message: "${message}"

Here are the top 3 matching Whop products:
${context}

Write a short, conversational recommendation paragraph that:
- Describes why each product fits the user's goal.
- Uses each product’s full name (title + headline).
- Includes its (x.x/5) star rating or "no reviews yet".
- Mentions the price naturally.
Do not list more than 3 products.
`;

    // Step 5: Generate response
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
