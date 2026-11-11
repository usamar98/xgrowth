import twitterText from "twitter-text";
/** Keep detected links intact while splitting long notes at whitespace or grapheme boundaries. */
export function splitNotes(text: string): string[] {
  if (!text.trim()) return [""];
  const parts: string[] = [];
  const write = (part: string) => {
    if (part.trim()) parts.push(part.trim());
  };
  for (const paragraph of text.trim().split(/\n\s*\n/)) {
    let part = "";
    for (const token of paragraph.match(/\s+|\S+/gu) || []) {
      if (twitterText.parseTweet(part + token).weightedLength <= 280) {
        part += token;
        continue;
      }
      write(part);
      part = "";
      if (twitterText.parseTweet(token).weightedLength <= 280) {
        part = token.trimStart();
        continue;
      }
      const spans = twitterText.extractUrlsWithIndices(token);
      let pos = 0;
      const atoms: string[] = [];
      const segmenter = new Intl.Segmenter(undefined, {
        granularity: "grapheme",
      });
      const append = (s: string) =>
        atoms.push(...Array.from(segmenter.segment(s), (x) => x.segment));
      for (const url of spans) {
        append(token.slice(pos, url.indices[0]));
        atoms.push(token.slice(url.indices[0], url.indices[1]));
        pos = url.indices[1];
      }
      append(token.slice(pos));
      for (const atom of atoms) {
        if (twitterText.parseTweet(part + atom).weightedLength > 280) {
          write(part);
          part = "";
        }
        part += atom;
      }
    }
    write(part);
  }
  if (parts.length > 20)
    throw new Error(
      "These notes need more than 20 parts. Save a shorter selection as a thread.",
    );
  return parts.length ? parts : [""];
}
