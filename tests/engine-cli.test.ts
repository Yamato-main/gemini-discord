import { describe, expect, it } from 'vitest';
import { shouldUseHeadlessForAttachmentInjection } from '../src/daemon/engine-cli.js';

describe('shouldUseHeadlessForAttachmentInjection', () => {
  it('keeps text-only turns on the persistent ACP path', () => {
    expect(shouldUseHeadlessForAttachmentInjection([])).toBe(false);
  });

  it('keeps image turns on the persistent ACP path', () => {
    expect(shouldUseHeadlessForAttachmentInjection([
      { name: 'image.png', contentType: 'image/png' },
      { name: 'photo.jpg' },
    ])).toBe(false);
  });

  it('keeps video, audio, PDFs, and text files on the persistent ACP path', () => {
    expect(shouldUseHeadlessForAttachmentInjection([
      { name: 'clip.mp4', contentType: 'video/mp4' },
    ])).toBe(false);
    expect(shouldUseHeadlessForAttachmentInjection([
      { name: 'notes.md', contentType: 'text/markdown' },
    ])).toBe(false);
    expect(shouldUseHeadlessForAttachmentInjection([
      { name: 'report.pdf', contentType: 'application/pdf' },
    ])).toBe(false);
  });
});
