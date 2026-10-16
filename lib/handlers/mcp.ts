/**
 * Servidor MCP (Streamable HTTP, sin estado) para usar EIZ Metrics como conector en claude.ai.
 *
 * Auth: header fijo `Authorization: Bearer <MCP_TOKEN>` (se configura en el conector).
 * Alcance: la cuenta de MCP_ACCOUNT_SLUG, o la única que haya. Solo lectura, vía service role.
 * Cada request crea su server + transport: no hay sesiones que mantener entre invocaciones.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServiceClient } from '../ingest/sync.js'
import { bearerToken, resolveScope, tokenMatches } from '../mcp/scope.js'
import { buildMcpServer } from '../mcp/server.js'

function rpcError(res: VercelResponse, status: number, message: string) {
  return res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null })
}

export async function mcpHandler(req: VercelRequest, res: VercelResponse) {
  // Sin estado: no hay stream SSE de servidor (GET) ni sesiones que cerrar (DELETE)
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return rpcError(res, 405, 'Method not allowed. Use POST.')
  }

  const expected = process.env.MCP_TOKEN
  if (!expected) return rpcError(res, 503, 'MCP_TOKEN no configurado en el servidor')
  const token = bearerToken(req.headers.authorization)
  if (!token || !tokenMatches(token, expected)) return rpcError(res, 401, 'Unauthorized')

  try {
    const supabase = createServiceClient()
    const scope = await resolveScope(supabase, process.env.MCP_ACCOUNT_SLUG || undefined)
    const server = buildMcpServer(supabase, scope)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    if (!res.headersSent) return rpcError(res, 500, (err as Error).message)
  }
}
