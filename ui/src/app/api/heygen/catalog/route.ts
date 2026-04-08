import { NextResponse } from "next/server";

type HeygenAvatarGroup = {
  id: string;
  name?: string;
  group_type?: string;
  preview_image?: string;
};

type HeygenAvatarLook = {
  id: string;
  avatar_id?: string;
  look_id?: string;
  name?: string;
  image_url?: string | null;
  gender?: string;
};

type HeygenPhotoAvatarDetails = {
  id?: string;
  is_motion?: boolean;
  status?: string;
};

async function heygenFetch(path: string) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    throw new Error("HEYGEN_API_KEY is not configured");
  }

  const response = await fetch(`https://api.heygen.com${path}`, {
    headers: {
      "X-Api-Key": apiKey,
    },
    cache: "no-store",
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `HeyGen request failed with status ${response.status}`);
  }

  return data;
}

function resolveLookId(look: HeygenAvatarLook) {
  const candidate = [look.id, look.avatar_id, look.look_id].find(
    (value) => typeof value === "string" && value.trim()
  );
  return candidate?.trim() || "";
}

export async function GET() {
  try {
    const groupsPayload = await heygenFetch("/v2/avatar_group.list");
    const groups: HeygenAvatarGroup[] = groupsPayload?.data?.avatar_group_list || [];

    const groupLookResults = await Promise.all(
      groups.map(async (group, index) => {
        try {
          const looksPayload = await heygenFetch(`/v2/avatar_group/${group.id}/avatars`);
          const looks: HeygenAvatarLook[] = looksPayload?.data?.avatar_list || [];
          const lookDetails = await Promise.all(
            looks.map(async (look) => {
              const resolvedLookId = resolveLookId(look);
              if (!resolvedLookId) {
                return {
                  look,
                  resolvedLookId: "",
                  isMotion: false,
                };
              }
              try {
                const detailsPayload = await heygenFetch(`/v2/photo_avatar/${encodeURIComponent(resolvedLookId)}`);
                const details = (detailsPayload?.data || {}) as HeygenPhotoAvatarDetails;
                return {
                  look,
                  resolvedLookId,
                  isMotion: details.is_motion === true,
                };
              } catch {
                // Not all looks are photo avatars (some are studio/regular),
                // so "Photar not found" is expected — treat as non-motion.
                return {
                  look,
                  resolvedLookId,
                  isMotion: false,
                };
              }
            })
          );
          const nonMotionLooks = lookDetails
            .filter((item) => item.resolvedLookId && !item.isMotion)
            .map((item) => ({
              ...item.look,
              id: item.resolvedLookId,
            }));

          if (looks.length > 0 && nonMotionLooks.length === 0) {
            return null;
          }

          return {
            avatar_id: group.id,
            avatar_name: group.name || group.id,
            folder_name: group.group_type || "HEYGEN",
            preview_image_url: group.preview_image || nonMotionLooks[0]?.image_url || looks[0]?.image_url || "",
            is_active: true,
            sort_order: index,
            gender: nonMotionLooks[0]?.gender || looks[0]?.gender || "female",
            looks: nonMotionLooks.map((look, lookIndex) => ({
              look_id: look.id,
              look_name: look.name || `${group.name || group.id} look ${lookIndex + 1}`,
              preview_image_url: look.image_url || "",
              is_active: true,
              sort_order: lookIndex,
            })),
          };
        } catch (error) {
          console.error(`HeyGen group import failed for ${group.id}:`, error);
          return {
            avatar_id: group.id,
            avatar_name: group.name || group.id,
            folder_name: group.group_type || "HEYGEN",
            preview_image_url: group.preview_image || "",
            is_active: true,
            sort_order: index,
            looks: [],
          };
        }
      })
    );

    return NextResponse.json(groupLookResults.filter(Boolean));
  } catch (error) {
    console.error("HeyGen catalog GET error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 }
    );
  }
}
