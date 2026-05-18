import * as path from 'node:path';
import type { ConversationAttachment } from '../shared/types.js';

export interface AcpPromptAttachment {
  relativePath: string;
  metadata: ConversationAttachment;
  inlineData?: {
    data: string;
    mimeType: string;
  };
}

export type AcpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string; uri?: string }
  | { type: 'audio'; data: string; mimeType: string }
  | {
      type: 'resource';
      resource:
        | { uri: string; blob: string; mimeType: string }
        | { uri: string; text: string; mimeType?: string };
    }
  | {
      type: 'resource_link';
      uri: string;
      name: string;
      mimeType?: string;
      size?: number;
    };

export function buildAcpPromptBlocks(
  prompt: string,
  attachments: AcpPromptAttachment[] = [],
): AcpContentBlock[] {
  if (attachments.length === 0) {
    return [{ type: 'text', text: prompt }];
  }

  return [
    ...attachments.map(toAcpAttachmentBlock),
    {
      type: 'text',
      text: [
        '',
        'Use the attached file content as the primary evidence for this turn. If the user asks to identify a person, character, object, place, or media source, ground the answer in visible/audible/textual details from the attachment and say when you are uncertain. Do not infer from prior conversation, memory, or unrelated context when it conflicts with the attachment.',
        '',
        prompt,
      ].join('\n'),
    },
  ];
}

function toAcpAttachmentBlock(attachment: AcpPromptAttachment): AcpContentBlock {
  const uri = toFileUri(attachment.relativePath);
  const mimeType = attachment.inlineData?.mimeType;

  if (attachment.inlineData && mimeType?.startsWith('image/')) {
    return {
      type: 'image',
      data: attachment.inlineData.data,
      mimeType,
      uri,
    };
  }

  if (attachment.inlineData && mimeType?.startsWith('audio/')) {
    return {
      type: 'audio',
      data: attachment.inlineData.data,
      mimeType,
    };
  }

  if (attachment.inlineData && mimeType) {
    return {
      type: 'resource',
      resource: {
        uri,
        blob: attachment.inlineData.data,
        mimeType,
      },
    };
  }

  return {
    type: 'resource_link',
    uri,
    name: attachment.metadata.name || path.basename(attachment.relativePath),
    mimeType: attachment.metadata.contentType,
    size: attachment.metadata.sizeBytes,
  };
}

function toFileUri(relativePath: string): string {
  return `file://${relativePath.split(path.sep).join('/')}`;
}
