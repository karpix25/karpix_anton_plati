import crypto from "crypto";

export const ASSET_HOST = "n8n-ai-avatars.focusmarket.su";
const TTL = 600;

function assetURI(uri: string) {
  const url = new URL(uri, `https://${ASSET_HOST}`);
  if (url.pathname.startsWith("/api/media/")) {
    const decoded = decodeURIComponent(url.pathname);
    return !url.search && !decoded.includes("\\") && !decoded.split("/").some(p => p === ".." || p === ".") &&
      /^\/api\/media\/[A-Za-z0-9_./-]+\.(?:mp4|mov|m4v|webm|jpg|jpeg|png|webp|gif|mp3|wav)$/.test(decoded);
  }
  const pairs = [...url.searchParams];
  if (["/api/tts/audio", "/api/scenarios/montage"].includes(url.pathname)) {
    return pairs.length === 1 && pairs[0][0] === "scenarioId" && /^[1-9][0-9]{0,18}$/.test(pairs[0][1]);
  }
  return url.pathname === "/api/heygen/preview" && pairs.length >= 1 && pairs.length <= 2 &&
    url.searchParams.getAll("key").length === 1 && /^[A-Za-z0-9:_-]{1,200}$/.test(url.searchParams.get("key") || "") &&
    pairs.every(([k, v]) => k === "key" || (k === "v" && /^[A-Za-z0-9-]{1,64}$/.test(v))) && url.searchParams.getAll("v").length <= 1;
}

export function providerAssetUrl(value: string) {
  const url = new URL(value, `https://${ASSET_HOST}`);
  if (url.hostname !== ASSET_HOST) return value; // Existing provider/CDN URLs keep their native contract.
  const uri = url.pathname + url.search;
  const secret = process.env.FM_AUTH_SECRET || "";
  if (url.origin !== `https://${ASSET_HOST}` || url.username || url.password || url.hash || !assetURI(uri) || Buffer.byteLength(secret) < 32) throw new Error("Unsupported provider asset");
  const payload = Buffer.from(JSON.stringify({ host: ASSET_HOST, uri, exp: Math.floor(Date.now() / 1000) + TTL })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(`fm-asset-v1.${payload}`).digest("base64url");
  return `https://${ASSET_HOST}${uri}${url.search ? "&" : "?"}fm_asset=v1.${payload}.${sig}`;
}

export function validProviderAsset(request: Request) {
  try {
    if (!["GET", "HEAD"].includes(request.method) || request.headers.get("host") !== ASSET_HOST) return false;
    const raw = request.url.match(/^https?:\/\/[^/]+(\/[^#]*)$/)?.[1] || "";
    const match = /^(.*)([?&])fm_asset=(v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43})$/.exec(raw);
    if (!match || raw.length > 16384) return false;
    const uri = match[1];
    if (!assetURI(uri)) return false;
    const [, payload, sig] = match[3].split(".");
    const secret = process.env.FM_AUTH_SECRET || "";
    if (Buffer.byteLength(secret) < 32) return false;
    const expected = crypto.createHmac("sha256", secret).update(`fm-asset-v1.${payload}`).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const decoded = Buffer.from(payload, "base64url");
    if (decoded.toString("base64url") !== payload) return false;
    const claim = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
    const remaining = claim.exp - Date.now() / 1000;
    return claim.host === ASSET_HOST && claim.uri === uri && Number.isSafeInteger(claim.exp) && remaining >= 0 && remaining <= TTL;
  } catch {
    return false;
  }
}
