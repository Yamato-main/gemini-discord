import * as http from 'node:http';
import type { Config } from '../shared/types.js';
import {
  authorizeAction,
  formatPermissionDenial,
  GUEST_PERMISSION_REFUSAL,
  resolveDiscordRole,
  type PermissionAction,
  type RoleContext,
} from './permissions.js';

const MAX_BODY_BYTES = 10240;

export function respond(res: http.ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function requireAuth(req: http.IncomingMessage, config: Config): boolean {
  const header = req.headers.authorization;
  if (!header) return false;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token === config.daemonApiToken;
}

export async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export function parseOptionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseOptionalTimestamp(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function roleContextFromRequest(req: http.IncomingMessage, config: Config): RoleContext | null {
  const rawRole = req.headers['x-gemini-discord-role'];
  const role = Array.isArray(rawRole) ? rawRole[0] : rawRole;
  if (role !== 'BOSS' && role !== 'GUEST') {
    return null;
  }

  const rawSenderId = req.headers['x-gemini-discord-sender-id'];
  const rawSenderLabel = req.headers['x-gemini-discord-sender-label'];
  const senderDiscordId = (Array.isArray(rawSenderId) ? rawSenderId[0] : rawSenderId)?.trim() || 'unknown';
  const senderDisplayLabel = (Array.isArray(rawSenderLabel) ? rawSenderLabel[0] : rawSenderLabel)?.trim() || senderDiscordId;

  return resolveDiscordRole(config, { discordUserId: senderDiscordId, displayLabel: senderDisplayLabel });
}

export function authorizeApiAction(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: Config,
  action: PermissionAction,
): boolean {
  const roleContext = roleContextFromRequest(req, config);
  if (!roleContext) {
    respond(res, 403, { error: GUEST_PERMISSION_REFUSAL });
    return false;
  }

  const decision = authorizeAction(action, roleContext);
  if (decision.decision === 'allow') {
    return true;
  }

  respond(res, 403, { error: formatPermissionDenial(decision) });
  return false;
}
