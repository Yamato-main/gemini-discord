export function buildGeminiCliPrompt(prompt: string, attachmentRefs: string[] = []): string {
  if (attachmentRefs.length === 0) {
    return prompt;
  }

  const fileRefs = attachmentRefs.map((ref) => `@${ref}`).join(' ');
  return `${fileRefs}

Use the attached file content as the primary evidence for this turn. If the user asks to identify a person, character, object, place, or media source, ground the answer in visible/audible/textual details from the attachment and say when you are uncertain. Do not infer from prior conversation, memory, or unrelated context when it conflicts with the attachment.

${prompt}`;
}
