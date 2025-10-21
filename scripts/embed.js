import fs from "fs";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const whops = JSON.parse(fs.readFileSync("./whops.json", "utf8"));

for (const w of whops) {
  const text = `${w.title || ""}\n${w.headline || ""}\n${w.description || ""}\nCategory: ${w.company?.industryType || ""}\nType: ${w.company?.businessType || ""}`;
  
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  await supabase.from("whop_embeddings").upsert({
    id: w.id,
    title: w.title,
    headline: w.headline,
    description: w.description,
    price: w.defaultPlan?.priceTag || "",
    image: w.logo?.sourceUrl || w.company?.logo?.sourceUrl || "",
    route: w.route,
    embedding: embedding.data[0].embedding
  });

  console.log(`✅ Uploaded ${w.title}`);
}

console.log("🎉 All embeddings uploaded!");
