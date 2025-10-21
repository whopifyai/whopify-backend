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
    // Handle preflight request
    return res.status(200).end();
  }

  try {
    const { message } = req.body;

    // Step 1: Create embedding for user query
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message,
    });
    const queryEmbedding = embeddingRes.data[0].embedding;

    // Step 2: Query Supabase
    const { data: matches, error } = await supabase.rpc("match_whops", {
      query_embedding: queryEmbedding,
      match_threshold: 0.6,
      match_count: 3,
    });
    if (error) throw error;

    // Step 3: Build a context string for the AI prompt
    const context = matches
      .map((m) => {
        let ratingText;
        if (m.reviews_average && !isNaN(m.reviews_average)) {
          ratingText = `Rated ${m.reviews_average.toFixed(1)}/5 stars`;
        } else {
          ratingText = "No reviews yet";
        }

        return `${m.title}: ${m.headline || "No headline provided"} — ${m.price || "Price N/A"} — ${ratingText}`;
      })
      .join("\n");

    // Step 4: AI recommendation prompt
    const prompt = `
You are Whopify's AI recommender.
Based on this user's message: "${message}",
recommend the best Whop products from the following list:

${context}

For each recommended product, mention its star rating (e.g., 4.7/5 stars) or note that it has no reviews.
Return a short, natural-language response that feels personalized and friendly.
`;

    // Step 5: Generate the AI response
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
