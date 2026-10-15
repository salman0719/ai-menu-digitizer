import { NextResponse } from "next/server";

import { createGeminiProvider } from "@/lib/ai/gemini-provider";
import { extractMenuFromImage, ServiceError } from "@/lib/ai/service";

/**
 * POST /api/extract-menu — multipart form with an `image` file field.
 * Success: { menu } (validated extraction result, no stable IDs yet).
 * Failure: { error: { code, message } } — never provider internals,
 * credentials, or stack traces. Uploaded bytes are not stored server-side.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: { code: "missing_image", message: "Upload an image file in the `image` field." } },
        { status: 400 }
      );
    }
    const file = form.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: "missing_image", message: "Upload an image file in the `image` field." } },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const provider = apiKey
      ? createGeminiProvider({ apiKey, model: process.env.GEMINI_MODEL || undefined })
      : null;

    const menu = await extractMenuFromImage(
      {
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type,
        filename: file.name,
      },
      { provider }
    );
    return NextResponse.json({ menu });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }
    console.error("extract-menu unexpected error", error);
    return NextResponse.json(
      { error: { code: "internal_error", message: "Something went wrong. Try again." } },
      { status: 500 }
    );
  }
}
