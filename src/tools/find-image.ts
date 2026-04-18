import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export function registerFindImageTool(server: McpServer): void {
  server.tool(
    'find_local_image',
    'Searches the user\'s macOS device for an image matching a description or filename. Returns absolute paths.',
    {
      query: z.string().describe('The filename or semantic description to search for (e.g., "luffy", "screenshot").'),
      maxResults: z.number().optional().describe('Maximum number of paths to return. Defaults to 5.'),
    },
    async ({ query, maxResults = 5 }) => {
      try {
        // Sanitize the query to prevent shell injection, though mdfind handles quotes if escaped properly.
        // We'll strip double quotes for safety.
        const safeQuery = query.replace(/"/g, '');
        
        // Execute mdfind specifically looking for images
        const command = `mdfind "${safeQuery} kind:image" | head -n ${maxResults}`;
        const { stdout } = await execAsync(command);
        
        const paths = stdout.split('\n').filter(Boolean);
        
        if (paths.length === 0) {
          return {
            content: [{
              type: 'text',
              text: `No images found matching "${query}" via Spotlight. Consider using standard shell commands like \`find ~/Pictures -iname "*${safeQuery}*"\` if necessary.`,
            }],
          };
        }

        return {
          content: [{
            type: 'text',
            text: `Found ${paths.length} matching images:\n${paths.join('\n')}`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    },
  );
}
