import { YoutubeTranscript } from "@danielxceron/youtube-transcript";

export const runtime = "nodejs";

type RequestBody = {
    videoId: string;
    page?: number;
    lang?: string;
};

export async function onRequest(context: any): Promise<Response> {
    const { request } = context;

    if (request.method === "OPTIONS") {
        return corsResponse();
    }

    if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }

    let payload: RequestBody;
    try {
        payload = await request.json();
    } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const { videoId, page = 1, lang } = payload;

    if (!videoId || typeof videoId !== "string") {
        return jsonResponse({ error: "videoId is required and must be a string" }, 400);
    }

    try {
        const result = await fetchYoutubeTranscript(videoId, page, lang);
        return jsonResponse(result);
    } catch (err: any) {
        console.error("Unexpected error:", err);
        return jsonResponse(
            { error: "Internal server error", details: err?.message ?? "unknown" },
            500
        );
    }
}

function corsResponse(): Response {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
    });
}

function jsonResponse(data: any, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
    });
}

async function fetchYoutubeTranscript(
    videoId: string,
    page = 1,
    lang?: string
) {
    const transcript = await YoutubeTranscript.fetchTranscript(
        videoId,
        lang ? { lang } : undefined
    );

    if (!transcript?.length) {
        return {
            error: "No transcript available",
            fatal: true,
            hint: "Try another language code (en, en-US, a.en, es, fr).",
        };
    }

    const fullText = transcript.map(s => s.text).join(" ");
    const CHARS_PER_PAGE = 2000;
    const totalPages = Math.ceil(fullText.length / CHARS_PER_PAGE);

    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * CHARS_PER_PAGE;
    const text = fullText.slice(start, start + CHARS_PER_PAGE);

    const estimatedMinutes = Math.round(
        (transcript.at(-1)?.offset ?? 0) / 60000
    );

    // Fetch oEmbed metadata for page 1
    let metadata = null;
    if (safePage === 1) {
        try {
            const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
            const oembedRes = await fetch(oembedUrl);
            if (oembedRes.ok) {
                const oembedData = await oembedRes.json();
                metadata = {
                    title: oembedData.title,
                    channel: oembedData.author_name,
                    thumbnailUrl: oembedData.thumbnail_url,
                };
            }
        } catch (e: any) {
            console.warn("oEmbed fetch failed:", e.message);
        }
    }

    return {
        videoId,
        page: safePage,
        totalPages,
        estimatedDuration: `${estimatedMinutes} minutes`,
        text,
        hasMore: safePage < totalPages,
        ...(metadata && { metadata }),
    };
}
