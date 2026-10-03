/** Conservative export-only cleanup. Capture provenance is required to merge. */
function comparisonWords(text) {
  return text.normalize('NFC').toLowerCase().trim().split(/\s+/u)
    // Keep internal punctuation/signs and leading decimal separators (.5/,5).
    .map(word => word.replace(/^[!?;:…¿¡"'“”‘’()[\]{}]+|[.,!?;:…¿¡"'“”‘’()[\]{}]+$/gu, ''))
    .filter(Boolean);
}

function eligible(line) {
  return line !== null && typeof line === 'object' && !Array.isArray(line)
    && typeof line.utteranceId === 'string' && line.utteranceId.trim() !== ''
    // An empty speaker is the extension's supported text-only fallback.
    && typeof line.speaker === 'string' && (line.speaker === '' || line.speaker.trim() !== '')
    && typeof line.text === 'string' && comparisonWords(line.text).length > 0
    && Number.isFinite(line.timestamp);
}

function isPrefix(shorter, longer) {
  return shorter.length <= longer.length
    && shorter.every((word, index) => word === longer[index]);
}

/** Return fresh rows; never modify the captured transcript or infer provenance. */
export function cleanTranscriptForExport(lines) {
  const output = [];
  let previousOriginal;
  for (const line of lines) {
    const copy = Array.isArray(line) ? [...line]
      : line !== null && typeof line === 'object' ? { ...line } : line;
    const previous = output.at(-1);
    const sameGroup = eligible(line) && eligible(previousOriginal)
      && line.utteranceId === previousOriginal.utteranceId
      && line.speaker === previousOriginal.speaker
      && line.timestamp >= previousOriginal.timestamp;
    if (sameGroup) {
      const before = comparisonWords(previous.text);
      const next = comparisonWords(line.text);
      const originalBefore = comparisonWords(previousOriginal.text);
      // Both the original neighboring rows and the accumulated row must agree.
      // A conflicting row is a boundary even if a later row matches an older one.
      const neighborsAgree = isPrefix(originalBefore, next) || isPrefix(next, originalBefore);
      if (neighborsAgree && (isPrefix(before, next) || isPrefix(next, before))) {
        output[output.length - 1] = next.length >= before.length
          ? { ...copy, timestamp: previous.timestamp }
          : { ...previous };
        previousOriginal = line;
        continue;
      }
    }
    output.push(copy);
    previousOriginal = line;
  }
  return output;
}
