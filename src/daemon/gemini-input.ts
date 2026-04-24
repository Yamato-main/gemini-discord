export function buildGeminiCliPrompt(prompt: string, attachmentRefs: string[] = []): string {
  if (attachmentRefs.length === 0) {
    return prompt;
  }

  const fileRefs = attachmentRefs.map((ref) => `@${ref}`).join(' ');
  return `${fileRefs}\n\n${prompt}`;
}
