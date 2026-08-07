export function buildOutputContractSection(modelOutputContract: string): string[] {
  return [
    "Respond with a single JSON object and nothing else: no markdown code fences, no prose before or",
    "after it. The JSON object must match exactly this shape:",
    modelOutputContract,
    "",
    "Rules:",
    "- Output ONLY the JSON object described above.",
    "- Only report findings on lines added by the diff.",
    '- "line" must be a line number that appears as an added line in the diff.',
    '- "codeAnchor" must be a short verbatim snippet of the reviewed code from the diff.',
    '- If there are no issues, respond with {"findings": []}.'
  ];
}
