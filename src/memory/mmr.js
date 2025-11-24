let maxSimilarityToSelected = function (item, selectedItems, tokenCache) {
  if (selectedItems.length === 0) {
    return 0;
  }
  let maxSim = 0;
  const itemTokens = tokenCache.get(item.id) ?? tokenize(item.content);
  for (const selected of selectedItems) {
    const selectedTokens = tokenCache.get(selected.id) ?? tokenize(selected.content);
    const sim = jaccardSimilarity(itemTokens, selectedTokens);
    if (sim > maxSim) {
      maxSim = sim;
    }
  }
  return maxSim;
};
export const DEFAULT_MMR_CONFIG = {
  enabled: false,
  lambda: 0.7,
};
export function tokenize(text) {
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return new Set(tokens);
}
export function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let intersectionSize = 0;
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;
  for (const token of smaller) {
    if (larger.has(token)) {
      intersectionSize++;
    }
  }
  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}
export function textSimilarity(contentA, contentB) {
  return jaccardSimilarity(tokenize(contentA), tokenize(contentB));
}
export function computeMMRScore(relevance, maxSimilarity, lambda) {
  return lambda * relevance - (1 - lambda) * maxSimilarity;
}
export function mmrRerank(items, config = {}) {
  const { enabled = DEFAULT_MMR_CONFIG.enabled, lambda = DEFAULT_MMR_CONFIG.lambda } = config;
  if (!enabled || items.length <= 1) {
    return [...items];
  }
  const clampedLambda = Math.max(0, Math.min(1, lambda));
  if (clampedLambda === 1) {
    return [...items].toSorted((a, b) => b.score - a.score);
  }
  const tokenCache = new Map();
  for (const item of items) {
    tokenCache.set(item.id, tokenize(item.content));
  }
  const maxScore = Math.max(...items.map((i) => i.score));
  const minScore = Math.min(...items.map((i) => i.score));
  const scoreRange = maxScore - minScore;
  const normalizeScore = (score) => {
    if (scoreRange === 0) {
      return 1;
    }
    return (score - minScore) / scoreRange;
  };
  const selected = [];
  const remaining = new Set(items);
  while (remaining.size > 0) {
    let bestItem = null;
    let bestMMRScore = -Infinity;
    for (const candidate of remaining) {
      const normalizedRelevance = normalizeScore(candidate.score);
      const maxSim = maxSimilarityToSelected(candidate, selected, tokenCache);
      const mmrScore = computeMMRScore(normalizedRelevance, maxSim, clampedLambda);
      if (
        mmrScore > bestMMRScore ||
        (mmrScore === bestMMRScore && candidate.score > (bestItem?.score ?? -Infinity))
      ) {
        bestMMRScore = mmrScore;
        bestItem = candidate;
      }
    }
    if (bestItem) {
      selected.push(bestItem);
      remaining.delete(bestItem);
    } else {
      break;
    }
  }
  return selected;
}
export function applyMMRToHybridResults(results, config = {}) {
  if (results.length === 0) {
    return results;
  }
  const itemById = new Map();
  const mmrItems = results.map((r, index) => {
    const id = `${r.path}:${r.startLine}:${index}`;
    itemById.set(id, r);
    return {
      id,
      score: r.score,
      content: r.snippet,
    };
  });
  const reranked = mmrRerank(mmrItems, config);
  return reranked.map((item) => itemById.get(item.id));
}
