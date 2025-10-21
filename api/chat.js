const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { message } = req.body;

    // Step 1: Embed user query
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message,
    });
    const queryEmbedding = embeddingRes.data[0].embedding;

    // Step 2: Get matches
    const { data: matches, error } = await supabase.rpc("match_whops", {
      query_embedding: queryEmbedding,
      match_threshold: 0.6,
      match_count: 10,
    });
    if (error) throw error;

    // Step 3: Only include products with valid affiliate links
    const validMatches = (matches || []).filter(
      (m) => m.affiliate_link && m.affiliate_link.trim() !== ""
    );

    if (validMatches.length === 0) {
      return res.status(200).json({
        response:
          "Sorry, I couldn’t find any verified Whop products with affiliate links that fit your request yet. Please check back soon!",
        matches: [],
      });
    }

    const topMatches = validMatches.slice(0, 3);

    // Step 4: Build detailed product list for GPT
    const productList = topMatches
      .map(
        (m, i) =>
          `${i + 1}. ${m.title}\n` +
          `Headline: ${m.headline || "No headline"}\n` +
          `Price: ${m.price || "N/A"}\n` +
          `Rating: ${m.reviews_average || "N/A"}⭐ (${m.review_count || 0} reviews)\n` +
          `Members: ${m.member_count || "N/A"}\n` +
          `Affiliate Link: ${m.affiliate_link}\n`
      )
      .join("\n");

    const prompt = `
You are Whopify’s AI affiliate recommender.

Use ONLY the Whop products below — do NOT invent or mention products not listed.
Each product includes a verified affiliate link that must be used exactly as given.

User message:
"${message}"

Relevant Whop products:
${productList}

Write a friendly, detailed recommendation that:
- Highlights the top 2–3 best products for the user's goal
- References real stats (e.g. number of reviews, average rating, or member count)
- Explains *why* each one stands out
- Includes the provided affiliate links in markdown format ([Product Name](URL))
- Adds a confident but not pushy tone, with a bit of emoji for warmth
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const aiResponse = completion.choices[0].message.content;

    const enrichedMatches = topMatches.map((m) => ({
      title: m.title,
      headline: m.headline,
      price: m.price,
      rating: m.reviews_average,
      review_count: m.review_count,
      member_count: m.member_count,
      link: m.affiliate_link,
      logo: m.logo || m.image || null,
    }));

    res.status(200).json({
      response: aiResponse,
      matches: enrichedMatches,
    });
  } catch (err) {
    console.error("❌ Chat API error:", err);
    res.status(500).json({ error: err.message });
  }
};
