import { join, resolve } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { getWorkspace } from "@/lib/workspace";
import { isPathInside, safeImageExt } from "@/lib/paths";
import { serverError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const IMAGES_DIR = ".cursor-remote-images";
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_SIZE = 10 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const workspace = getWorkspace();
    const dir = resolve(workspace, IMAGES_DIR);
    mkdirSync(dir, { recursive: true });

    const paths: string[] = [];

    for (const [, value] of formData.entries()) {
      if (!(value instanceof File)) continue;
      if (!ALLOWED_TYPES.has(value.type)) continue;
      if (value.size > MAX_SIZE) continue;

      const ext = safeImageExt(value.name) || (value.type === "image/png" ? "png" : value.type === "image/jpeg" ? "jpg" : value.type === "image/gif" ? "gif" : value.type === "image/webp" ? "webp" : null);
      if (!ext) continue;

      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = join(dir, name);
      if (!isPathInside(dir, filePath)) continue;

      const buffer = Buffer.from(await value.arrayBuffer());
      writeFileSync(filePath, buffer);
      paths.push(filePath);
    }

    if (paths.length === 0) {
      return Response.json({ error: "No valid images" }, { status: 400 });
    }

    return Response.json({ paths });
  } catch {
    return serverError("Failed to upload image");
  }
}
