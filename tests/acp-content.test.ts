import { describe, expect, it } from 'vitest';
import { buildAcpPromptBlocks } from '../src/daemon/acp-content.js';

describe('buildAcpPromptBlocks', () => {
  it('sends inline images as ACP image blocks before the text prompt', () => {
    const blocks = buildAcpPromptBlocks('who is this?', [
      {
        relativePath: 'discord-attachments/m1/1-panel.png',
        metadata: { name: 'panel.png', contentType: 'image/png', sizeBytes: 12 },
        inlineData: { data: 'aW1hZ2U=', mimeType: 'image/png' },
      },
    ]);

    expect(blocks[0]).toEqual({
      type: 'image',
      data: 'aW1hZ2U=',
      mimeType: 'image/png',
      uri: 'file://discord-attachments/m1/1-panel.png',
    });
    expect(blocks[1]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Use the attached file content as the primary evidence'),
    });
  });

  it('falls back to ACP file resource links when inline data is unavailable', () => {
    const blocks = buildAcpPromptBlocks('summarize this', [
      {
        relativePath: 'discord-attachments/m2/report.pdf',
        metadata: { name: 'report.pdf', contentType: 'application/pdf', sizeBytes: 1024 },
      },
    ]);

    expect(blocks[0]).toEqual({
      type: 'resource_link',
      uri: 'file://discord-attachments/m2/report.pdf',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 1024,
    });
  });
});
