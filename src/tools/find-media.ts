import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import type { Config } from '../shared/types.js';
import { authorizeMcpToolAction, formatPermissionDenial } from '../daemon/permissions.js';

const execFileAsync = promisify(execFile);

export function registerFindMediaTool(server: McpServer, config: Config) {
  server.tool(
    'discord_find_media',
    'Find local media files on the host machine using mdfind (macOS). Use this when the user asks for images, videos, audio, screenshots, or other media from their device.',
    {
      query: z.string().describe('Search query (e.g. "luffy", "screenshot")'),
      limit: z.number().optional().describe('Maximum results to return. Default 15.'),
    },
    async ({ query, limit = 15 }) => {
      const gate = authorizeMcpToolAction('media_search', config);
      if (gate.decision !== 'allow') {
        return { content: [{ type: 'text', text: formatPermissionDenial(gate) }], isError: true };
      }

      try {
        const os = await import('node:os');
        const homedir = os.homedir();
        const entries = await readdir(homedir, { withFileTypes: true });
        const searchDirArgs = entries
          .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'Library')
          .flatMap(e => ['-onlyin', path.join(homedir, e.name)]);

        const search = normalizeMediaSearch(query);
        const mediaPredicate = "(kMDItemContentTypeTree == 'public.image' || kMDItemContentTypeTree == 'public.movie' || kMDItemContentTypeTree == 'public.audio' || kMDItemContentTypeTree == 'public.audiovisual-content')";
        const predicate = search.meaningfulQuery
          ? `${mediaPredicate} && kMDItemDisplayName == '*${search.meaningfulQuery}*'cd`
          : mediaPredicate;
        const { stdout } = await execFileAsync('mdfind', [predicate, ...searchDirArgs], { timeout: 10000 });
        const files = stdout.split('\n').filter(Boolean).filter(f => !f.includes('MacDroid'));

        if (files.length === 0) {
          return { content: [{ type: 'text', text: 'No media files found on the device matching that query.' }] };
        }

        // Priority algorithm: media in common user folders are more likely recent intentional saves.
        const priorityFolders = ['/Desktop', '/Downloads', '/Pictures', '/Movies', '/Music'];

        const sorted = [...files].sort((a, b) => {
          const aPriority = priorityFolders.some(f => a.includes(f));
          const bPriority = priorityFolders.some(f => b.includes(f));
          if (aPriority && !bPriority) return -1;
          if (!aPriority && bPriority) return 1;
          return 0;
        });

        const topFiles = (search.random ? shuffle(sorted) : sorted).slice(0, limit);
        const label = search.random
          ? 'for a random local media request'
          : `matching query '${query}'`;
        return {
          content: [{
            type: 'text',
            text: `Found ${topFiles.length} local media files ${label}:\n${topFiles.join('\n')}\n\nFinding a file is not completion. You MUST use the 'files' array parameter in the 'discord_send' or 'discord_reply' tools to attach the requested media, and the task is complete only after that tool reports a successful send/reply. Select ONLY ONE path from this list to attach, unless the user explicitly requested multiple files. Do NOT use markdown media syntax instead of attaching the file. If you provide your text reply within the tool call, you may leave your final response empty.`
          }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    }
  );
}

export function normalizeMediaSearch(query: string): { meaningfulQuery: string; random: boolean } {
  const trimmed = query.trim();
  const meaningfulQuery = trimmed
    .replace(/\b(random|any|local|media|file|files|image|images|photo|photos|picture|pictures|screenshot|screenshots|video|videos|movie|movies|audio|sound|song|songs|music|clip|clips|gif|gifs|from|on|my|the|a|an|device|computer|mac|machine)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    meaningfulQuery,
    random: meaningfulQuery.length === 0,
  };
}

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}
