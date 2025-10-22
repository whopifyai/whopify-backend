const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
        response: "No matching Whops found yet — try a different topic!",
        matches: [],
      });
    }

    // Step 3: Build concise product info (now includes affiliate links)
    const context = matches
      .slice(0, 3)
      .map((m, i) => {
        const fullName = m.headline
          ? `${m.title} — ${m.headline}`
          : m.title;

        const rating =
          m.reviews_average && !isNaN(m.reviews_average)
            ? `⭐ ${m.reviews_average.toFixed(1)}/5`
            : "⭐ No rating yet";

        const reviews =
          m.review_count && !isNaN(m.review_count)
            ? `(${m.review_count} reviews)`
            : "";

        // Handle Free pricing explicitly
        let price = "";
        if (m.price) {
          const lower = m.price.toLowerCase();
          if (
            lower.includes("free") ||
            lower.includes("$0") ||
            lower === "0" ||
            lower === "0.00"
          ) {
            price = "— Free";
          } else {
            price = `— ${m.price}`;
          }
        }

        // ✅ Add affiliate link if available
        const affiliate =
          m.affiliate_link || m.affiliateLink
            ? `\n🔗 ${m.affiliate_link || m.affiliateLink}`
            : "";

        return `${i + 1}.) ${fullName}\n${rating} ${reviews} ${price}${affiliate}\n`;
      })
      .join("\n");

    // Step 4: Keep prompt simple and structured
    const prompt = `
You are Whopify's recommender bot. 
Based on the user's message "${message}", return ONLY these top 3 Whop products in this exact structured format:
1.) Title — Headline
⭐ 4.8/5 (120 reviews) — $199
(no explanations or extra text)

Here are the top matches to display:
${context}
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
