export async function resolveNextUpCandidates(
  candidates = [],
  resolver,
  { maxLookups = 24, concurrency = 4 } = {}
) {
  if (typeof resolver !== "function") {
    return [];
  }

  const limitedCandidates = (Array.isArray(candidates) ? candidates : []).slice(
    0,
    Math.max(0, Number(maxLookups || 0))
  );
  if (!limitedCandidates.length) {
    return [];
  }

  const results = new Array(limitedCandidates.length);
  const workerCount = Math.min(
    limitedCandidates.length,
    Math.max(1, Number(concurrency || 1))
  );
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < limitedCandidates.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await resolver(limitedCandidates[index], index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results.filter(Boolean);
}
