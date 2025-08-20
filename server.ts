import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { contentType } from "https://deno.land/std@0.224.0/media_types/content_type.ts";
import * as path from "https://deno.land/std@0.224.0/path/mod.ts";

const port = 8000;
const CWD = Deno.cwd();

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let filePath = url.pathname;

  // Serve index.html for the root path
  if (filePath === "/") {
    filePath = "/index.html";
  }

  // Prevent directory traversal attacks
  const fullPath = path.join(CWD, path.normalize(filePath).substring(1));

  try {
    const fileContent = await Deno.readFile(fullPath);
    const mimeType = contentType(path.extname(fullPath)) || "application/octet-stream";

    return new Response(fileContent, {
      headers: { "Content-Type": mimeType },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return new Response("Not Found", { status: 404 });
    }
    console.error(`Error serving ${fullPath}:`, error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

console.log(`Development server running. Access it at: http://localhost:${port}/`);

serve(handleRequest, { port });
