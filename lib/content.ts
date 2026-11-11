import twitterText from "twitter-text";
export function reviewText(text: string) {
  const normalized = text.trim().normalize("NFC");
  const parsed = twitterText.parseTweet(normalized);
  const urls = twitterText.extractUrls(normalized);
  const mentions = twitterText.extractMentions(normalized);
  const issues: string[] = [];
  if (!normalized) issues.push("Write a post before publishing.");
  else if (!parsed.valid)
    issues.push(
      parsed.weightedLength > 280
        ? "Keep this text post within X’s 280 weighted characters."
        : "Remove unsupported characters before publishing.",
    );
  if (mentions.length)
    issues.push(
      "This studio publishes original posts without @mentions. Use X directly for conversations.",
    );
  if (
    /\[(?:your|insert|example|specific|lesson|detail|result|topic|audience)[^\]]*\]/i.test(
      normalized,
    )
  )
    issues.push(
      "Replace the writing-template placeholders with your own details.",
    );
  return {
    length: parsed.weightedLength,
    valid: issues.length === 0,
    issues,
    hasUrl: urls.length > 0,
    cost: urls.length ? 200000 : 15000,
  };
}
export function canonicalText(text: string) {
  return text.normalize("NFC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}
export const prompts = [
  {
    pillar: "Teach",
    title: "A lesson worth passing on",
    description: "What do you know now that you wish you knew six months ago?",
    seed: "One thing I learned about [topic]:\n\n[Your lesson]\n\nHere’s how to try it: [specific step]",
  },
  {
    pillar: "Show",
    title: "Take us behind the scenes",
    description:
      "Share a decision, a process, or an experiment you are working on.",
    seed: "Behind the scenes of [your project]:\n\nI tried [your approach].\nWhat happened: [result].\nWhat I’m changing next: [specific detail].",
  },
  {
    pillar: "Ask",
    title: "Start a real conversation",
    description: "Ask a specific question you want your audience to answer.",
    seed: "For [your audience] working on [topic]:\n\nWhat’s the hardest part of [specific problem]?\n\nHere’s where I get stuck: [your experience].",
  },
];
export function getMetrics(posts: import("./types").XPost[]) {
  const allHaveImpressions =
    posts.length > 0 &&
    posts.every((p) => typeof p.public_metrics?.impression_count === "number");
  const impressions = allHaveImpressions
    ? posts.reduce((s, p) => s + p.public_metrics!.impression_count!, 0)
    : null;
  const allHaveInteractions =
    posts.length > 0 &&
    posts.every((p) =>
      ["like_count", "reply_count", "retweet_count", "quote_count"].every(
        (k) =>
          typeof (p.public_metrics as Record<string, number> | undefined)?.[
            k
          ] === "number",
      ),
    );
  const interactions = allHaveInteractions
    ? posts.reduce(
        (s, p) =>
          s +
          (p.public_metrics!.like_count! +
            p.public_metrics!.reply_count! +
            p.public_metrics!.retweet_count! +
            p.public_metrics!.quote_count!),
        0,
      )
    : null;
  return {
    impressions,
    interactions,
    rate:
      impressions && interactions !== null
        ? (interactions / impressions) * 100
        : null,
  };
}
