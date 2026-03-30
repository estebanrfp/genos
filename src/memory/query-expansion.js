let isValidKeyword = function (token) {
    if (!token || token.length === 0) {
      return false;
    }
    if (/^[a-zA-Z]+$/.test(token) && token.length < 3) {
      return false;
    }
    if (/^\d+$/.test(token)) {
      return false;
    }
    if (/^[\p{P}\p{S}]+$/u.test(token)) {
      return false;
    }
    return true;
  },
  tokenize = function (text) {
    const tokens = [];
    const normalized = text.toLowerCase().trim();
    const segments = normalized.split(/[\s\p{P}]+/u).filter(Boolean);
    for (const segment of segments) {
      if (/[\u4e00-\u9fff]/.test(segment)) {
        const chars = Array.from(segment).filter((c) => /[\u4e00-\u9fff]/.test(c));
        tokens.push(...chars);
        for (let i = 0; i < chars.length - 1; i++) {
          tokens.push(chars[i] + chars[i + 1]);
        }
      } else {
        tokens.push(segment);
      }
    }
    return tokens;
  };
const STOP_WORDS_EN = new Set([
  "a",
  "an",
  "the",
  "this",
  "that",
  "these",
  "those",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "she",
  "it",
  "they",
  "them",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "can",
  "may",
  "might",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "about",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "under",
  "over",
  "and",
  "or",
  "but",
  "if",
  "then",
  "because",
  "as",
  "while",
  "when",
  "where",
  "what",
  "which",
  "who",
  "how",
  "why",
  "yesterday",
  "today",
  "tomorrow",
  "earlier",
  "later",
  "recently",
  "before",
  "ago",
  "just",
  "now",
  "thing",
  "things",
  "stuff",
  "something",
  "anything",
  "everything",
  "nothing",
  "please",
  "help",
  "find",
  "show",
  "get",
  "tell",
  "give",
]);
const STOP_WORDS_ZH = new Set([
  "\u6211",
  "\u6211\u4EEC",
  "\u4F60",
  "\u4F60\u4EEC",
  "\u4ED6",
  "\u5979",
  "\u5B83",
  "\u4ED6\u4EEC",
  "\u8FD9",
  "\u90A3",
  "\u8FD9\u4E2A",
  "\u90A3\u4E2A",
  "\u8FD9\u4E9B",
  "\u90A3\u4E9B",
  "\u7684",
  "\u4E86",
  "\u7740",
  "\u8FC7",
  "\u5F97",
  "\u5730",
  "\u5417",
  "\u5462",
  "\u5427",
  "\u554A",
  "\u5440",
  "\u561B",
  "\u5566",
  "\u662F",
  "\u6709",
  "\u5728",
  "\u88AB",
  "\u628A",
  "\u7ED9",
  "\u8BA9",
  "\u7528",
  "\u5230",
  "\u53BB",
  "\u6765",
  "\u505A",
  "\u8BF4",
  "\u770B",
  "\u627E",
  "\u60F3",
  "\u8981",
  "\u80FD",
  "\u4F1A",
  "\u53EF\u4EE5",
  "\u548C",
  "\u4E0E",
  "\u6216",
  "\u4F46",
  "\u4F46\u662F",
  "\u56E0\u4E3A",
  "\u6240\u4EE5",
  "\u5982\u679C",
  "\u867D\u7136",
  "\u800C",
  "\u4E5F",
  "\u90FD",
  "\u5C31",
  "\u8FD8",
  "\u53C8",
  "\u518D",
  "\u624D",
  "\u53EA",
  "\u4E4B\u524D",
  "\u4EE5\u524D",
  "\u4E4B\u540E",
  "\u4EE5\u540E",
  "\u521A\u624D",
  "\u73B0\u5728",
  "\u6628\u5929",
  "\u4ECA\u5929",
  "\u660E\u5929",
  "\u6700\u8FD1",
  "\u4E1C\u897F",
  "\u4E8B\u60C5",
  "\u4E8B",
  "\u4EC0\u4E48",
  "\u54EA\u4E2A",
  "\u54EA\u4E9B",
  "\u600E\u4E48",
  "\u4E3A\u4EC0\u4E48",
  "\u591A\u5C11",
  "\u8BF7",
  "\u5E2E",
  "\u5E2E\u5FD9",
  "\u544A\u8BC9",
]);
const STOP_WORDS_ES = new Set([
  // Articles
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  // Pronouns
  "yo",
  "me",
  "mi",
  "nosotros",
  "nos",
  "tu",
  "te",
  "ti",
  "usted",
  "ustedes",
  "vosotros",
  "vos",
  "él",
  "ella",
  "ellos",
  "ellas",
  "le",
  "les",
  "lo",
  "se",
  "si",
  // Prepositions
  "de",
  "del",
  "en",
  "por",
  "para",
  "con",
  "sin",
  "sobre",
  "entre",
  "hacia",
  "desde",
  "hasta",
  "durante",
  "mediante",
  "contra",
  "tras",
  // Conjunctions
  "y",
  "o",
  "pero",
  "ni",
  "que",
  "como",
  "porque",
  "aunque",
  "sino",
  "pues",
  // Auxiliaries (ser/estar/haber/tener)
  "es",
  "son",
  "soy",
  "era",
  "fue",
  "ser",
  "sido",
  "está",
  "están",
  "estar",
  "ha",
  "han",
  "hay",
  "he",
  "hemos",
  "tiene",
  "tienen",
  "tener",
  // Demonstratives
  "este",
  "esta",
  "estos",
  "estas",
  "ese",
  "esa",
  "esos",
  "esas",
  "aquel",
  "aquella",
  // Interrogatives
  "qué",
  "quién",
  "cuál",
  "cuándo",
  "dónde",
  "cómo",
  // Adverbs / misc
  "no",
  "más",
  "muy",
  "ya",
  "también",
  "solo",
  "todo",
  "toda",
  "todos",
  "todas",
  "otro",
  "otra",
  "otros",
  "otras",
  "aquí",
  "ahí",
  "allí",
  "ayer",
  "hoy",
  "mañana",
  "ahora",
  "antes",
  "después",
  "luego",
  // Common request words
  "buscar",
  "mostrar",
  "dar",
  "decir",
  "ayuda",
  "cosa",
  "cosas",
  "algo",
  "nada",
]);
/** @param {string} token */
export const isStopWord = (token) => {
  const lower = token.toLowerCase();
  return STOP_WORDS_EN.has(lower) || STOP_WORDS_ZH.has(lower) || STOP_WORDS_ES.has(lower);
};
export function extractKeywords(query) {
  const tokens = tokenize(query);
  const keywords = [];
  const seen = new Set();
  for (const token of tokens) {
    if (STOP_WORDS_EN.has(token) || STOP_WORDS_ZH.has(token) || STOP_WORDS_ES.has(token)) {
      continue;
    }
    if (!isValidKeyword(token)) {
      continue;
    }
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    keywords.push(token);
  }
  return keywords;
}
export function expandQueryForFts(query) {
  const original = query.trim();
  const keywords = extractKeywords(original);
  const expanded = keywords.length > 0 ? `${original} OR ${keywords.join(" OR ")}` : original;
  return { original, keywords, expanded };
}
export async function expandQueryWithLlm(query, llmExpander) {
  if (llmExpander) {
    try {
      const llmKeywords = await llmExpander(query);
      if (llmKeywords.length > 0) {
        return llmKeywords;
      }
    } catch {}
  }
  return extractKeywords(query);
}
