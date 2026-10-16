/**
 * Conector MCP para claude.ai (ver docs/MCP.md). La lógica vive en lib/handlers/mcp.ts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { mcpHandler } from '../lib/handlers/mcp.js'

export const config = { maxDuration: 60 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await mcpHandler(req, res)
}
