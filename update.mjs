import fs from 'node:fs';

let content = fs.readFileSync('src/daemon/engine-cli.ts', 'utf8');

// 1. Remove discord-media imports
content = content.replace(/import \{ prepareDiscordMessageContent, sendPreparedDiscordFiles \} from '\.\/discord-media\.js';\n/, '');

// 2. FinalizedAssistantResponse
content = content.replace(/export interface FinalizedAssistantResponse \{[\s\S]*?\}/, `export interface FinalizedAssistantResponse {
  displayText: string;
  responseText: string;
  allowEmpty: boolean;
  actionMessageIds: string[];
}`);

// 3. Replace streaming block
content = content.replace(/const prepared = await finalizeAssistantResponse\(response, message, accepted\.isBoss\);\n      response = prepared\.responseText;\n      responseMessageIds = await editor\.finalize\(prepared\.displayText, chunkMessage, \{\n        allowEmpty: prepared\.allowEmpty,\n        rawText: response,\n      \}\);\n      responseMessageIds\.push\(\n        \.\.\.await sendPreparedDiscordFiles\(channel, prepared\.files\),\n        \.\.\.prepared\.actionMessageIds,\n      \);\n      return \{ response, messageIds: responseMessageIds, attachments: prepared\.attachments \};/g, `const prepared = await finalizeAssistantResponse(response, message, accepted.isBoss);
      response = prepared.responseText;
      responseMessageIds = await editor.finalize(prepared.displayText, chunkMessage, {
        allowEmpty: prepared.allowEmpty,
        rawText: response,
      });
      responseMessageIds.push(...prepared.actionMessageIds);
      return { response, messageIds: responseMessageIds };`);

// 4. Replace non-streaming block
content = content.replace(/const prepared = await finalizeAssistantResponse\(response, message, accepted\.isBoss\);\n        response = prepared\.cleanedText;\n        responseMessageIds = await sendPreparedDisplayText\(channel, prepared\.cleanedText\);\n        responseMessageIds\.push\(\.\.\.prepared\.actionMessageIds\);\n        return \{ response, messageIds: responseMessageIds \};/g, `const prepared = await finalizeAssistantResponse(response, message, accepted.isBoss);
        response = prepared.responseText;
        responseMessageIds = await sendPreparedDisplayText(channel, prepared.displayText);
        responseMessageIds.push(...prepared.actionMessageIds);
        return { response, messageIds: responseMessageIds };`);

// 5. Replace finalizeAssistantResponse
content = content.replace(/export async function finalizeAssistantResponse\([\s\S]*?return \{[\s\S]*?\};\n\}/, `export async function finalizeAssistantResponse(
  rawResponse: string,
  message: Message,
  allowPrivilegedActions: boolean,
): Promise<FinalizedAssistantResponse> {
  // 1. Strip CoT and internal thinking blocks early
  const sanitized = sanitizeFullResponse(rawResponse);

  // 2. Handle cross-channel send directives
  const actionResult = await processCrossChannelSends(sanitized, message.client, {
    allowPrivileged: allowPrivilegedActions,
  });

  return {
    displayText: actionResult.cleanedResponse,
    responseText: actionResult.cleanedResponse,
    allowEmpty: false,
    actionMessageIds: actionResult.messageIds,
  };
}`);

fs.writeFileSync('src/daemon/engine-cli.ts', content);
