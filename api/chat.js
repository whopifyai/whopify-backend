const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  // ✅ Allow requests from Framer
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { message } = req.body;

    // ✅ Create embedding for user query
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message,
    });
    const queryEmbedding = embeddingRes.data[0].embedding;

    // ✅ Query Supabase function
    const { data: matches, error } = await supabase.rpc("match_whops", {
      query_embedding: queryEmbedding,
      match_threshold: 0.6,
      match_count: 3,
    });
    if (error) throw error;

    // ✅ Build affiliate context
    const affiliateUser = "wapify"; // <–– your affiliate username
    const context = matches
      .map(
        (m) =>
          `${m.title}: ${m.headline || ""}\n` +
          `Price: ${m.price || "N/A"}\n` +
          `Affiliate link: https://whop.com/${m.route}?a=${affiliateUser}`
      )
      .join("\n\n");

    // ✅ Richer AI prompt
    const prompt = `
You are Whopify’s affiliate recommender AI.

A user said: "${message}"

Here are the most relevant Whop products:
${context}

Create a conversational, persuasive reply that:
- Explains the best options for their goals
- Mentions product names naturally
- Includes clickable affiliate links
- Uses a helpful, friendly tone (not salesy)
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    res.status(200).json({
      response: completion.choices[0].message.content,
      matches: matches.map((m) => ({
        title: m.title,
        headline: m.headline,
        price: m.price,
        link: `https://whop.com/${m.route}?a=${affiliateUser}`,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
