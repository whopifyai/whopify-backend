const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

// Initialize clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  // --- CORS for Framer ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { message } = req.body;
    const affiliateUser = "wapify"; // ✅ your affiliate username

    // --- Step 1: Embed user query ---
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message,
    });
    const queryEmbedding = embeddingRes.data[0].embedding;

    // --- Step 2: Match relevant Whops ---
    const { data: matches, error } = await supabase.rpc("match_whops", {
      query_embedding: queryEmbedding,
      match_threshold: 0.6,
      match_count: 3,
    });
    if (error) throw error;

    // --- Step 3: Build safe, valid affiliate URLs ---
    const buildLink = (m) => {
      const companyRoute = m.company_route || m.company?.route || "";
      const productRoute = m.route || "";
      if (!companyRoute || !productRoute) return null;
      return `https://whop.com/${companyRoute}/${productRoute}?a=${affiliateUser}`;
    };

    const productList = matches
      .map(
        (m, i) =>
          `${i + 1}. ${m.title}\n` +
          `Headline: ${m.headline || "No headline"}\n` +
          `Price: ${m.price || "N/A"}\n` +
          `Affiliate Link: ${buildLink(m) || "Link unavailable"}\n`
      )
      .join("\n");

    // --- Step 4: AI prompt (grounded + affiliate enforced) ---
    const prompt = `
You are Whopify’s AI affiliate recommender.

Use ONLY the Whop products provided below — do NOT invent or mention products that are not in the list.
Each product includes an affiliate link (which must be used exactly as provided).

User message:
"${message}"

Relevant Whop products:
${productList}

Write a rich, friendly, persuasive recommendation that:
- Clearly mentions 2–3 of the best fits for the user's goal
- Explains *why* each course or tool is valuable
- Includes the provided affiliate links using markdown ([Title](URL))
- Avoids generic or made-up products
- Uses a warm, helpful tone (not overly salesy)
- Adds emoji for visual appeal
`;

    // --- Step 5: Generate AI reply ---
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const aiResponse = completion.choices[0].message.content;

    // --- Step 6: Return both text + structured data ---
    const enrichedMatches = matches.map((m) => ({
      title: m.title,
      headline: m.headline,
      price: m.price,
      link: buildLink(m),
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
