import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Config } from '../shared/types.js';
import { authorizeMcpToolAction, formatPermissionDenial } from '../daemon/permissions.js';

export function registerFetchWebPageTool(server: McpServer, config: Config) {
  server.tool(
    'discord_fetch_web_page',
    'Fetch and extract the clean text content of a web page/URL. Use this instead of web_fetch to read the content of any links or websites.',
    {
      url: z.string().url().describe('The URL to fetch (must start with http:// or https://)'),
    },
    async ({ url }) => {
      const gate = authorizeMcpToolAction('external_web', config); // Outbound network access check
      if (gate.decision !== 'allow') {
        return { content: [{ type: 'text', text: formatPermissionDenial(gate) }], isError: true };
      }

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          signal: AbortSignal.timeout(15000), // 15s timeout
        });

        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `❌ HTTP Error ${response.status}: ${response.statusText}` }],
            isError: true,
          };
        }

        const html = await response.text();
        const cleanText = cleanHtml(html);

        if (!cleanText.trim()) {
          return { content: [{ type: 'text', text: 'The page returned no readable text content.' }] };
        }

        return {
          content: [{
            type: 'text',
            text: `Content of ${url}:\n\n${cleanText.slice(0, 15000)}` // Limit output size to prevent token blowup
          }]
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ Failed to fetch page: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );
}

function cleanHtml(html: string): string {
  // Strip head, scripts, and styles completely
  let text = html
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '');

  // Strip all HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode basic HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Break into readable paragraphs roughly
  return text.replace(/(.{1,100})(\s+|$)/g, '$1\n').slice(0, 20000);
}
