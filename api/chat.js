const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  // --- Allow CORS for Framer / frontend ---
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
      match_count: 5,
    });
    if (error) throw error;

    if (!matches || matches.length === 0) {
      return res.status(200).json({
        response: "Hmm, I couldn’t find any good Whop matches just yet. Try rephrasing your question!",
        matches: [],
      });
    }

    const topMatches = matches.slice(0, 3);

    // Step 3: Build context for GPT — include placeholder when no link exists
    const productList = topMatches
      .map((m, i) => {
        const linkText = m.affiliate_link
          ? m.affiliate_link
          : "Link not available yet — I’ll come back with a link soon!";
        return (
          `${i + 1}. ${m.title}\n` +
          `Headline: ${m.headline || "No headline"}\n` +
          `Price: ${m.price || "N/A"}\n` +
          `Rating: ${m.reviews_average || "N/A"}⭐ (${m.review_count || 0} reviews)\n` +
          `Members: ${m.member_count || "N/A"}\n` +
          `Affiliate Link: ${linkText}\n`
        );
      })
      .join("\n");

    // Step 4: Instruction prompt
    const prompt = `
You are Whopify’s AI affiliate recommender.

Use ONLY the Whop products provided below — do NOT invent or mention products that are not in the list.
If a product’s affiliate link is missing, write "I'll come back with a link soon" in place of the link.

User message:
"${message}"

Relevant Whop products:
${productList}

Write a friendly, rich, natural-language recommendation that:
- Mentions 2–3 of the best products for the user’s goal
- Highlights helpful real stats (ratings, reviews, or members)
- Includes the affiliate links or placeholder text in markdown ([Product Name](URL) or "I’ll come back with a link soon")
- Sounds confident but human, adding emoji for warmth and excitement
`;

    // Step 5: Generate AI response
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const aiResponse = completion.choices[0].message.content;

    // Step 6: Return structured JSON
    const enrichedMatches = topMatches.map((m) => ({
      title: m.title,
      headline: m.headline,
      price: m.price,
      rating: m.reviews_average,
      review_count: m.review_count,
      member_count: m.member_count,
      link: m.affiliate_link || "Link not available yet — I’ll come back with a link soon!",
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
