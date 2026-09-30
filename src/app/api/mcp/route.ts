import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { bearerFrom, TokenError } from "@/lib/api-token";
import { buildServer } from "@/lib/mcp-server";

export const dynamic = "force-dynamic";
/** The MCP SDK and Prisma are both Node-only; neither runs on the edge runtime. */
export const runtime = "nodejs";

/**
 * The MCP endpoint.
 *
 * Stateless: a server and transport are built per request and thrown away.
 * Railway runs more than one instance and restarts them freely, so a session
 * held in memory on one of them is a session the next request cannot find.
 * Every tool here answers from the database anyway, so there is no state worth
 * keeping between calls.
 *
 * `enableJsonResponse` asks the transport for a plain JSON reply rather than an
 * SSE stream, which is what a request/response endpoint like this one wants.
 */
async function handle(request: Request): Promise<Response> {
  let bearer;
  try {
    bearer = await bearerFrom(request);
  } catch (error) {
    if (error instanceof TokenError) return unauthorized(error);
    throw error;
  }

  const server = buildServer(bearer);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // Not closed afterwards: the transport owns the response body it returns, so
  // tearing the server down here would cut the reply off mid-flight.
  await server.connect(transport);
  return transport.handleRequest(request);
}

/**
 * A 401 that says how to authenticate.
 *
 * The WWW-Authenticate header is what an MCP client reads to work out that the
 * credential is the problem rather than the request.
 */
function unauthorized(error: TokenError): Response {
  return Response.json(
    { error: error.message },
    {
      status: error.status,
      headers:
        error.status === 401
          ? { "WWW-Authenticate": 'Bearer realm="email-previews"' }
          : undefined,
    },
  );
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
