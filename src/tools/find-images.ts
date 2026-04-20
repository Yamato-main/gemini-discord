import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

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
        const cmd = `mdfind "kMDItemContentTypeTree == 'public.image' && kMDItemDisplayName == '*${query}*'cd" -onlyin /Users/yamato`;
        const { stdout } = await execAsync(cmd);
        const files = stdout.split('\n').filter(Boolean);
        
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
            text: `Found ${topFiles.length} local images matching query '${query}':\n${topFiles.join('\n')}\n\nYou can use these absolute paths natively such as ![luffy](/Users/yamato/Desktop/luffy.png) to send them via discord.` 
          }] 
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    }
  );
}
