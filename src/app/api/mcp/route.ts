import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
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
 */
async function post(request: Request): Promise<Response> {
  const bearer = await authenticate(request);
  if (bearer instanceof Response) return bearer;

  // A protocol version this SDK has not heard of is almost always a *newer*
  // one, and the transport's answer to that is a 400 -- which a client reads as
  // a dead connection and recovers from by starting the whole handshake again.
  // Losing a conversation's connector over a version string is a far worse
  // outcome than speaking a slightly older dialect, so an unknown version is
  // dropped rather than refused, and said out loud so it is not a silent
  // divergence.
  const asked = request.headers.get("mcp-protocol-version");
  let forwarded = request;
  if (asked && !SUPPORTED_PROTOCOL_VERSIONS.includes(asked)) {
    console.warn(
      `[mcp] client asked for protocol ${asked}; this SDK knows ` +
        `${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}. Proceeding without the header.`,
    );
    const headers = new Headers(request.headers);
    headers.delete("mcp-protocol-version");
    forwarded = new Request(request.url, {
      method: request.method,
      headers,
      body: await request.arrayBuffer(),
    });
  }

  const server = buildServer(bearer);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // The SDK refuses some requests before any handler runs. Without this the
  // refusal reaches the client and nothing reaches the logs, which is the
  // worst of both: a user who cannot connect and a server with no account of
  // why.
  transport.onerror = (error) => console.error("[mcp] transport:", error.message);
  server.server.onerror = (error) => console.error("[mcp] server:", error.message);

  // Not closed afterwards: the transport owns the response body it returns, so
  // tearing the server down here would cut the reply off mid-flight.
  await server.connect(transport);
  return transport.handleRequest(forwarded);
}

/**
 * There is no server-to-client channel here, and saying so is kinder than
 * holding one open.
 *
 * A GET opens the stream the spec uses for server-initiated messages. This
 * endpoint is stateless and never initiates anything, so that stream would sit
 * there delivering nothing until something upstream gave up on it -- which
 * looks, from the other end, exactly like a connection that died. The spec
 * allows 405 for a server that does not offer the stream, so the client is
 * told once and stops waiting.
 */
function noStream(): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32000, message: "This server does not offer a server-to-client stream." },
      id: null,
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}

async function authenticate(request: Request): Promise<Awaited<ReturnType<typeof bearerFrom>> | Response> {
  try {
    return await bearerFrom(request);
  } catch (error) {
    if (error instanceof TokenError) {
      return Response.json(
        { error: error.message },
        {
          status: error.status,
          // No WWW-Authenticate: it reads as an offer of OAuth, and a client
          // that takes it up goes looking for discovery documents this server
          // does not have. The credential here is a header you configure.
          headers: undefined,
        },
      );
    }
    throw error;
  }
}

export const POST = post;
export const GET = noStream;
export const DELETE = noStream;
