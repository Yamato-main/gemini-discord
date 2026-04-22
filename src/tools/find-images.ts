import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';

const execAsync = promisify(exec);

export function registerFindImagesTool(server: McpServer) {
  server.tool(
    'discord_find_images',
    'Find local image files on the host machine using mdfind (macOS). Use this when the user asks for images from their device.',
    {
      query: z.string().describe('Search query (e.g. "luffy", "screenshot")'),
      limit: z.number().optional().describe('Maximum results to return. Default 15.'),
    },
    async ({ query, limit = 15 }) => {
      try {
        const entries = await readdir('/Users/yamato', { withFileTypes: true });
        const searchDirs = entries
          .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'Library')
          .map(e => `-onlyin "/Users/yamato/${e.name}"`)
          .join(' ');

        const cmd = `mdfind "kMDItemContentTypeTree == 'public.image' && kMDItemDisplayName == '*${query}*'cd" ${searchDirs}`;
        const { stdout } = await execAsync(cmd, { timeout: 10000 });
        const files = stdout.split('\n').filter(Boolean).filter(f => !f.includes('MacDroid'));
        
        if (files.length === 0) {
          return { content: [{ type: 'text', text: 'No images found on the device matching that query.' }] };
        }

        // Priority algorithm: images in Desktop, Downloads, and Pictures are more likely recent intentional saves.
        const priorityFolders = ['/Desktop', '/Downloads', '/Pictures'];
        
        const sorted = files.sort((a, b) => {
          const aPriority = priorityFolders.some(f => a.includes(f));
          const bPriority = priorityFolders.some(f => b.includes(f));
          if (aPriority && !bPriority) return -1;
          if (!aPriority && bPriority) return 1;
          return 0; 
        });

        const topFiles = sorted.slice(0, limit);
        return { 
          content: [{ 
            type: 'text', 
            text: `Found ${topFiles.length} local images matching query '${query}':\n${topFiles.join('\n')}\n\nYou MUST use the 'files' array parameter in the 'discord_send' or 'discord_reply' tools to attach the image. Select ONLY ONE path from this list to attach, unless the user explicitly requested multiple images. Do NOT use markdown image syntax (![alt](/path)). If you provide your text reply within the tool call, you may leave your final response empty.` 
          }] 
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    }
  );
}
